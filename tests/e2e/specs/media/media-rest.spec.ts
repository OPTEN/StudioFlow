import crypto from 'node:crypto';
import { AdminApi, OutputApi, type AssetDto } from '../../support/api';
import { ERROR } from '../../support/constants';
import { expect, expectProblem, knownBug, test } from '../../support/fixtures';
import { openStudio } from '../../support/helpers';
import { multipart, rawRequest, send } from '../../support/http';
import { generateSamples, makeEbml, makeFtyp, makePng, makePngHeaderOnly, padTo, type SampleSet } from '../../support/media-samples';
import { compose } from '../../support/stack';
import { stackConfig } from '../../support/env';
import { t } from '../../support/tags';
import { TEXT } from '../../support/text';

/**
 * MEDIA - uploads, spoofing, limits, content access, ranges and the in-use protection against the real stack
 * (E2E-MEDIA-01/02/05/07/08/09/10, E2E-AUTH-17, E2E-OUT-19 and the INT-MEDIA-* cases at stack level).
 * The stack runs with MEDIA__MAXIMAGEBYTES=1 MiB and MEDIA__MAXVIDEOBYTES=2 MiB (tests/e2e/.env.e2e).
 */

let samples: SampleSet;
test.beforeAll(async () => {
  samples = await generateSamples();
});

const IMAGE_LIMIT = 1_048_576;
const VIDEO_LIMIT = 2_097_152;

async function mediaFiles(): Promise<string[]> {
  const result = await compose(['exec', '-T', 'api', 'sh', '-c', 'find /data/media -type f | sort']);
  expect(result.code, result.stderr).toBe(0);
  return result.stdout.split(/\r?\n/).filter(Boolean);
}

const sha256 = (data: Buffer) => crypto.createHash('sha256').update(data).digest('hex');

test.describe('MEDIA', () => {
  test('E2E-MEDIA-01 [api] the five valid media types upload as M1..M5 with verified types, events and files', t.p1, async ({ config, api, production, onCleanup }) => {
    const { hub } = await openStudio(config.baseURL, api, production, onCleanup);
    const files = [
      { fileName: 'tiny.png', contentType: 'image/png', data: samples.tinyPng, expect: { contentType: 'image/png', kind: 'image', ext: 'png', width: 1, height: 1 } },
      { fileName: 'photo.jpg', contentType: 'image/jpeg', data: samples.photoJpg, expect: { contentType: 'image/jpeg', kind: 'image', ext: 'jpg', width: 640, height: 360 } },
      { fileName: 'photo.webp', contentType: 'image/webp', data: samples.photoWebp, expect: { contentType: 'image/webp', kind: 'image', ext: 'webp', width: 640, height: 360 } },
      { fileName: 'clip.mp4', contentType: 'video/mp4', data: samples.clipMp4, expect: { contentType: 'video/mp4', kind: 'video', ext: 'mp4', width: null, height: null } },
      { fileName: 'clip.webm', contentType: 'video/webm', data: samples.clipWebm, expect: { contentType: 'video/webm', kind: 'video', ext: 'webm', width: null, height: null } },
    ];
    const uploaded: AssetDto[] = [];
    for (const file of files) {
      const response = await api.uploadAsset(production.id, file);
      expect(response.status, `${file.fileName}: ${response.raw.text().slice(0, 300)}`).toBe(201);
      expect(response.headers['location'] ?? '').toContain(`/api/productions/${production.id}/assets/`);
      const asset = response.body;
      expect(asset.id).toMatch(/^ast_[a-z2-7]{16}$/);
      expect(asset.kind).toBe(file.expect.kind);
      expect(asset.contentType).toBe(file.expect.contentType);
      expect(asset.sizeBytes).toBe(file.data.length);
      expect(asset.width, file.fileName).toBe(file.expect.width);
      expect(asset.height, file.fileName).toBe(file.expect.height);
      expect(asset.contentUrl).toBe(`/api/productions/${production.id}/assets/${asset.id}/content`);
      expect(asset.name, 'name comes from the file name without the extension').toBe(file.fileName.replace(/\.[a-z0-9]+$/, ''));
      uploaded.push(asset);
      const upserted = await hub.waitForEvent('assetUpserted', (event) => event.asset.id === asset.id);
      expect(upserted.asset.code).toBe(asset.code);
      const source = await hub.waitForEvent('sourceUpserted', (event) => event.source.id === asset.id);
      expect(source.source).toMatchObject({ kind: asset.kind, status: 'ok', assetId: asset.id });
      const log = await hub.waitForEvent('logAppended', (event) => event.entry.text.includes(asset.code) && event.entry.text.includes('uploaded'));
      expect(log.entry.text).toBe(`${asset.code} “${asset.name}” uploaded`);
      // The content is byte-identical.
      const content = await api.getAssetContent(production.id, asset.id);
      expect(content.status).toBe(200);
      expect(sha256(content.raw.body)).toBe(sha256(file.data));
    }
    expect(uploaded.map((asset) => asset.code)).toEqual(['M1', 'M2', 'M3', 'M4', 'M5']);
    const listed = (await api.listAssets(production.id)).body;
    expect(listed.map((asset) => asset.id).sort()).toEqual(uploaded.map((asset) => asset.id).sort());
    const onDisk = await mediaFiles();
    for (const [index, asset] of uploaded.entries()) expect(onDisk).toContain(`/data/media/${production.id}/${asset.id}.${files[index]!.expect.ext}`);
  });

  test('E2E-MEDIA-02 [api] spoofed and unsupported files are rejected with 415 and leave no trace', t.p0, async ({ config, api, production, onCleanup }) => {
    const { hub } = await openStudio(config.baseURL, api, production, onCleanup);
    const filesBefore = await mediaFiles();
    const revision = (await production.snapshot()).revision;
    for (const spoof of samples.spoofs) {
      const response = await api.uploadAsset(production.id, { fileName: spoof.fileName, contentType: spoof.contentType, data: spoof.buffer });
      expectProblem(response, 415, ERROR.unsupportedMedia);
      expect(response.body.detail ?? '', `${spoof.name}: English reason`).toBeTruthy();
    }
    expect(await mediaFiles(), 'nothing stored').toEqual(filesBefore);
    expect((await api.listAssets(production.id)).body).toHaveLength(0);
    const snapshot = await production.snapshot();
    expect(snapshot.revision, 'no event, no revision').toBe(revision);
    expect(hub.eventsOfType('assetUpserted')).toHaveLength(0);

    // Valid media with misleading metadata is accepted for what the bytes say.
    for (const sample of samples.disguisedValid) {
      const response = await api.uploadAsset(production.id, { fileName: sample.fileName, contentType: sample.contentType, data: sample.buffer });
      expect(response.status, `${sample.name}: ${response.raw.text().slice(0, 200)}`).toBe(201);
      expect(response.body.contentType).toBe('image/png');
    }

    // Multipart anomalies: no file part, a wrong part name, two file parts, a body that is not multipart.
    const upload = (body: Buffer, contentType: string) => api.call<unknown>('POST', `/api/productions/${production.id}/assets/`, { body, headers: { 'Content-Type': contentType } });
    const noFile = multipart([{ name: 'other', value: 'x' }]);
    expect([400, 415], 'no file part').toContain((await upload(noFile.body, noFile.contentType)).status);
    const wrongName = multipart([{ name: 'upload', fileName: 'a.png', contentType: 'image/png', data: samples.tinyPng }]);
    expect([400, 415], 'wrong part name').toContain((await upload(wrongName.body, wrongName.contentType)).status);
    const twoFiles = multipart([
      { name: 'file', fileName: 'a.png', contentType: 'image/png', data: samples.tinyPng },
      { name: 'file', fileName: 'b.png', contentType: 'image/png', data: samples.tinyPng },
    ]);
    const two = await upload(twoFiles.body, twoFiles.contentType);
    expect([400, 415, 201], 'two file parts').toContain(two.status);
    expect([400, 415]).toContain((await upload(samples.tinyPng, 'image/png')).status);
    expect([400, 415]).toContain((await upload(Buffer.from('{}'), 'application/json')).status);
    expect(await mediaFiles(), 'only the accepted files exist').toHaveLength(filesBefore.length + samples.disguisedValid.length + (two.status === 201 ? 1 : 0));
  });

  test('INT-MEDIA-03 [stack] polyglots are accepted as images but only ever served as the verified type', t.p0, async ({ api, production }) => {
    for (const sample of samples.polyglots) {
      const response = await api.uploadAsset(production.id, { fileName: sample.fileName, contentType: sample.contentType, data: sample.buffer });
      expect(response.status, `${sample.name}: ${response.raw.text().slice(0, 200)}`).toBe(201);
      const content = await api.getAssetContent(production.id, response.body.id);
      expect(content.status).toBe(200);
      expect(content.headers['content-type'], sample.name).toBe(response.body.contentType);
      expect(content.headers['content-type']).toMatch(/^image\//);
      expect(content.headers['x-content-type-options']).toMatch(/^nosniff/);
      expect(content.headers['content-security-policy'], 'API default CSP with sandbox').toContain('sandbox');
      expect(content.headers['content-disposition'] ?? 'inline', 'inline, never attachment').not.toMatch(/attachment/);
      expect(sha256(content.raw.body), 'the body is byte-identical (no rewriting)').toBe(sha256(sample.buffer));
    }
    // A GIF/JS polyglot is refused.
    const gif = samples.spoofs.find((sample) => sample.name === 'gif-js-polyglot')!;
    expectProblem(await api.uploadAsset(production.id, { fileName: gif.fileName, contentType: gif.contentType, data: gif.buffer }), 415, ERROR.unsupportedMedia);
  });

  test('INT-MEDIA-04 [stack] size limits: the limit passes, one byte more is 413 and leaves nothing behind', t.p0, async ({ api, production }) => {
    const filesBefore = await mediaFiles();
    const image = (size: number) => ({ fileName: 'size.png', contentType: 'image/png', data: padTo(makePng(1, 1), size) });
    const video = (size: number) => ({ fileName: 'size.mp4', contentType: 'video/mp4', data: padTo(makeFtyp('isom'), size) });
    expect((await api.uploadAsset(production.id, image(IMAGE_LIMIT - 1))).status, 'image limit - 1').toBe(201);
    expect((await api.uploadAsset(production.id, image(IMAGE_LIMIT))).status, 'image limit').toBe(201);
    expectProblem(await api.uploadAsset(production.id, image(IMAGE_LIMIT + 1)), 413, ERROR.unsupportedMedia);
    expect((await api.uploadAsset(production.id, video(VIDEO_LIMIT - 1))).status, 'video limit - 1').toBe(201);
    expect((await api.uploadAsset(production.id, video(VIDEO_LIMIT))).status, 'video limit').toBe(201);
    expectProblem(await api.uploadAsset(production.id, video(VIDEO_LIMIT + 1)), 413, ERROR.unsupportedMedia);
    // A video-sized file with image bytes is judged by the image limit.
    expectProblem(await api.uploadAsset(production.id, { fileName: 'big.png', contentType: 'image/png', data: padTo(makePng(1, 1), IMAGE_LIMIT + 4096) }), 413, ERROR.unsupportedMedia);
    const assets = (await api.listAssets(production.id)).body;
    expect(assets, 'only the four accepted files are registered').toHaveLength(4);
    const files = await mediaFiles();
    expect(files.length - filesBefore.length, 'the partial files of the refused uploads are deleted').toBe(4);
  });

  test('INT-MEDIA-05 [stack] hostile file names are sanitised and nothing is written outside the production folder', t.p0, async ({ api, production }) => {
    const names = ['../../evil.png', '..\\..\\evil.png', 'C:\\evil.png', '/abs/evil.png', 'x.png\u0000.exe', `${'a'.repeat(300)}.png`, '...', '.hidden.png', 'CON.png', '\u202egnp.exe', '"><img src=x onerror=window.__xss=1>.png', '   ', '😀😀😀.png'];
    const before = await mediaFiles();
    for (const fileName of names) {
      const response = await api.uploadAsset(production.id, { fileName, contentType: 'image/png', data: samples.tinyPng });
      expect(response.status, `${JSON.stringify(fileName)}: ${response.raw.text().slice(0, 200)}`).toBe(201);
      const name = response.body.name;
      expect(name.length, JSON.stringify(fileName)).toBeGreaterThanOrEqual(1);
      expect(name.length).toBeLessThanOrEqual(80);
      expect(name, 'no path characters').not.toMatch(/[\\/]/);
      expect(name, 'no control characters').not.toMatch(/[\u0000-\u001f\u007f]/);
      expect(name.trim()).not.toBe('');
    }
    const files = (await mediaFiles()).filter((file) => !before.includes(file));
    expect(files).toHaveLength(names.length);
    for (const file of files) expect(file, 'stored under {root}/{productionId}/{assetId}{ext}').toMatch(new RegExp(`^/data/media/${production.id}/ast_[a-z2-7]{16}\\.png$`));
    const whole = await compose(['exec', '-T', 'api', 'sh', '-c', 'find / -name "evil*" -not -path "/proc/*" 2>/dev/null | head']);
    expect(whole.stdout.trim(), 'no file named like an attack name exists').toBe('');
    // Renames are sanitised with the same rules.
    const asset = (await api.uploadAsset(production.id, { fileName: 'rename.png', contentType: 'image/png', data: samples.tinyPng })).body;
    for (const text of ['n'.repeat(80), '<img src=x onerror=window.__xss=1>']) {
      const renamed = await api.renameAsset(production.id, asset.id, text);
      expect(renamed.status, JSON.stringify(text)).toBe(200);
      expect(renamed.body.name, 'stored verbatim, escaped by the clients').toBe(text);
      expect(renamed.body.code, 'the code never changes').toBe(asset.code);
    }
    expectProblem(await api.renameAsset(production.id, asset.id, ''), 400, ERROR.validationFailed);
    expectProblem(await api.renameAsset(production.id, asset.id, 'n'.repeat(81)), 400, ERROR.validationFailed);
    expectProblem(await api.renameAsset(production.id, asset.id, '   '), 400, ERROR.validationFailed);
  });

  test('INT-MEDIA-05 [stack, display names] bidi overrides and dot-only names are cleaned, the fallback name is “Media” (UNIT-MEDIA-01)', t.p1, async ({ api, production }) => {
    knownBug('BUG-15', 'the file name sanitiser keeps U+202E (bidi override) and returns "..", "." for dot-only names; blank names become “Image” instead of the pinned fallback “Media”');
    const upload = async (fileName: string) => (await api.uploadAsset(production.id, { fileName, contentType: 'image/png', data: samples.tinyPng })).body.name;
    const bidi = await upload('\u202egnp.exe');
    expect(bidi, 'no bidi override character').not.toMatch(/[\u202a-\u202e\u2066-\u2069]/);
    for (const dots of ['...', '..', '....png']) {
      const name = await upload(dots);
      expect(name, `dot-only name ${dots}`).not.toMatch(/^\.+$/);
    }
    expect(await upload('   '), 'blank names fall back to “Media”').toBe('Media');
    const first = (await api.listAssets(production.id)).body[0]!.id;
    const bidiRename = await api.renameAsset(production.id, first, '\u202eevil');
    expect(bidiRename.body.name, 'rename uses the same rules').not.toMatch(/[\u202a-\u202e\u2066-\u2069]/);
    const pathRename = await api.renameAsset(production.id, first, '../../x');
    expect(pathRename.body.name, 'rename removes path characters like the upload does').not.toMatch(/[\\/]/);
  });

  test('INT-MEDIA-06 [stack] content endpoint: cookie or key, caching headers, conditional requests', t.p0, async ({ api, production, config }) => {
    const asset = (await api.uploadAsset(production.id, { fileName: 'tiny.png', contentType: 'image/png', data: samples.tinyPng })).body;
    const route = `/api/productions/${production.id}/assets/${asset.id}/content`;
    const foreign = await api.createProduction({ name: `e2e media foreign ${Date.now()}` });
    const foreignKey = new URL((await api.getOutputSettings(foreign.body.id)).body.url).searchParams.get('k')!;
    const anon = (query = '', method = 'GET', headers: Record<string, string> = {}) => send({ method, url: `${config.baseURL}${route}${query}`, headers });

    const viaCookie = await api.getAssetContent(production.id, asset.id);
    expect(viaCookie.status).toBe(200);
    expect(viaCookie.headers['content-type']).toBe('image/png');
    expect(viaCookie.headers['cache-control']).toBe('private, max-age=3600');
    expect(viaCookie.headers['accept-ranges']).toBe('bytes');
    expect(viaCookie.headers['last-modified'] ?? '', 'Last-Modified').toBeTruthy();
    expect(viaCookie.headers['x-content-type-options']).toMatch(/^nosniff/);
    expect((await anon(`?k=${production.outputKey}`)).status, 'right key').toBe(200);
    expect((await anon(`?k=wrong-key-wrong-key-wrong-key-wrong-key-1`)).status, 'wrong key').toBe(403);
    expect((await anon(`?k=${foreignKey}`)).status, 'key of another production').toBe(403);
    expect((await anon(`?k=${production.outputKey}`, 'GET', { 'If-Modified-Since': viaCookie.headers['last-modified']! })).status, '304 on If-Modified-Since').toBe(304);
    // Unknown asset and unknown production.
    expect((await api.getAssetContent(production.id, 'ast_aaaaaaaaaaaaaaaa')).status).toBe(404);
    expect((await api.getAssetContent('prd_aaaaaaaaaaaaaaaa', asset.id)).status).toBe(404);
  });

  test('INT-MEDIA-06 [stack, HEAD] HEAD on the content endpoint mirrors GET without a body', t.p2, async ({ api, production, config }) => {
    knownBug('BUG-16', 'HEAD .../assets/{id}/content answers 405 (only GET is mapped); INT-MEDIA-06 and E2E-AUTH-17 expect HEAD to mirror GET');
    const asset = (await api.uploadAsset(production.id, { fileName: 'tiny.png', contentType: 'image/png', data: samples.tinyPng })).body;
    const head = await send({ method: 'HEAD', url: `${config.baseURL}${asset.contentUrl}?k=${production.outputKey}` });
    expect(head.status).toBe(200);
    expect(head.body.length, 'HEAD has no body').toBe(0);
    expect(head.headers['content-type']).toBe('image/png');
    expect(head.headers['x-content-type-options']).toMatch(/^nosniff/);
  });

  test('INT-MEDIA-06 [stack, ETag] the content carries an ETag and answers 304 to a matching If-None-Match', t.p1, async ({ api, production, config }) => {
    knownBug('BUG-14', 'asset content responses have Last-Modified but no ETag (INT-MEDIA-06 expects both; If-Range with an ETag is then not evaluated either)');
    const asset = (await api.uploadAsset(production.id, { fileName: 'tiny.png', contentType: 'image/png', data: samples.tinyPng })).body;
    const first = await api.getAssetContent(production.id, asset.id);
    const etag = first.headers['etag'];
    expect(etag, 'ETag').toBeTruthy();
    const again = await send({ method: 'GET', url: `${config.baseURL}${asset.contentUrl}?k=${production.outputKey}`, headers: { 'If-None-Match': etag! } });
    expect(again.status).toBe(304);
  });

  test('E2E-AUTH-17 [stack, no credential] a content request without cookie or key is 401', t.p1, async ({ api, production, config }) => {
    knownBug('BUG-13', 'GET .../assets/{id}/content without cookie and without ?k= answers 403; the route policy matrix and GAP-13 pin 401 (403 only for a wrong or foreign key)');
    const asset = (await api.uploadAsset(production.id, { fileName: 'tiny.png', contentType: 'image/png', data: samples.tinyPng })).body;
    const response = await send({ method: 'GET', url: `${config.baseURL}/api/productions/${production.id}/assets/${asset.id}/content` });
    expect(response.status).toBe(401);
  });

  test('INT-MEDIA-07 [stack] range requests on video', t.p1, async ({ api, production }) => {
    const asset = (await api.uploadAsset(production.id, { fileName: 'clip.mp4', contentType: 'video/mp4', data: samples.clipMp4 })).body;
    const total = samples.clipMp4.length;
    const range = (value: string, extra: Record<string, string> = {}) => api.getAssetContent(production.id, asset.id, { headers: { Range: value, ...extra } });
    const ok = async (value: string, start: number, end: number) => {
      const response = await range(value);
      expect(response.status, value).toBe(206);
      expect(response.headers['content-range'], value).toBe(`bytes ${start}-${end}/${total}`);
      expect(response.headers['content-length'], value).toBe(String(end - start + 1));
      expect(response.raw.body.equals(samples.clipMp4.subarray(start, end + 1)), `${value}: exact bytes`).toBe(true);
    };
    await ok('bytes=0-99', 0, 99);
    await ok('bytes=100-', 100, total - 1);
    await ok('bytes=-50', total - 50, total - 1);
    await ok('bytes=0-0', 0, 0);
    await ok(`bytes=${total - 1}-${total - 1}`, total - 1, total - 1);
    const unsatisfiable = await range('bytes=999999999-');
    expect(unsatisfiable.status).toBe(416);
    expect(unsatisfiable.headers['content-range']).toBe(`bytes */${total}`);
    // Syntactically invalid ranges are ignored (200 full) or refused (416) - never a 500.
    for (const value of ['bytes=5-2', 'garbage', 'bytes=abc-def', 'items=0-5', 'bytes=0-99,200-299']) {
      const response = await range(value);
      expect([200, 206, 416], `${value} -> ${response.status}`).toContain(response.status);
      if (response.status === 200) expect(response.raw.body.length).toBe(total);
    }
  });

  test('INT-MEDIA-07 [stack, If-Range] a validator that does not match returns the whole file', t.p1, async ({ api, production }) => {
    knownBug('BUG-14', 'If-Range with a non-matching validator still answers 206 (the resource has no ETag)');
    const asset = (await api.uploadAsset(production.id, { fileName: 'clip.mp4', contentType: 'video/mp4', data: samples.clipMp4 })).body;
    const mismatch = await api.getAssetContent(production.id, asset.id, { headers: { Range: 'bytes=0-9', 'If-Range': '"not-the-etag"' } });
    expect(mismatch.status).toBe(200);
    expect(mismatch.raw.body.length).toBe(samples.clipMp4.length);
  });

  test('E2E-MEDIA-08 [api] seeking asks for a new range and is answered without sending the whole file again', t.p2, async ({ api, production }) => {
    const asset = (await api.uploadAsset(production.id, { fileName: 'clip.webm', contentType: 'video/webm', data: samples.clipWebm })).body;
    const total = samples.clipWebm.length;
    const offset = Math.floor(total * 0.6);
    const response = await api.getAssetContent(production.id, asset.id, { headers: { Range: `bytes=${offset}-` } });
    expect(response.status).toBe(206);
    expect(response.headers['content-range']).toBe(`bytes ${offset}-${total - 1}/${total}`);
    expect(response.raw.body.length).toBe(total - offset);
  });

  test('E2E-OUT-19 [api] assets through the output key: image 200, video 206 with Content-Range, wrong key 403', t.p1, async ({ config, api, production }) => {
    const image = (await api.uploadAsset(production.id, { fileName: 'tiny.png', contentType: 'image/png', data: samples.tinyPng })).body;
    const video = (await api.uploadAsset(production.id, { fileName: 'clip.mp4', contentType: 'video/mp4', data: samples.clipMp4 })).body;
    // The output snapshot lists both with the relative content URL the page appends ?k= to.
    const snapshot = await production.output().getOutputSnapshot();
    expect(snapshot.body.assets.map((asset) => asset.contentUrl).sort()).toEqual([image.contentUrl, video.contentUrl].sort());
    const imageResponse = await send({ method: 'GET', url: `${config.baseURL}${image.contentUrl}?k=${production.outputKey}` });
    expect(imageResponse.status).toBe(200);
    expect(imageResponse.headers['cache-control']).toBe('private, max-age=3600');
    const videoResponse = await send({ method: 'GET', url: `${config.baseURL}${video.contentUrl}?k=${production.outputKey}`, headers: { Range: 'bytes=0-' } });
    expect(videoResponse.status).toBe(206);
    expect(videoResponse.headers['content-range']).toMatch(/^bytes 0-\d+\/\d+$/);
    const denied = await send({ method: 'GET', url: `${config.baseURL}${image.contentUrl}?k=wrong` });
    expect(denied.status).toBe(403);
    // After a key rotation the old URL stops working at once.
    const oldKey = production.outputKey;
    await api.regenerateOutputKey(production.id);
    expect((await send({ method: 'GET', url: `${config.baseURL}${image.contentUrl}?k=${oldKey}` })).status).toBe(403);
    void OutputApi;
  });

  test('INT-MEDIA-08 [stack] an asset in use cannot be deleted: item source, scene background, slate background, fallback', t.p0, async ({ config, api, production, onCleanup }) => {
    const { hub } = await openStudio(config.baseURL, api, production, onCleanup);
    const scene = production.sceneIds[0]!;
    const make = async (name: string) => (await api.uploadAsset(production.id, { fileName: `${name}.png`, contentType: 'image/png', data: samples.tinyPng })).body;
    const asItem = await make('item');
    const asBackground = await make('background');
    const asSlate = await make('slate');
    const asFallback = await make('fallback');
    const target = await make('target');

    // 1. item source
    const added = await api.addSceneItem(production.id, scene, { source: asItem.id });
    expect(added.status, added.raw.text()).toBe(200);
    const itemId = added.body.items.at(-1)!.id;
    expectProblem(await api.deleteAsset(production.id, asItem.id), 409, ERROR.assetInUse);
    // 2. scene background
    expect((await api.updateScene(production.id, scene, { background: { color: '#102030', assetId: asBackground.id } })).status).toBe(200);
    expectProblem(await api.deleteAsset(production.id, asBackground.id), 409, ERROR.assetInUse);
    // 3. slate background
    expect((await api.updateProduction(production.id, { standbySlate: { title: TEXT.slate.standby, subtitle: production.name, backgroundAssetId: asSlate.id } })).status).toBe(200);
    expectProblem(await api.deleteAsset(production.id, asSlate.id), 409, ERROR.assetInUse);
    // 4. fallback source of an item
    const item = added.body.items.find((entry) => entry.id === itemId)!;
    const withFallback = await api.updateSceneItem(production.id, scene, itemId, { ...item, onLost: { holdMs: 3000, fallbackSource: asFallback.id } });
    expect(withFallback.status, withFallback.raw.text()).toBe(200);
    expectProblem(await api.deleteAsset(production.id, asFallback.id), 409, ERROR.assetInUse);
    expect(await mediaFiles()).toEqual(expect.arrayContaining([`/data/media/${production.id}/${asItem.id}.png`]));

    // Remove the references, then every asset can go (204, file removed, events, code freed).
    expect((await api.updateScene(production.id, scene, { background: { color: '#102030', assetId: null } })).status).toBe(200);
    expect((await api.updateProduction(production.id, { standbySlate: { title: TEXT.slate.standby, subtitle: production.name, backgroundAssetId: null } })).status).toBe(200);
    expect((await api.removeSceneItem(production.id, scene, itemId)).status).toBe(200);
    const from = hub.received.length;
    for (const asset of [asItem, asBackground, asSlate, asFallback]) {
      expect((await api.deleteAsset(production.id, asset.id)).status, asset.name).toBe(204);
      await hub.waitForEvent('assetRemoved', (event) => event.assetId === asset.id, { from });
      await hub.waitForEvent('sourceRemoved', (event) => event.sourceId === asset.id, { from });
    }
    const files = await mediaFiles();
    for (const asset of [asItem, asBackground, asSlate, asFallback]) expect(files).not.toContain(`/data/media/${production.id}/${asset.id}.png`);
    expectProblem(await api.deleteAsset(production.id, asItem.id), 404, ERROR.notFound);
    expectProblem(await api.deleteAsset(production.id, 'ast_aaaaaaaaaaaaaaaa'), 404, ERROR.notFound);
    const again = await make('again');
    expect(again.code, 'the lowest free code is reused').toBe(asItem.code);
    expect((await api.getAssetContent(production.id, target.id)).status, 'the other asset is untouched').toBe(200);
  });

  test('INT-MEDIA-10 [stack] ten parallel uploads get unique ids and codes and intact files', t.p2, async ({ api, production }) => {
    const results = await Promise.all(Array.from({ length: 10 }, (_, index) => api.uploadAsset(production.id, { fileName: `parallel-${index}.png`, contentType: 'image/png', data: makePng(1 + index, 1 + index) })));
    expect(results.map((result) => result.status).join(',')).toBe('201,201,201,201,201,201,201,201,201,201');
    const assets = results.map((result) => result.body);
    expect(new Set(assets.map((asset) => asset.id)).size).toBe(10);
    expect(new Set(assets.map((asset) => asset.code)).size, 'unique codes').toBe(10);
    for (const [index, asset] of assets.entries()) {
      const content = await api.getAssetContent(production.id, asset.id);
      expect(content.raw.body.length, `size on disk equals sizeBytes for ${asset.name}`).toBe(asset.sizeBytes);
      expect(content.raw.body.equals(makePng(1 + index, 1 + index))).toBe(true);
    }
  });

  test('INT-MEDIA-12 [stack] image dimensions above 16384 are refused (GAP-13)', t.p2, async ({ api, production }) => {
    knownBug('BUG-12', 'the dimension limit of the media inspector is 65535, not the pinned 16384: a 60000 x 60000 PNG header (the "decompression bomb") is accepted');
    const upload = (data: Buffer) => api.uploadAsset(production.id, { fileName: 'dim.png', contentType: 'image/png', data });
    expect((await upload(makePngHeaderOnly(16384, 16384))).status, 'at the limit').toBe(201);
    expectProblem(await upload(makePngHeaderOnly(16385, 1)), 415, ERROR.unsupportedMedia);
    expectProblem(await upload(makePngHeaderOnly(1, 16385)), 415, ERROR.unsupportedMedia);
    expectProblem(await upload(makePngHeaderOnly(60000, 60000)), 415, ERROR.unsupportedMedia);
  });

  test('E2E-MEDIA-07 [stack] upload body limits are enforced before a body is sent (Caddy 1100 MiB, API per type)', t.p1, async ({ api, production }) => {
    const announce = (bytes: number) =>
      rawRequest({
        host: 'localhost',
        port: stackConfig().httpsPort,
        tls: true,
        servername: 'localhost',
        bytes: [
          `POST /api/productions/${production.id}/assets/ HTTP/1.1`,
          'Host: localhost',
          'Content-Type: multipart/form-data; boundary=----x',
          `Content-Length: ${bytes}`,
          'X-StudioFlow: 1',
          `Cookie: ${api.cookie}`,
          'Connection: close',
          '',
          '',
        ].join(String.fromCharCode(13, 10)),
        readMs: 2500,
      });
    const caddyLimit = await announce(1100 * 1024 * 1024 + 1);
    expect(caddyLimit.status, caddyLimit.statusLine).toBe(413);
    const apiLimit = await announce(1024 * 1024 * 1024 + 1);
    expect(apiLimit.status, apiLimit.statusLine).toBe(413);
    // The configured API limit in this stack is MaxVideoBytes + 1 MiB of multipart overhead.
    const justAbove = await announce(VIDEO_LIMIT + 1024 * 1024 + 1);
    expect(justAbove.status, justAbove.statusLine).toBe(413);
    expect(justAbove.data.toString('latin1')).toContain('unsupported_media');
  });

  test('E2E-MEDIA-10 [browser] opening an asset URL directly renders the media and runs no script', t.p1, async ({ page, context, config, api, production }) => {
    const [name, value] = api.cookie.split('=');
    await context.addCookies([{ name: name!, value: value!, url: config.baseURL }]);
    const polyglot = samples.polyglots.find((sample) => sample.name === 'png-with-js-trailer')!;
    const png = (await api.uploadAsset(production.id, { fileName: polyglot.fileName, contentType: polyglot.contentType, data: polyglot.buffer })).body;
    const response = await page.goto(`${config.baseURL}${png.contentUrl}`);
    expect(response!.status()).toBe(200);
    expect(response!.headers()['content-type']).toBe('image/png');
    expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss), 'no script ran').toBeUndefined();
    expect(await page.evaluate(() => document.contentType)).toBe('image/png');
    const dimensions = await page.evaluate(() => {
      const img = document.querySelector('img');
      return img ? { w: img.naturalWidth, h: img.naturalHeight } : null;
    });
    expect(dimensions, 'the browser shows it as an image').toEqual({ w: 1, h: 1 });

    // A video document opened directly cannot play: the API response policy (default-src 'none'; sandbox) forbids
    // media-src. Embedded in a page of the stack origin (what the Regie and the output do) it plays with the cookie.
    const video = (await api.uploadAsset(production.id, { fileName: 'clip.webm', contentType: 'video/webm', data: samples.clipWebm })).body;
    await page.route(`${config.baseURL}/__e2e/blank`, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>blank</title><body></body>' }));
    await page.goto(`${config.baseURL}/__e2e/blank`);
    const playing = await page.evaluate(async (url) => {
      const element = document.createElement('video');
      element.muted = true;
      element.loop = true;
      element.src = url;
      document.body.append(element);
      await element.play();
      await new Promise((resolve) => setTimeout(resolve, 800));
      return { time: element.currentTime, width: element.videoWidth };
    }, video.contentUrl);
    expect(playing.width, 'video decoded').toBe(320);
    expect(playing.time, 'video plays').toBeGreaterThan(0);
    void makeEbml;
  });
});
