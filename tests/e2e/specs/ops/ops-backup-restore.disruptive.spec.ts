import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { AdminApi, CUT, OutputApi } from '../../support/api';
import type { ProductionSnapshot } from '../../../../packages/scene-model/src/contracts';
import { dockerCtl } from '../../support/docker-ctl';
import { PROJECT, stackConfig } from '../../support/env';
import { expect, test } from '../../support/fixtures';
import { generateSamples } from '../../support/media-samples';
import { OpsSandbox, bashLine, certSerial } from '../../support/ops';
import { pairPhone, type PairContext, type PairedDevice, type Production } from '../../support/production';
import { sleep } from '../../support/shell';
import { SyncClient } from '../../support/sync-client';
import { compose, containerName, docker, ensureHealthy, inspectService } from '../../support/stack';
import { eventually } from '../../support/sim';
import { t } from '../../support/tags';

/**
 * OPS - backup.sh and restore.sh on the running stack (docs/testing.md E2E-OPS-07 and -08). The scripts run
 * unmodified from an isolated copy (support/ops.ts); their backups land in the sandbox, never in the repository.
 */

let box: OpsSandbox;

test.beforeAll(() => {
  box = OpsSandbox.create('backup');
});

test.afterAll(async () => {
  await box.cleanup();
});

test.afterEach(async () => {
  test.setTimeout(420_000);
  box.clearFault();
  await ensureHealthy();
});

const DATED = /^\d{4}-\d{2}-\d{2}_\d{4}(_[A-Za-z0-9-]+)?(-\d+)?$/;
const sha256 = (data: Buffer | string) => crypto.createHash('sha256').update(data).digest('hex');

function backupFolders(dir = box.path('backups')): string[] {
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((name) => DATED.test(name) && fs.existsSync(path.join(dir, name, 'SHA256SUMS'))).sort() : [];
}

function newest(dir = box.path('backups')): string {
  const folders = backupFolders(dir).map((name) => ({ name, time: fs.statSync(path.join(dir, name, 'SHA256SUMS')).mtimeMs }));
  return path.join(dir, folders.sort((a, b) => b.time - a.time)[0]!.name);
}

/** The parts of a snapshot a restore must reproduce (no revision, no clock, no live connection state). */
function stable(snapshot: ProductionSnapshot): unknown {
  return {
    production: snapshot.production,
    scenes: snapshot.scenes,
    sources: snapshot.sources.map(({ id, code, kind, label, deviceId, slot, assetId }) => ({ id, code, kind, label, deviceId, slot, assetId })),
    devices: snapshot.devices.map(({ id, name, kind, state, pairingMethod, platform, pairedAt }) => ({ id, name, kind, state, pairingMethod, platform, pairedAt })),
    assets: snapshot.assets,
  };
}

async function psql(sql: string): Promise<string> {
  const result = await docker(['exec', containerName('postgres'), 'psql', '-U', 'studioflow', '-d', 'studioflow', '-tAc', sql], { check: true });
  return result.stdout.trim();
}

interface Seed {
  production: Production;
  devices: PairedDevice[];
  assets: Array<{ id: string; sha: string; size: number }>;
  outputUrl: string;
  snapshot: unknown;
  cert: string;
  audit: number;
}

/** A production with 5 scenes, 2 paired phones, an image and a video asset, a rotated output key and an ended broadcast. */
async function seedWorld(api: AdminApi, production: Production, pairContext: PairContext): Promise<Seed> {
  const samples = await generateSamples();
  await production.seed(['Begrüssung', 'Präsentation', 'Pause', 'Interview', 'Abmoderation']);
  const devices = [await pairPhone(pairContext, { name: 'Handy Eins' }), await pairPhone(pairContext, { name: 'Handy Zwei' })];
  await api.addSceneItem(production.id, production.sceneIds[0]!, { source: devices[0]!.sourceId() });
  await api.addSceneItem(production.id, production.sceneIds[1]!, { source: devices[1]!.sourceId() });
  const assets: Seed['assets'] = [];
  for (const file of [
    { fileName: 'bild.jpg', contentType: 'image/jpeg', data: samples.photoJpg },
    { fileName: 'clip.mp4', contentType: 'video/mp4', data: samples.clipMp4 },
  ]) {
    const uploaded = await api.uploadAsset(production.id, file);
    expect(uploaded.status, uploaded.raw.text()).toBe(201);
    assets.push({ id: uploaded.body.id, sha: sha256(file.data), size: file.data.length });
  }
  expect((await api.regenerateOutputKey(production.id)).status).toBe(200);
  await production.refreshOutput();
  expect((await api.startBroadcast(production.id)).status).toBe(200);
  expect((await api.endBroadcast(production.id)).status).toBe(200);
  const snapshot = (await api.getSnapshot(production.id)).body;
  expect(snapshot.production.broadcast).toBe('ended');
  return { production, devices, assets, outputUrl: production.outputUrl, snapshot: stable(snapshot), cert: await certSerial(), audit: Number(await psql('select count(*) from audit_entries')) };
}

/** Everything a restore must give back (E2E-OPS-08 Expect). */
async function expectRestored(seed: Seed, api: AdminApi): Promise<void> {
  const config = stackConfig();
  const session = new AdminApi(config.baseURL, api.cookie);
  expect((await session.getSession()).status, 'the admin session from before the backup is still valid (keys volume)').toBe(200);
  const snapshot = (await session.getSnapshot(seed.production.id)).body;
  expect(stable(snapshot), 'snapshot equals the one from before the backup').toEqual(seed.snapshot);
  for (const device of seed.devices) expect((await device.api.getDeviceSelf()).status, `${device.name} is recognised with its old credentials`).toBe(200);
  for (const asset of seed.assets) {
    const content = await session.getAssetContent(seed.production.id, asset.id);
    expect(content.status, `asset ${asset.id}`).toBe(200);
    expect(sha256(content.raw.body), `asset ${asset.id} byte-identical`).toBe(asset.sha);
  }
  const output = new OutputApi(config.baseURL, seed.production.slug, new URL(seed.outputUrl).searchParams.get('k') ?? seed.production.outputKey);
  expect((await output.getOutputSnapshot()).status, 'the old output URL works').toBe(200);
  expect(await certSerial(), 'the Caddy certificate is the old one').toBe(seed.cert);
  expect(Number(await psql('select count(*) from audit_entries')), 'audit rows present').toBeGreaterThanOrEqual(seed.audit);
}

async function runBackup(args: string[] = []) {
  return box.run('backup.sh', ['--dir', box.path('backups'), ...args]);
}

test.describe('OPS backup', () => {
  test('E2E-OPS-07 [backup.sh] a backup of the running stack is complete, verifiable and does not disturb the Regie', t.disruptive('@p0'), async ({ config, api, production, pairContext, onCleanup }) => {
    test.setTimeout(420_000);
    const seed = await seedWorld(api, production, pairContext);
    await api.resetBroadcast(production.id);
    const regie = await SyncClient.connect(config.baseURL, api.cookie, production.id);
    onCleanup(() => regie.stop());

    // The Regie switches scenes while the backup runs.
    const latencies: number[] = [];
    let finished = false;
    const backup = runBackup().finally(() => (finished = true));
    let next = 0;
    while (!finished) {
      const scene = production.sceneIds[next++ % production.sceneIds.length]!;
      const started = Date.now();
      const response = await api.switchProgram(production.id, { sceneId: scene, transition: CUT });
      if (response.status === 200) {
        await eventually(() => regie.state?.production.programSceneId === scene, 3000, 5);
        latencies.push(Date.now() - started);
      }
      await sleep(250);
    }
    const result = await backup;
    expect(result.code, result.output.slice(-1500)).toBe(0);
    const folder = newest();
    expect(path.basename(folder), 'folder name').toMatch(/^\d{4}-\d{2}-\d{2}_\d{4}$/);
    latencies.sort((a, b) => a - b);
    const p95 = latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))]!;
    test.info().annotations.push({ type: 'measurement', description: `backup took ${result.durationMs} ms; ${latencies.length} switches during it, p95 ${p95} ms, max ${latencies.at(-1)} ms` });
    expect(latencies.length, 'switches were made while the backup ran').toBeGreaterThanOrEqual(3);
    expect(p95, 'switch latency during the backup stays within T-SWITCH p95 (300 ms) + 100 ms').toBeLessThanOrEqual(400);

    // Content of the folder.
    expect(fs.readdirSync(folder).sort()).toEqual(['SHA256SUMS', 'backup-info.txt', 'caddy_data.tar.gz', 'database.dump', 'keys.tar.gz', 'media.tar.gz']);
    const verify = await bashLine(box, `cd "${folder.replace(/\\/g, '/')}" && sha256sum -c SHA256SUMS`);
    expect(verify.code, verify.output).toBe(0);
    expect(verify.stdout.match(/: OK/g)?.length, 'all five checksums verify').toBe(5);
    // The dump is a valid custom-format archive (pg_restore --list inside the postgres image).
    await docker(['cp', path.join(folder, 'database.dump'), `${containerName('postgres')}:/tmp/e2e-list.dump`], { check: true });
    const list = await docker(['exec', containerName('postgres'), 'pg_restore', '--list', '/tmp/e2e-list.dump']);
    await docker(['exec', containerName('postgres'), 'rm', '-f', '/tmp/e2e-list.dump']);
    expect(list.code, list.output.slice(-500)).toBe(0);
    expect(list.stdout).toMatch(/TABLE DATA public (assets|productions)/);
    const media = await bashLine(box, `tar --force-local -tzf "${path.join(folder, 'media.tar.gz').replace(/\\/g, '/')}"`);
    expect(media.stdout, 'the uploaded files are in media.tar.gz').toMatch(/\.jpg\b/);
    expect(media.stdout).toMatch(/\.mp4\b/);
    for (const archive of ['keys', 'caddy_data']) {
      const entries = await bashLine(box, `tar --force-local -tzf "${path.join(folder, `${archive}.tar.gz`).replace(/\\/g, '/')}"`);
      expect(entries.code, entries.output).toBe(0);
      expect(entries.stdout.split('\n').filter(Boolean).length, `${archive}.tar.gz has content`).toBeGreaterThan(1);
      expect(entries.stdout, `${archive}.tar.gz holds no .env`).not.toMatch(/(^|\/)\.env/m);
    }
    const info = fs.readFileSync(path.join(folder, 'backup-info.txt'), 'utf8');
    expect(info).toMatch(new RegExp(`projekt:\\s+${PROJECT}\\s*$`, 'm'));
    expect(info).toMatch(/postgres:\s+17\./);
    expect(fs.readFileSync(path.join(folder, 'SHA256SUMS'), 'utf8'), 'the .env is not part of the backup').not.toContain('.env');
    if (process.platform !== 'win32') expect(fs.statSync(folder).mode & 0o777, 'mode 700').toBe(0o700);
    else test.info().annotations.push({ type: 'skipped-check', description: 'folder mode 700 cannot be read on Windows' });
    void seed;
  });

  test('E2E-OPS-07 [backup.sh] a second run in the same minute gets the suffix -2; --label adds the label', t.disruptive('@p1'), async () => {
    const first = await runBackup();
    expect(first.code, first.output.slice(-800)).toBe(0);
    const firstName = path.basename(newest());
    const second = await runBackup();
    expect(second.code, second.output.slice(-800)).toBe(0);
    const secondName = path.basename(newest());
    // «YYYY-MM-DD_HHMM» is the first backup of a minute, «…-2», «…-3» the following ones (earlier tests of the same
    // minute may already have taken the first numbers).
    const parse = (name: string) => {
      const match = /^(\d{4}-\d{2}-\d{2}_\d{4})(?:-(\d+))?$/.exec(name)!;
      return { minute: match[1]!, number: match[2] ? Number(match[2]) : 1 };
    };
    const a = parse(firstName);
    const b = parse(secondName);
    if (a.minute === b.minute) expect(b.number, `suffix of a second backup within the minute (${firstName} -> ${secondName})`).toBe(a.number + 1);
    else expect(b.minute > a.minute, 'minute rolled over between the runs').toBe(true);
    const labelled = await runBackup(['--label', 'vor-test']);
    expect(labelled.code, labelled.output.slice(-800)).toBe(0);
    expect(path.basename(newest())).toMatch(/^\d{4}-\d{2}-\d{2}_\d{4}_vor-test(-\d+)?$/);
    for (const bad of ['mit leerzeichen', 'a/b', 'x'.repeat(41)]) {
      const refused = await runBackup(['--label', bad]);
      expect(refused.code, `label «${bad}»`).toBe(1);
      expect(refused.stderr).toMatch(/Fehler: --label/);
    }
    expect((await runBackup(['--keep', '0'])).code, '--keep needs a number from 1').toBe(1);
  });

  test('E2E-OPS-07 [backup.sh] --keep 2 leaves only the two newest dated folders', t.disruptive('@p1'), async () => {
    const dir = box.path('keep');
    for (let run = 0; run < 3; run++) {
      const result = await box.run('backup.sh', ['--dir', dir, '--keep', '2']);
      expect(result.code, result.output.slice(-800)).toBe(0);
      await sleep(1100);
    }
    expect(backupFolders(dir), 'two folders remain').toHaveLength(2);
    // A folder that is not a backup of this script is never touched.
    fs.mkdirSync(path.join(dir, 'meine-notizen'));
    const again = await box.run('backup.sh', ['--dir', dir, '--keep', '1']);
    expect(again.code, again.output.slice(-800)).toBe(0);
    expect(backupFolders(dir)).toHaveLength(1);
    expect(fs.existsSync(path.join(dir, 'meine-notizen')), 'foreign folder kept').toBe(true);
  });

  test('E2E-OPS-07 [backup.sh] with PostgreSQL stopped the script refuses with «PostgreSQL läuft nicht» and leaves nothing behind', t.disruptive('@p1'), async () => {
    test.setTimeout(300_000);
    const before = backupFolders().length;
    await dockerCtl.stop('postgres');
    try {
      const result = await runBackup();
      expect(result.code, result.output).toBe(1);
      expect(result.stderr).toMatch(/Fehler: PostgreSQL läuft nicht/);
    } finally {
      await dockerCtl.start('postgres');
    }
    expect(backupFolders().length, 'no folder was created').toBe(before);
  });

  test('E2E-OPS-07 [backup.sh] a backup that fails half way leaves no partial folder and no helper container', t.disruptive('@p1'), async () => {
    const before = fs.existsSync(box.path('backups')) ? fs.readdirSync(box.path('backups')).sort() : [];
    // The archive of the keys volume cannot be written: the dump and media were already taken.
    await box.injectDockerFault(`[ "$1" = exec ] && [[ "$*" == *"tar -czf /tmp/keys.tar.gz"* ]]`, 'E2E: injected tar failure');
    const result = await runBackup();
    box.clearFault();
    expect(result.code, result.output).toBe(1);
    expect(result.stderr).toMatch(/Fehler: Das Archiv für keys konnte nicht erstellt werden/);
    expect(result.stderr).toMatch(/Die unvollständige Sicherung wurde entfernt/);
    const after = fs.existsSync(box.path('backups')) ? fs.readdirSync(box.path('backups')).sort() : [];
    expect(after, 'no partial folder').toEqual(before);
    const helpers = await docker(['ps', '-a', '--filter', `label=com.docker.compose.project=${PROJECT}`, '--filter', 'label=com.docker.compose.service=toolbox', '-q']);
    expect(helpers.stdout.trim(), 'the toolbox container is removed').toBe('');
    const leftover = await docker(['exec', containerName('postgres'), 'ls', '/tmp']);
    expect(leftover.stdout, 'the temporary dump is removed from the postgres container').not.toContain('studioflow-backup.dump');
    test.info().annotations.push({ type: 'not-automated', description: 'a backup killed with SIGINT/SIGTERM cannot be sent on Windows (Node can only terminate the process); the failing-step variant above exercises the same EXIT trap' });
  });
});

test.describe('OPS restore', () => {
  test('E2E-OPS-08 [restore.sh] round trip on the running stack: state, devices, assets, output URL, session and certificate come back; a safety backup is written first', t.disruptive('@p0'), async ({ config, api, production, pairContext }) => {
    test.setTimeout(900_000);
    const seed = await seedWorld(api, production, pairContext);
    const backup = await runBackup();
    expect(backup.code, backup.output.slice(-800)).toBe(0);
    const folder = newest();

    // Change everything the backup holds.
    await api.updateScene(production.id, production.sceneIds[0]!, { name: 'Verändert' });
    await api.deleteDevice(production.id, seed.devices[1]!.id);
    await api.deleteAsset(production.id, seed.assets[1]!.id);
    await api.resetBroadcast(production.id);
    const rotated = (await api.regenerateOutputKey(production.id)).body.url;
    expect(rotated).not.toBe(seed.outputUrl);
    const foldersBefore = backupFolders();

    const restore = await box.run('restore.sh', [folder, '--yes']);
    expect(restore.code, restore.output.slice(-2500)).toBe(0);
    test.info().annotations.push({ type: 'measurement', description: `restore.sh took ${restore.durationMs} ms` });
    expect(restore.stdout).toMatch(/Prüfsummen in Ordnung/);
    expect(restore.stdout).toMatch(/Wiederherstellung abgeschlossen/);
    await ensureHealthy();

    const safety = backupFolders().filter((name) => !foldersBefore.includes(name));
    expect(safety.some((name) => name.includes('_vor-restore')), `a «vor-restore» safety backup of the current state exists (new folders: ${safety.join(', ')})`).toBe(true);
    await expectRestored(seed, api);
    // The mutated state is gone: the device and the asset are back, the old key is valid again, the rotated one is not.
    const snapshot = (await api.getSnapshot(production.id)).body;
    expect(snapshot.devices.map((device) => device.id).sort()).toEqual(seed.devices.map((device) => device.id).sort());
    expect(snapshot.scenes[0]!.name).toBe('Begrüssung');
    const rotatedKey = new URL(rotated).searchParams.get('k')!;
    expect((await new OutputApi(config.baseURL, production.slug, rotatedKey).getOutputSnapshot()).status, 'the key from after the backup is rejected').toBe(403);
  });

  test('E2E-OPS-08 [restore.sh] after `docker compose down -v` the restore rebuilds everything from the backup (fresh volumes, no safety backup)', t.disruptive('@p0'), async ({ api, production, pairContext }) => {
    test.setTimeout(900_000);
    const seed = await seedWorld(api, production, pairContext);
    const backup = await runBackup(['--label', 'vor-down']);
    expect(backup.code, backup.output.slice(-800)).toBe(0);
    const folder = newest();
    const foldersBefore = backupFolders();

    await compose(['down', '-v'], { check: true, timeoutMs: 300_000 });
    const volumes = await docker(['volume', 'ls', '--filter', `label=com.docker.compose.project=${PROJECT}`, '-q']);
    expect(volumes.stdout.trim(), 'down -v removes all volumes').toBe('');

    const restore = await box.run('restore.sh', [folder, '--yes', '--no-safety-backup']);
    expect(restore.code, restore.output.slice(-2500)).toBe(0);
    await ensureHealthy();
    expect(backupFolders(), '--no-safety-backup writes no extra backup').toEqual(foldersBefore);
    await expectRestored(seed, api);
  });

  test('E2E-OPS-08 [restore.sh] a flipped byte in database.dump aborts on the checksum before anything is touched', t.disruptive('@p0'), async ({ api, production, pairContext }) => {
    test.setTimeout(600_000);
    const seed = await seedWorld(api, production, pairContext);
    expect((await runBackup()).code).toBe(0);
    const copy = box.path('flipped');
    fs.cpSync(newest(), copy, { recursive: true });
    const dump = fs.readFileSync(path.join(copy, 'database.dump'));
    dump[Math.floor(dump.length / 2)] ^= 0xff;
    fs.writeFileSync(path.join(copy, 'database.dump'), dump);

    const apiBefore = await inspectService('api');
    const result = await box.run('restore.sh', [copy, '--yes']);
    expect(result.code, result.output).toBe(1);
    expect(result.stderr).toMatch(/Fehler: Prüfsumme stimmt nicht: database\.dump/);
    const apiAfter = await inspectService('api');
    expect(apiAfter?.startedAt, 'the API was not touched').toBe(apiBefore?.startedAt);
    expect(stable((await api.getSnapshot(production.id)).body), 'the state is unchanged').toEqual(seed.snapshot);
  });

  test('E2E-OPS-08 [restore.sh] a corrupted dump with a matching checksum fails in pg_restore; the existing database stays intact and the stack is started again', t.disruptive('@p0'), async ({ api, production, pairContext }) => {
    test.setTimeout(600_000);
    const seed = await seedWorld(api, production, pairContext);
    expect((await runBackup()).code).toBe(0);
    const copy = box.path('corrupt');
    fs.cpSync(newest(), copy, { recursive: true });
    const dump = fs.readFileSync(path.join(copy, 'database.dump'));
    fs.writeFileSync(path.join(copy, 'database.dump'), dump.subarray(0, Math.floor(dump.length / 2)));
    // Make the checksum match the damaged file.
    const sums = fs.readFileSync(path.join(copy, 'SHA256SUMS'), 'utf8').split('\n').map((line) => (line.endsWith('database.dump') ? `${sha256(fs.readFileSync(path.join(copy, 'database.dump')))}  database.dump` : line));
    fs.writeFileSync(path.join(copy, 'SHA256SUMS'), sums.join('\n'));

    const result = await box.run('restore.sh', [copy, '--yes', '--no-safety-backup']);
    expect(result.code, result.output.slice(-1500)).toBe(1);
    expect(result.stderr).toMatch(/Fehler: pg_restore ist fehlgeschlagen/);
    expect(result.stderr).toMatch(/bisherige Datenbank ist unverändert/);
    await ensureHealthy();
    expect(stable((await api.getSnapshot(production.id)).body), 'the existing database is intact').toEqual(seed.snapshot);
    const databases = await psql("select string_agg(datname, ',' order by datname) from pg_database where datname like 'studioflow%'");
    expect(databases, 'no half-restored database is left behind').toBe('studioflow');
  });

  test('E2E-OPS-08 [restore.sh] without --yes the script asks and, without a terminal, aborts changing nothing', t.disruptive('@p1'), async ({ api, production, pairContext }) => {
    test.setTimeout(300_000);
    const seed = await seedWorld(api, production, pairContext);
    expect((await runBackup()).code).toBe(0);
    const apiBefore = await inspectService('api');
    const result = await box.run('restore.sh', [newest()], { timeoutMs: 120_000 });
    expect(result.code, result.output).toBe(1);
    expect(result.stderr).toMatch(/Abgebrochen, nichts geändert/);
    expect((await inspectService('api'))?.startedAt).toBe(apiBefore?.startedAt);
    expect(stable((await api.getSnapshot(production.id)).body)).toEqual(seed.snapshot);
  });

  test('E2E-OPS-08 [restore.sh] while a broadcast is live the restore is blocked unless --force', t.disruptive('@p0'), async ({ config, api, production, pairContext }) => {
    test.setTimeout(900_000);
    const seed = await seedWorld(api, production, pairContext);
    expect((await runBackup()).code).toBe(0);
    const folder = newest();
    await api.resetBroadcast(production.id);
    expect((await api.startBroadcast(production.id)).status).toBe(200);
    const apiBefore = await inspectService('api');

    const blocked = await box.run('restore.sh', [folder, '--yes', '--no-safety-backup']);
    expect(blocked.code, blocked.output).toBe(1);
    expect(blocked.stderr).toMatch(/Fehler: Eine Sendung ist LIVE/);
    expect((await inspectService('api'))?.startedAt, 'nothing was stopped').toBe(apiBefore?.startedAt);
    expect((await new AdminApi(config.baseURL, api.cookie).getSnapshot(production.id)).body.production.broadcast).toBe('live');

    const forced = await box.run('restore.sh', [folder, '--yes', '--no-safety-backup', '--force']);
    expect(forced.code, forced.output.slice(-1500)).toBe(0);
    expect(forced.stderr).toMatch(/Eine Sendung ist LIVE\. Die Wiederherstellung wird wegen --force trotzdem ausgeführt/);
    await ensureHealthy();
    await expectRestored(seed, api);
  });

  test('E2E-OPS-08 [restore.sh] invalid calls: no folder, a missing folder, a folder without checksums', t.disruptive('@p2'), async () => {
    const none = await box.run('restore.sh', ['--yes']);
    expect(none.code).toBe(1);
    expect(none.stderr).toMatch(/Fehler: Sicherungsordner fehlt/);
    const missing = await box.run('restore.sh', [box.path('gibt-es-nicht'), '--yes']);
    expect(missing.code).toBe(1);
    expect(missing.stderr).toMatch(/Fehler: Ordner nicht gefunden/);
    fs.mkdirSync(box.path('leer'));
    const empty = await box.run('restore.sh', [box.path('leer'), '--yes']);
    expect(empty.code).toBe(1);
    expect(empty.stderr).toMatch(/Fehler: SHA256SUMS fehlt/);
    const unknown = await box.run('restore.sh', ['--bogus']);
    expect(unknown.code).toBe(1);
    expect(unknown.stderr).toMatch(/Fehler: Unbekannte Option/);
  });
});
