import crypto from 'node:crypto';
import { CUT, type AdminApi, type ProductionSnapshot } from '../../support/api';
import { ERROR } from '../../support/constants';
import { FULL, LEFT, RIGHT, putInScene } from '../../support/devices/fleet';
import { expect, expectProblem, test } from '../../support/fixtures';
import { stackConfig } from '../../support/env';
import { rawRequest } from '../../support/http';
import { makePng } from '../../support/media-samples';
import { compose } from '../../support/stack';
import { pairLaptopByLink, pairPhone, type PairContext, type PairedDevice, type Production } from '../../support/production';
import { t } from '../../support/tags';
import { makeZip, readZip } from '../../support/zip';

/**
 * XFER in the API (docs/testing.md 2.18: E2E-XFER-01 ... 05): duplicate a production, export it as a file and import the
 * file again, through Caddy as a user's browser or script reaches the API. A phone (K1) and a laptop (S1) are in the
 * scenes with a picture (M1): the copy keeps the scenes and the media, the devices become placeholders, and nothing that
 * belongs to a device, an output link or the log leaves the production.
 */

const sha256 = (data: Buffer) => crypto.createHash('sha256').update(data).digest('hex');
const PNG = makePng(64, 36, [200, 40, 40]);

interface Rich {
  phone: PairedDevice;
  laptop: PairedDevice;
  assetId: string;
}

/** Three scenes: Welcome (K1 left, S1 right, M1), Talk (K1 full, picture as background), Break (empty). */
async function richProduction(api: AdminApi, production: Production, pairContext: PairContext): Promise<Rich> {
  await production.seed(['Welcome', 'Talk', 'Break']);
  const phone = await pairPhone(pairContext, { name: 'Stage phone' });
  const laptop = await pairLaptopByLink(pairContext, { name: 'Lea laptop' });
  const upload = await api.uploadAsset(production.id, { fileName: 'title.png', contentType: 'image/png', data: PNG });
  expect(upload.status, upload.raw.text()).toBe(201);
  const assetId = upload.body.id;
  await putInScene(api, production, 0, phone.sourceId('camera'), LEFT);
  await putInScene(api, production, 0, laptop.sourceId('screen-1'), RIGHT);
  await putInScene(api, production, 0, assetId, { x: 40, y: 40, w: 320, h: 180 });
  await putInScene(api, production, 1, phone.sourceId('camera'), FULL);
  const background = await api.updateScene(production.id, production.sceneIds[1]!, { background: { color: '#102030', assetId } });
  expect(background.status, background.raw.text()).toBe(200);
  const slates = await api.updateProduction(production.id, { standbySlate: { title: 'Welcome to the webinar', subtitle: 'Soon', backgroundAssetId: assetId } });
  expect(slates.status, slates.raw.text()).toBe(200);
  return { phone, laptop, assetId };
}

/** The scenes of a snapshot without ids: devices by the code of their slot (or placeholder), media by their code. */
function scenesWithoutIds(snapshot: ProductionSnapshot): unknown[] {
  const codes = new Map<string, string>();
  for (const source of snapshot.sources) codes.set(source.id, source.code);
  for (const placeholder of snapshot.placeholders ?? []) codes.set(placeholder.sourceId, placeholder.code);
  const assets = new Map(snapshot.assets.map((asset) => [asset.id, asset.code]));
  const named = (id: string | null) => (id === null ? null : (codes.get(id) ?? id));
  return snapshot.scenes.map((scene) => ({
    name: scene.name,
    layoutMode: scene.layoutMode,
    background: { color: scene.background.color, asset: scene.background.assetId ? assets.get(scene.background.assetId) : null },
    items: scene.items.map((item) => ({
      source: named(item.source),
      x: item.x,
      y: item.y,
      w: item.w,
      h: item.h,
      fit: item.fit,
      crop: item.crop,
      radius: item.radius,
      mirror: item.mirror,
      rotation: item.rotation,
      hidden: item.hidden,
      locked: item.locked,
      border: item.border,
      onLost: { holdMs: item.onLost.holdMs, fallback: named(item.onLost.fallbackSource) },
    })),
  }));
}

async function mediaFiles(): Promise<string[]> {
  const result = await compose(['exec', '-T', 'api', 'sh', '-c', 'find /data/media -type f | sort']);
  expect(result.code, result.stderr).toBe(0);
  return result.stdout.split(/\r?\n/).filter(Boolean);
}

async function productionIds(api: AdminApi): Promise<string[]> {
  return (await api.listProductions()).body.map((production) => production.id).sort();
}

test.describe('XFER api', () => {
  test(
    'E2E-XFER-01 [api, K1 + S1 + M1] a duplicate takes scenes, media and settings, the devices become placeholders, and nothing of the devices, links and logs; it is not active',
    t.smoke,
    async ({ api, production, pairContext }) => {
      test.setTimeout(120_000);
      const rich = await richProduction(api, production, pairContext);
      // A restriction, a log entry and an audit entry that must stay behind.
      expect((await api.updateOutputAccess(production.id, { allowedIps: ['203.0.113.7'] })).status).toBe(200);
      expect((await api.switchProgram(production.id, { sceneId: production.sceneIds[1]!, transition: CUT })).status).toBe(200);
      const before = (await api.getSnapshot(production.id)).body;
      expect(before.recentLog.length).toBeGreaterThan(0);

      const copyName = `${production.name} (copy)`;
      const duplicated = await api.duplicateProduction(production.id, { name: copyName });
      expect(duplicated.status, duplicated.raw.text()).toBe(201);
      const copy = duplicated.body;
      expect(copy.name).toBe(copyName);
      expect(copy.id).not.toBe(production.id);
      expect(copy.slug).not.toBe(production.slug);
      expect(copy.isActive, 'a copy never becomes the active production').toBe(false);
      expect((await api.getActiveProduction()).body.id).toBe(production.id);

      const snapshot = (await api.getSnapshot(copy.id)).body;
      // The content.
      expect(scenesWithoutIds(snapshot)).toEqual(scenesWithoutIds(before));
      expect(snapshot.scenes.map((scene) => scene.id)).not.toEqual(expect.arrayContaining([production.sceneIds[0]!]));
      expect(snapshot.production.standbySlate.title).toBe('Welcome to the webinar');
      expect(snapshot.production.canvas).toEqual(before.production.canvas);
      expect(snapshot.production.textTheme).toEqual(before.production.textTheme);
      expect(snapshot.production.broadcast).toBe('standby');
      expect(snapshot.production.programSceneId).toBe(snapshot.scenes[0]!.id);
      // Media: a new asset with the same bytes, the slate and the background point to it.
      expect(snapshot.assets).toHaveLength(1);
      const asset = snapshot.assets[0]!;
      expect(asset.id).not.toBe(rich.assetId);
      expect(asset).toMatchObject({ code: 'M1', name: before.assets[0]!.name, contentType: 'image/png', sizeBytes: PNG.length });
      expect((await api.getAssetContent(copy.id, asset.id)).raw.body.equals(PNG)).toBe(true);
      expect(snapshot.production.standbySlate.backgroundAssetId).toBe(asset.id);
      expect(snapshot.scenes[1]!.background.assetId).toBe(asset.id);
      // The devices are placeholders with code and name; no device, source or secret of them.
      expect(snapshot.devices).toEqual([]);
      expect(snapshot.sources.filter((source) => source.deviceId !== null)).toEqual([]);
      expect(snapshot.placeholders.map((placeholder) => [placeholder.code, placeholder.kind, placeholder.label]).sort()).toEqual([
        ['K1', 'camera', 'Stage phone'],
        ['S1', 'screen', 'Lea laptop · Screen 1'],
      ]);
      const placeholderSources = snapshot.placeholders.map((placeholder) => placeholder.sourceId);
      expect(placeholderSources).not.toContain(rich.phone.sourceId('camera'));
      expect(placeholderSources).not.toContain(rich.laptop.sourceId('screen-1'));
      const text = JSON.stringify(snapshot);
      for (const secret of [rich.phone.credentials.deviceSecret, rich.laptop.credentials.deviceSecret, rich.phone.id, rich.laptop.id]) {
        expect(text, 'nothing of the devices of the original').not.toContain(secret);
      }
      // Pairings, incidents, log, links.
      expect(snapshot.invites).toEqual([]);
      expect(snapshot.pairingRequests).toEqual([]);
      expect(snapshot.incidents).toEqual([]);
      // The log of the production stays behind (entries of the account, like the setup, show in every production).
      const own = before.recentLog.filter((entry) => !/^Account /.test(entry.text));
      expect(own.length, 'the original has a log of its own').toBeGreaterThan(0);
      for (const entry of own) expect(snapshot.recentLog.map((candidate) => candidate.text), 'the log stays behind').not.toContain(entry.text);
      const settings = (await api.getOutputSettings(copy.id)).body;
      const original = (await api.getOutputSettings(production.id)).body;
      expect(settings.links).toHaveLength(1);
      expect(settings.url, 'a fresh output link').not.toBe(original.url);
      expect(settings.allowedIps ?? [], 'the IP restriction stays behind').toEqual([]);
      // The original is as it was.
      const after = (await api.getSnapshot(production.id)).body;
      expect(after.devices.map((device) => device.id).sort()).toEqual([rich.phone.id, rich.laptop.id].sort());
      expect(scenesWithoutIds(after)).toEqual(scenesWithoutIds(before));
      expect(after.revision).toBe(before.revision);
      // The audit log knows it.
      const audit = (await api.listAudit({ action: 'production.duplicated', limit: 20 })).body.entries;
      expect(audit.some((entry) => entry.text.includes(copyName)), JSON.stringify(audit.slice(0, 2))).toBe(true);
    },
  );

  test(
    'E2E-XFER-02 [api, K1] a running production is duplicated and exported read-only; the duplicate is in standby and the original keeps its revision',
    t.p1,
    async ({ api, production, pairContext }) => {
      test.setTimeout(120_000);
      const phone = await pairPhone(pairContext, { name: 'Stage phone' });
      await putInScene(api, production, 0, phone.sourceId('camera'), FULL);
      const started = await api.startBroadcast(production.id);
      expect(started.status, started.raw.text()).toBe(200);
      const before = (await api.getSnapshot(production.id)).body;
      expect(before.production.broadcast).toBe('live');

      const duplicated = await api.duplicateProduction(production.id, { name: null });
      expect(duplicated.status, duplicated.raw.text()).toBe(201);
      expect(duplicated.body.name).toBe(`${production.name} (copy)`);
      expect(duplicated.body.isActive).toBe(false);
      const exported = await api.exportProduction(production.id);
      expect(exported.status).toBe(200);

      const after = (await api.getSnapshot(production.id)).body;
      expect(after.production.broadcast).toBe('live');
      expect(after.revision, 'neither a duplicate nor an export changes the production').toBe(before.revision);
      expect(after.production.isActive).toBe(true);
      const copy = (await api.getSnapshot(duplicated.body.id)).body;
      expect(copy.production.broadcast).toBe('standby');
      expect(copy.production.liveSince).toBeNull();
      expect(copy.placeholders.map((placeholder) => placeholder.code)).toEqual(['K1']);
    },
  );

  test(
    'E2E-XFER-03 [api, K1 + S1 + M1] export streams a ZIP file with manifest and media and no ids; the preview counts, the import makes the same production under a new name, not active',
    t.smoke,
    async ({ api, production, pairContext }) => {
      test.setTimeout(180_000);
      const rich = await richProduction(api, production, pairContext);
      const original = (await api.getSnapshot(production.id)).body;
      const idsBefore = await productionIds(api);

      // The export, as the browser downloads it.
      const exported = await api.exportProduction(production.id);
      expect(exported.status, exported.raw.text().slice(0, 200)).toBe(200);
      expect(exported.headers['content-type']).toMatch(/^application\/zip/);
      expect(exported.headers['content-disposition'], 'a file name with the extension').toMatch(/filename\*?=.*\.studioflow\.zip/i);
      const archive = exported.raw.body;
      expect(archive.subarray(0, 2).toString('latin1')).toBe('PK');
      const files = readZip(archive);
      expect(files.map((file) => file.name).filter((name) => !name.startsWith('media/'))).toEqual(['manifest.json']);
      const media = files.filter((file) => file.name.startsWith('media/'));
      expect(media).toHaveLength(1);
      expect(media[0]!.data.equals(PNG)).toBe(true);
      const manifestText = files.find((file) => file.name === 'manifest.json')!.data.toString('utf8');
      const manifest = JSON.parse(manifestText) as {
        format: string;
        formatVersion: number;
        app: { version: string };
        production: { name: string };
        scenes: unknown[];
        assets: Array<{ sha256: string; file: string }>;
        placeholders: Array<{ code: string; label: string | null }>;
      };
      expect(manifest.format).toBe('studioflow-production');
      expect(manifest.formatVersion).toBe(1);
      expect(manifest.app.version).toBeTruthy();
      expect(manifest.production.name).toBe(production.name);
      expect(manifest.scenes).toHaveLength(3);
      expect(manifest.assets).toHaveLength(1);
      expect(manifest.assets[0]!.sha256).toBe(sha256(PNG));
      expect(manifest.assets[0]!.file).toBe(media[0]!.name);
      expect(manifest.placeholders.map((placeholder) => placeholder.code).sort()).toEqual(['K1', 'S1']);
      // No id, no secret, no key, no address of the production.
      expect(manifestText).not.toMatch(/\b(prd|scn|itm|dev|ast|plh|inc|inv)_[A-Za-z0-9]{8,}/);
      for (const secret of [rich.phone.credentials.deviceSecret, rich.laptop.credentials.deviceSecret, production.outputKey, production.slug]) {
        expect(manifestText).not.toContain(secret);
      }

      // The preview: what the file contains, nothing created.
      const preview = await api.importProduction({ fileName: 'webinar.studioflow.zip', data: archive }, { dryRun: true });
      expect(preview.status, preview.raw.text()).toBe(200);
      expect(preview.body).toMatchObject({ name: `${production.name} (2)`, scenes: 3, texts: 0, media: 1, mediaBytes: PNG.length });
      const warnings = (preview.body as { warnings: Array<{ code: string }> }).warnings.map((warning) => warning.code).sort();
      expect(warnings).toEqual(['nameChanged', 'placeholders']);
      expect(await productionIds(api), 'a preview creates nothing').toEqual(idsBefore);

      // The import.
      const imported = await api.importProduction({ fileName: 'webinar.studioflow.zip', data: archive });
      expect(imported.status, imported.raw.text()).toBe(201);
      const created = imported.body as { id: string; name: string; isActive: boolean; slug: string };
      expect(created.name).toBe(`${production.name} (2)`);
      expect(created.isActive, 'an import never becomes the active production').toBe(false);
      expect((await api.getActiveProduction()).body.id).toBe(production.id);
      const copy = (await api.getSnapshot(created.id)).body;
      expect(scenesWithoutIds(copy), 'the same scenes without ids').toEqual(scenesWithoutIds(original));
      expect(copy.devices).toEqual([]);
      expect(copy.placeholders.map((placeholder) => placeholder.code).sort()).toEqual(['K1', 'S1']);
      expect(copy.assets).toHaveLength(1);
      expect(copy.assets[0]!.id).not.toBe(rich.assetId);
      expect((await api.getAssetContent(created.id, copy.assets[0]!.id)).raw.body.equals(PNG)).toBe(true);
      expect(copy.production.broadcast).toBe('standby');
      expect(copy.production.standbySlate.title).toBe('Welcome to the webinar');
      expect((await api.getOutputSettings(created.id)).body.url).not.toBe(production.outputUrl);

      // The same file once more: the next free name.
      const again = await api.importProduction({ fileName: 'webinar.studioflow.zip', data: archive });
      expect(again.status).toBe(201);
      expect((again.body as { name: string }).name).toBe(`${production.name} (3)`);

      // The audit log.
      const exportedEntries = (await api.listAudit({ action: 'production.exported', limit: 20 })).body.entries;
      expect(exportedEntries.some((entry) => entry.text.includes(production.name))).toBe(true);
      const importedEntries = (await api.listAudit({ action: 'production.imported', limit: 20 })).body.entries;
      expect(importedEntries.some((entry) => entry.text.includes(created.name))).toBe(true);
    },
  );

  test(
    'E2E-XFER-04 [api] refused files: not a ZIP, no manifest, a newer format, zip slip, a ZIP bomb and an SVG each get their code, and nothing is left in the database or in the media folder',
    t.p0,
    async ({ api, production }) => {
      test.setTimeout(180_000);
      const upload = await api.uploadAsset(production.id, { fileName: 'title.png', contentType: 'image/png', data: PNG });
      expect(upload.status).toBe(201);
      const exported = await api.exportProduction(production.id);
      expect(exported.status).toBe(200);
      const files = readZip(exported.raw.body);
      const manifestText = files.find((file) => file.name === 'manifest.json')!.data.toString('utf8');
      const mediaName = files.find((file) => file.name.startsWith('media/'))!.name;
      const manifest = JSON.parse(manifestText) as { formatVersion: number; assets: Array<{ file: string; sha256: string; sizeBytes: number; contentType: string }> };
      const withManifest = (change: (value: typeof manifest) => void, extra: Array<{ name: string; data: Buffer; deflate?: boolean }> = [], media: Buffer = PNG, mediaFile = mediaName) => {
        const copy = JSON.parse(manifestText) as typeof manifest;
        change(copy);
        return makeZip([{ name: 'manifest.json', data: Buffer.from(JSON.stringify(copy)) }, { name: mediaFile, data: media }, ...extra]);
      };
      const idsBefore = await productionIds(api);
      const filesBefore = await mediaFiles();

      const refusals: Array<{ name: string; archive: Buffer; status: number; code: string }> = [
        { name: 'a text file', archive: Buffer.from('this is not a zip file'), status: 400, code: ERROR.invalidArchive },
        { name: 'a ZIP without manifest', archive: makeZip([{ name: 'media/a.png', data: PNG }]), status: 400, code: ERROR.invalidArchive },
        { name: 'a newer format version', archive: withManifest((value) => (value.formatVersion = 99)), status: 400, code: ERROR.unsupportedFormat },
        { name: 'a name with ..', archive: withManifest(() => undefined, [{ name: '../evil.txt', data: Buffer.from('evil') }]), status: 400, code: ERROR.invalidArchive },
        { name: 'an absolute name', archive: withManifest(() => undefined, [{ name: '/etc/evil.txt', data: Buffer.from('evil') }]), status: 400, code: ERROR.invalidArchive },
        { name: 'a name outside media/', archive: withManifest(() => undefined, [{ name: 'other/evil.png', data: PNG }]), status: 400, code: ERROR.invalidArchive },
        {
          name: 'a ZIP bomb',
          archive: makeZip([
            { name: 'manifest.json', data: Buffer.from(manifestText) },
            { name: mediaName, data: Buffer.concat([PNG, Buffer.alloc(40 * 1024 * 1024)]), deflate: true },
          ]),
          status: 400,
          code: ERROR.invalidArchive,
        },
        {
          name: 'a wrong checksum',
          archive: withManifest(() => undefined, [], Buffer.concat([PNG, Buffer.from('tampered')])),
          status: 400,
          code: ERROR.invalidArchive,
        },
      ];
      const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>');
      refusals.push({
        name: 'an SVG as medium',
        archive: withManifest(
          (value) => {
            value.assets[0]!.sha256 = sha256(svg);
            value.assets[0]!.sizeBytes = svg.length;
            value.assets[0]!.contentType = 'image/png';
          },
          [],
          svg,
        ),
        status: 415,
        code: ERROR.unsupportedMedia,
      });
      for (const refusal of refusals) {
        for (const dryRun of [true, false]) {
          const result = await api.importProduction({ fileName: 'x.studioflow.zip', data: refusal.archive }, { dryRun });
          expectProblem(result, refusal.status, refusal.code);
          expect(result.status, `${refusal.name} (dry run ${dryRun})`).toBe(refusal.status);
        }
      }
      expect(await productionIds(api), 'no production was created').toEqual(idsBefore);
      expect(await mediaFiles(), 'no file was left in the media folder').toEqual(filesBefore);
    },
  );

  test(
    'E2E-XFER-05 [api] the import route has its own body limit in Caddy (a file above it is refused before a body is sent) and needs the Regie session',
    t.p1,
    async ({ api }) => {
      const announce = (bytes: number, cookie: string) =>
        rawRequest({
          host: 'localhost',
          port: stackConfig().httpsPort,
          tls: true,
          servername: 'localhost',
          bytes: [
            'POST /api/productions/import HTTP/1.1',
            'Host: localhost',
            'Content-Type: multipart/form-data; boundary=----x',
            `Content-Length: ${bytes}`,
            'X-StudioFlow: 1',
            ...(cookie ? [`Cookie: ${cookie}`] : []),
            'Connection: close',
            '',
            '',
          ].join(String.fromCharCode(13, 10)),
          readMs: 2500,
        });
      // 4100 MiB is the limit of Caddy (STUDIOFLOW_MAX_IMPORT); the API itself stops at 4 GiB plus the multipart overhead.
      const caddyLimit = await announce(4100 * 1024 * 1024 + 1, api.cookie);
      expect(caddyLimit.status, caddyLimit.statusLine).toBe(413);
      const apiLimit = await announce(4097 * 1024 * 1024 + 1, api.cookie);
      expect(apiLimit.status, apiLimit.statusLine).toBe(413);
      expect(apiLimit.data.toString('latin1')).toContain(ERROR.archiveTooLarge);
      // Not signed in: refused, with or without a big announcement.
      const anonymous = await api.importProduction({ fileName: 'x.studioflow.zip', data: makeZip([]) }, { anonymous: true });
      expect([401, 403]).toContain(anonymous.status);
      const export_ = await api.exportProduction('prd_aaaaaaaaaaaaaaaa', { anonymous: true });
      expect([401, 403]).toContain(export_.status);
    },
  );
});
