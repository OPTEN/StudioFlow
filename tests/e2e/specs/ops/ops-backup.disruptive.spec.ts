import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ProductionSnapshot } from '../../../../packages/scene-model/src/contracts';
import { AdminApi, CUT, OutputApi } from '../../support/api';
import { stackConfig } from '../../support/env';
import { expect, test } from '../../support/fixtures';
import { generateSamples } from '../../support/media-samples';
import { backupCommand, backupFolders, backupJob, backupShell, backupStatusFile, certSerial, parseBackupList, type RunOptions } from '../../support/ops';
import { pairPhone, type PairContext, type PairedDevice, type Production } from '../../support/production';
import { sleep, waitUntil } from '../../support/shell';
import { eventually } from '../../support/sim';
import { SyncClient } from '../../support/sync-client';
import { compose, containerName, docker, ensureHealthy, inspectService, tryFetch } from '../../support/stack';
import { t } from '../../support/tags';

/**
 * OPS - backups and restores as commands of the backup image (docs/testing.md E2E-OPS-07, -08, -23 to -29, -37): the
 * same `docker compose run --rm backup ...` on Linux, macOS and Windows, no script on the host. The backup service is
 * part of the stack; its schedule and its off-site target come from the server settings (the API writes them into a
 * volume). A restore needs the API stopped: there is no Docker socket, so the operator stops the three services first.
 */

test.describe.configure({ mode: 'serial' });

const NAME = /^\d{4}-\d{2}-\d{2}_\d{4}_(auto|manual|pre-restore)(-\d+)?$/;
const sha256 = (data: Buffer | string) => crypto.createHash('sha256').update(data).digest('hex');
const sh = (script: string, options: RunOptions = {}) => backupShell(script, options);

test.afterEach(async () => {
  test.setTimeout(420_000);
  await compose(['up', '-d', '--wait', '--wait-timeout', '240'], { timeoutMs: 300_000 });
  await ensureHealthy();
});

/** The complete backup folders (with SHA256SUMS) of the backups volume, oldest first. */
async function completeBackups(): Promise<string[]> {
  const result = await sh('for d in /backups/*/; do [ -f "$d/SHA256SUMS" ] && basename "$d"; done; true', { check: true });
  return result.stdout.split(/\s+/).filter((name) => NAME.test(name)).sort();
}

/** Runs `backup-now` and returns the name of the folder it made. */
async function backUpNow(): Promise<string> {
  const result = await backupCommand(['backup-now']);
  expect(result.code, result.output.slice(-1500)).toBe(0);
  const name = /Backing up to \/backups\/(\S+)/.exec(result.stdout)?.[1];
  expect(name, `the folder name in the output:\n${result.stdout.slice(0, 600)}`).toMatch(NAME);
  return name!;
}

async function psql(sql: string): Promise<string> {
  const result = await docker(['exec', containerName('postgres'), 'psql', '-U', 'studioflow', '-d', 'studioflow', '-tAc', sql], { check: true });
  return result.stdout.trim();
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
  await production.seed(['Welcome', 'Presentation', 'Break', 'Interview', 'Wrap-up']);
  const devices = [await pairPhone(pairContext, { name: 'Phone One' }), await pairPhone(pairContext, { name: 'Phone Two' })];
  await api.addSceneItem(production.id, production.sceneIds[0]!, { source: devices[0]!.sourceId() });
  await api.addSceneItem(production.id, production.sceneIds[1]!, { source: devices[1]!.sourceId() });
  const assets: Seed['assets'] = [];
  for (const file of [
    { fileName: 'image.jpg', contentType: 'image/jpeg', data: samples.photoJpg },
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
async function expectRestored(seed: Seed, api: AdminApi, options: { certificate?: boolean } = {}): Promise<void> {
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
  if (options.certificate !== false) expect(await certSerial(), 'the Caddy certificate is the old one').toBe(seed.cert);
  expect(Number(await psql('select count(*) from audit_entries')), 'audit rows present').toBeGreaterThanOrEqual(seed.audit);
}

/** What a restore asks for first: nobody but the backup service holds the database and the volumes. */
async function stopServing(): Promise<void> {
  await compose(['stop', 'caddy', 'api', 'livekit'], { check: true, timeoutMs: 240_000 });
}

async function startServing(): Promise<void> {
  await compose(['up', '-d', '--wait', '--wait-timeout', '240'], { check: true, timeoutMs: 300_000 });
  await ensureHealthy();
}

test.describe('OPS backup now', () => {
  test('E2E-OPS-07 [backup-now] a backup of the running stack is complete, verifiable and does not disturb the Regie', t.disruptive('@p0'), async ({ config, api, production, pairContext, onCleanup }) => {
    test.setTimeout(420_000);
    const seed = await seedWorld(api, production, pairContext);
    await api.resetBroadcast(production.id);
    const regie = await SyncClient.connect(config.baseURL, api.cookie, production.id);
    onCleanup(() => regie.stop());

    // The Regie switches scenes while the backup runs.
    const latencies: number[] = [];
    let finished = false;
    const backup = backupCommand(['backup-now']).finally(() => (finished = true));
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
    const name = /Backing up to \/backups\/(\S+)/.exec(result.stdout)?.[1]!;
    expect(name, 'a manual backup carries its label').toMatch(/^\d{4}-\d{2}-\d{2}_\d{4}_manual(-\d+)?$/);
    latencies.sort((a, b) => a - b);
    const p95 = latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))]!;
    test.info().annotations.push({ type: 'measurement', description: `backup-now took ${result.durationMs} ms; ${latencies.length} switches during it, p95 ${p95} ms, max ${latencies.at(-1)} ms` });
    expect(latencies.length, 'switches were made while the backup ran').toBeGreaterThanOrEqual(3);
    expect(p95, 'switch latency during the backup stays within T-SWITCH p95 (300 ms) + 100 ms').toBeLessThanOrEqual(400);

    // Content of the folder: the media are copied incrementally next to the dated folders, not archived again.
    const files = (await sh(`ls -1 /backups/${name}`, { check: true })).stdout.split(/\s+/).filter(Boolean).sort();
    expect(files).toEqual(['SHA256SUMS', 'backup-info.txt', 'caddy_data.tar.gz', 'database.dump', 'keys.tar.gz']);
    const sums = await sh(`cd /backups/${name} && sha256sum -c SHA256SUMS`, { check: true });
    expect(sums.stdout.match(/: OK/g)?.length, 'all four checksums verify').toBe(4);
    const list = await sh(`pg_restore --list /backups/${name}/database.dump`);
    expect(list.code, list.output.slice(-500)).toBe(0);
    expect(list.stdout).toMatch(/TABLE DATA public (assets|productions)/);
    expect(list.stdout, 'the server settings are part of the dump').toMatch(/TABLE DATA public server_settings/);
    const media = await sh('find /backups/media -type f | sed "s/.*\\.//" | sort | uniq', { check: true });
    expect(media.stdout, 'the uploaded files are in the incremental copy').toMatch(/jpg/);
    expect(media.stdout).toMatch(/mp4/);
    for (const archive of ['keys', 'caddy_data']) {
      const entries = await sh(`tar -tzf /backups/${name}/${archive}.tar.gz`, { check: true });
      expect(entries.stdout.split('\n').filter(Boolean).length, `${archive}.tar.gz has content`).toBeGreaterThan(1);
      expect(entries.stdout, `${archive}.tar.gz holds no .env and no secret file`).not.toMatch(/(^|\/)(\.env|postgres-password|livekit-api-secret)/m);
    }
    const info = (await sh(`cat /backups/${name}/backup-info.txt`, { check: true })).stdout;
    expect(info).toMatch(/postgres:\s+17\./);
    expect((await sh(`stat -c %a /backups/${name}`, { check: true })).stdout.trim(), 'folder mode 700').toBe('700');
    expect((await sh(`ls -la /backups/${name} | grep -c secrets; true`)).stdout.trim(), 'the secrets volume is not part of a backup').toBe('0');

    // `list` shows it, `restore --verify` accepts it and leaves no throwaway database behind.
    expect(parseBackupList((await backupCommand(['list'], { check: true })).stdout), 'list').toContain(name);
    const verify = await backupCommand(['restore', name, '--verify']);
    expect(verify.code, verify.output.slice(-1500)).toBe(0);
    expect(verify.stdout).toMatch(/Checksums OK/);
    expect(verify.stdout).toMatch(/Dump loaded: \d+ tables, newest migration/);
    expect(verify.stdout).toMatch(/Backup verified/);
    expect(await psql("select count(*) from pg_database where datname like 'studioflow_verify'"), 'the throwaway database is gone').toBe('0');
    // The Regie sees it (status file of the backup service) and the API's list too.
    await waitUntil('the backup in the list of the API', async () => (await api.listBackups()).body.backups.some((entry) => entry.name === name), { timeoutMs: 30_000, intervalMs: 1000 });
    void seed;
  });

  test('E2E-OPS-07 [backup-now] a second run in the same minute gets the suffix -2', t.disruptive('@p1'), async () => {
    const first = await backUpNow();
    const second = await backUpNow();
    const parse = (name: string) => {
      const match = /^(\d{4}-\d{2}-\d{2}_\d{4})_manual(?:-(\d+))?$/.exec(name)!;
      return { minute: match[1]!, number: match[2] ? Number(match[2]) : 1 };
    };
    const a = parse(first);
    const b = parse(second);
    if (a.minute === b.minute) expect(b.number, 'the second backup of a minute carries a higher number').toBeGreaterThan(a.number);
    else expect(b.number, 'a new minute starts again').toBe(1);
    expect(await completeBackups()).toEqual(expect.arrayContaining([first, second]));
  });

  test('E2E-OPS-07 [backup-now] with PostgreSQL stopped the command fails with a reason and leaves nothing behind', t.disruptive('@p1'), async () => {
    test.setTimeout(300_000);
    const before = await backupFolders();
    await compose(['stop', 'caddy', 'api', 'postgres'], { check: true, timeoutMs: 240_000 });
    const result = await backupCommand(['backup-now'], { noDeps: true });
    expect(result.code, result.output).not.toBe(0);
    expect(result.stderr + result.stdout).toMatch(/pg_dump failed|could not translate|Connection refused|server closed|not accepting connections/i);
    await compose(['up', '-d', '--wait', '--wait-timeout', '240'], { check: true, timeoutMs: 300_000 });
    expect(await backupFolders(), 'no partial folder').toEqual(before);
  });

  test('E2E-OPS-07 [backup-now] a failed run is recorded, leaves no partial folder and shows in the readiness check until a run succeeds', t.disruptive('@p0'), async ({ api }) => {
    test.setTimeout(420_000);
    // The readiness check reports on automatic backups, so they must be on (a schedule that does not fire during the test).
    const settings = { timezone: 'Europe/Zurich', keepDaily: 7, keepWeekly: 4, ageRecipients: [], offsiteUnencrypted: false };
    expect((await api.updateBackupSettings({ schedule: '0 3 * * *', ...settings })).status).toBe(200);
    try {
      await waitUntil('the backup service follows the settings', async () => (await api.getServerSettingsStatus()).body.backup.applied, { timeoutMs: 60_000, intervalMs: 1000 });
      const before = await backupFolders();
      const failed = await backupJob(['--label', 'auto', '--now'], { containerEnv: { PGPASSWORD: 'wrong' } });
      expect(failed.code, failed.output).toBe(1);
      expect(failed.stderr).toMatch(/Error: pg_dump failed/);
      expect(await backupFolders(), 'no partial folder').toEqual(before);
      const recorded = await backupStatusFile();
      expect(recorded.lastAttempt?.ok).toBe(false);
      expect(recorded.lastAttempt?.message).toBe('pg_dump failed.');
      const ready = async () => (await tryFetch(`${stackConfig().apiDirect}/health/ready`))?.text();
      expect(await ready()).toContain('The last backup run failed: pg_dump failed.');
      expect((await api.listBackups()).body.lastError).toContain('pg_dump failed');

      await backUpNow();
      expect(await ready(), 'the next successful run clears the failure').not.toContain('failed');
      expect((await backupStatusFile()).lastAttempt?.ok).toBe(true);
    } finally {
      await api.updateBackupSettings({ schedule: null, ...settings });
    }
  });
});

test.describe('OPS verify', () => {
  test('E2E-OPS-24 [restore --verify] detects a tampered file, a dump that does not load and an incomplete folder', t.disruptive('@p0'), async () => {
    test.setTimeout(420_000);
    const name = await backUpNow();
    const stage = async (copy: string, script = ':') => (await sh(`rm -rf /backups/${copy} && cp -a /backups/${name} /backups/${copy} && cd /backups/${copy} && ${script}`, { check: true }));
    const apiBefore = await inspectService('api');
    try {
      await stage('tamper-flipped', "printf '\\377' | dd of=database.dump bs=1 seek=100 count=1 conv=notrunc 2>/dev/null");
      const tampered = await backupCommand(['restore', 'tamper-flipped', '--verify']);
      expect(tampered.code, tampered.output).toBe(1);
      expect(tampered.stderr).toMatch(/Error: Checksum mismatch: database\.dump/);

      await stage('tamper-archive', 'printf x >>keys.tar.gz');
      expect((await backupCommand(['restore', 'tamper-archive', '--verify'])).stderr, 'every file of SHA256SUMS counts, not only the dump').toMatch(/Error: Checksum mismatch: keys\.tar\.gz/);

      // A broken dump whose checksum was rewritten: only loading it shows the damage.
      // (the library of the image is written for bash, the shell of the one-off container is not)
      await stage(
        'tamper-broken',
        `bash -c '. /opt/backup/common.sh; . /opt/backup/backup-core.sh; head -c 300 database.dump >d.tmp && mv d.tmp database.dump && sf_backup_write_checksums "$PWD" database.dump keys.tar.gz caddy_data.tar.gz backup-info.txt'`,
      );
      const unloadable = await backupCommand(['restore', 'tamper-broken', '--verify']);
      expect(unloadable.code, unloadable.output).toBe(1);
      expect(unloadable.stderr).toMatch(/The dump could not be loaded/);
      expect(await psql("select count(*) from pg_database where datname like 'studioflow_verify'"), 'no throwaway database is left behind').toBe('0');

      await stage('tamper-incomplete', 'rm SHA256SUMS');
      expect((await backupCommand(['restore', 'tamper-incomplete', '--verify'])).stderr).toMatch(/Error: SHA256SUMS is missing/);
    } finally {
      await sh('rm -rf /backups/tamper-*');
    }
    expect((await inspectService('api'))?.startedAt, '--verify never stops anything').toBe(apiBefore?.startedAt);
  });
});

test.describe('OPS restore', () => {
  test('E2E-OPS-08 [restore] round trip: refused while the API runs; with it stopped the state, devices, assets, output URL, session and certificate come back; a safety backup is written first', t.disruptive('@p0'), async ({ config, api, production, pairContext }) => {
    test.setTimeout(900_000);
    const seed = await seedWorld(api, production, pairContext);
    const name = await backUpNow();

    // Change everything the backup holds.
    await api.updateScene(production.id, production.sceneIds[0]!, { name: 'Changed' });
    await api.deleteDevice(production.id, seed.devices[1]!.id);
    await api.deleteAsset(production.id, seed.assets[1]!.id);
    await api.resetBroadcast(production.id);
    const rotated = (await api.regenerateOutputKey(production.id)).body.url;
    expect(rotated).not.toBe(seed.outputUrl);
    const foldersBefore = await completeBackups();

    // The API is running: the command says what to do first and changes nothing.
    const refused = await backupCommand(['restore', name, '--yes']);
    expect(refused.code, refused.output).toBe(1);
    expect(refused.stderr).toMatch(/The API is running/);
    expect(refused.stderr).toMatch(/docker compose stop caddy api livekit/);
    expect((await api.getSnapshot(production.id)).body.scenes[0]!.name, 'nothing was changed').toBe('Changed');

    await stopServing();
    const restore = await backupCommand(['restore', name, '--yes']);
    expect(restore.code, restore.output.slice(-2500)).toBe(0);
    test.info().annotations.push({ type: 'measurement', description: `restore took ${restore.durationMs} ms` });
    expect(restore.stdout).toMatch(/Checksums OK/);
    expect(restore.stdout).toMatch(/Restore complete/);
    expect(restore.stdout, 'the media come from the incremental copy').toMatch(/Volume media from the incremental copy/);
    await startServing();

    const safety = (await completeBackups()).filter((entry) => !foldersBefore.includes(entry));
    expect(safety.some((entry) => entry.includes('_pre-restore')), `a "pre-restore" safety backup of the current state exists (new folders: ${safety.join(', ')})`).toBe(true);
    await expectRestored(seed, api);
    // The mutated state is gone: the device and the asset are back, the old key is valid again, the rotated one is not.
    const snapshot = (await api.getSnapshot(production.id)).body;
    expect(snapshot.devices.map((device) => device.id).sort()).toEqual(seed.devices.map((device) => device.id).sort());
    expect(snapshot.scenes[0]!.name).toBe('Welcome');
    const rotatedKey = new URL(rotated).searchParams.get('k')!;
    expect((await new OutputApi(config.baseURL, production.slug, rotatedKey).getOutputSnapshot()).status, 'the key from after the backup is rejected').toBe(403);
  });

  test('E2E-OPS-08 [restore] after `docker compose down -v` the restore rebuilds everything from the backup, copied back into the new volume (fresh volumes, new secrets, no safety backup)', t.disruptive('@p0'), async ({ api, production, pairContext }) => {
    test.setTimeout(900_000);
    const seed = await seedWorld(api, production, pairContext);
    const name = await backUpNow();
    // The operator's copy of the backup: `docker cp` of the folder and of the media copy next to it, off the server.
    const keep = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-restore-'));
    try {
      const backupContainer = containerName('backup');
      await docker(['cp', `${backupContainer}:/backups/${name}`, path.join(keep, name)], { check: true });
      await docker(['cp', `${backupContainer}:/backups/media`, path.join(keep, 'media')], { check: true });
      const oldSecret = (await compose(['exec', '-T', 'api', 'cat', '/secrets/livekit-api-secret'], { check: true })).stdout.trim();

      await compose(['down', '--volumes', '--timeout', '30'], { check: true, timeoutMs: 300_000 });
      await compose(['up', '-d', '--wait', '--wait-timeout', '240'], { check: true, timeoutMs: 300_000 });
      const newSecret = (await compose(['exec', '-T', 'api', 'cat', '/secrets/livekit-api-secret'], { check: true })).stdout.trim();
      expect(newSecret, 'the fresh volumes got new secrets').not.toBe(oldSecret);

      // Put the copy into the new backups volume and restore it: the stack is stopped except for the database.
      await docker(['cp', path.join(keep, name), `${backupContainer}:/backups/${name}`], { check: true });
      await docker(['cp', path.join(keep, 'media'), `${backupContainer}:/backups/media`], { check: true });
      expect(parseBackupList((await backupCommand(['list'], { check: true })).stdout)).toContain(name);
      await stopServing();
      const restore = await backupCommand(['restore', name, '--yes', '--no-safety-backup']);
      expect(restore.code, restore.output.slice(-2500)).toBe(0);
      await startServing();
      // The certificate authority comes back with the backup of caddy_data, so a device that trusts it keeps trusting it.
      await expectRestored(seed, api);
    } finally {
      fs.rmSync(keep, { recursive: true, force: true });
    }
  });

  test('E2E-OPS-08 [restore] a corrupted dump with a matching checksum fails in pg_restore; the existing database stays intact and the stack is started again', t.disruptive('@p0'), async ({ api, production, pairContext }) => {
    test.setTimeout(900_000);
    const seed = await seedWorld(api, production, pairContext);
    const name = await backUpNow();
    await sh(
      `cp -a /backups/${name} /backups/corrupt-1 && cd /backups/corrupt-1 && bash -c '. /opt/backup/common.sh; . /opt/backup/backup-core.sh; head -c 400 database.dump >d.tmp && mv d.tmp database.dump && sf_backup_write_checksums "$PWD" database.dump keys.tar.gz caddy_data.tar.gz backup-info.txt'`,
      { check: true },
    );
    try {
      await stopServing();
      const result = await backupCommand(['restore', 'corrupt-1', '--yes', '--no-safety-backup']);
      expect(result.code, result.output).toBe(1);
      expect(result.stderr).toMatch(/pg_restore failed\. The previous database is unchanged\./);
      expect(await psql("select count(*) from pg_database where datname in ('studioflow_restore', 'studioflow_replaced')"), 'no half-restored database is left').toBe('0');
    } finally {
      await sh('rm -rf /backups/corrupt-1');
    }
    await startServing();
    expect(stable((await api.getSnapshot(production.id)).body)).toEqual(seed.snapshot);
  });

  test('E2E-OPS-08 [restore] without --yes the command asks and, without a terminal, aborts changing nothing', t.disruptive('@p1'), async ({ api, production, pairContext }) => {
    test.setTimeout(600_000);
    const seed = await seedWorld(api, production, pairContext);
    const name = await backUpNow();
    await stopServing();
    const result = await backupCommand(['restore', name], { timeoutMs: 120_000 });
    expect(result.code, result.output).toBe(1);
    expect(result.stderr).toMatch(/Aborted, nothing changed/);
    await startServing();
    expect(stable((await api.getSnapshot(production.id)).body)).toEqual(seed.snapshot);
  });

  test('E2E-OPS-08 [restore] while the database says a broadcast is live the restore is blocked unless --force', t.disruptive('@p0'), async ({ api, production, pairContext }) => {
    test.setTimeout(900_000);
    const seed = await seedWorld(api, production, pairContext);
    const name = await backUpNow();
    await api.resetBroadcast(production.id);
    expect((await api.startBroadcast(production.id)).status).toBe(200);
    await stopServing();

    const blocked = await backupCommand(['restore', name, '--yes', '--no-safety-backup']);
    expect(blocked.code, blocked.output).toBe(1);
    expect(blocked.stderr).toMatch(/The database says that a broadcast is live/);
    expect(await psql("select count(*) from productions where lower(broadcast) = 'live'"), 'nothing was changed').not.toBe('0');

    const forced = await backupCommand(['restore', name, '--yes', '--no-safety-backup', '--force']);
    expect(forced.code, forced.output.slice(-1500)).toBe(0);
    await startServing();
    await expectRestored(seed, api);
  });

  test('E2E-OPS-08 [restore] invalid calls: no folder, a missing folder, a folder without checksums, an unknown option', t.disruptive('@p2'), async () => {
    const none = await backupCommand(['restore', '--yes']);
    expect(none.code).toBe(1);
    expect(none.stderr).toMatch(/Error: Backup missing/);
    const missing = await backupCommand(['restore', 'does-not-exist', '--yes']);
    expect(missing.code).toBe(1);
    expect(missing.stderr).toMatch(/Error: Folder not found/);
    await sh('mkdir -p /backups/empty-1', { check: true });
    try {
      const empty = await backupCommand(['restore', 'empty-1', '--yes']);
      expect(empty.code).toBe(1);
      expect(empty.stderr).toMatch(/Error: SHA256SUMS is missing/);
    } finally {
      await sh('rm -rf /backups/empty-1');
    }
    const unknown = await backupCommand(['restore', '--bogus']);
    expect(unknown.code).toBe(1);
    expect(unknown.stderr).toMatch(/Error: Unknown option/);
    const command = await backupCommand(['frobnicate']);
    expect(command.code).toBe(1);
    expect(command.stderr).toMatch(/Unknown command: frobnicate/);
  });
});

test.describe('OPS automatic backups', () => {
  test.afterEach(async ({ api }) => {
    // Back to the defaults of the wizard: no schedule, no off-site copy, retention 7 and 4.
    await api.updateBackupSettings({ schedule: null, timezone: null, keepDaily: 7, keepWeekly: 4, rcloneRemote: null, rcloneConfig: null, ageRecipients: [], offsiteUnencrypted: false });
  });

  test('E2E-OPS-23 [backup service] a schedule of every minute from the settings creates a complete, verified backup; the status file and the readiness check show it', t.disruptive('@p0'), async ({ api }) => {
    test.setTimeout(420_000);
    const saved = await api.updateBackupSettings({ schedule: '* * * * *', timezone: 'Europe/Zurich', keepDaily: 7, keepWeekly: 4, ageRecipients: [], offsiteUnencrypted: false });
    expect(saved.status, saved.raw.text()).toBe(200);
    await waitUntil('the backup service follows the settings', async () => (await api.getServerSettingsStatus()).body.backup.applied, { timeoutMs: 60_000, intervalMs: 1000 });
    const folder = await waitUntil('an automatic backup', async () => (await completeBackups()).find((name) => name.includes('_auto')), { timeoutMs: 180_000, intervalMs: 3000 });
    const files = (await sh(`ls -1 /backups/${folder}`, { check: true })).stdout.split(/\s+/).filter(Boolean).sort();
    expect(files).toEqual(['SHA256SUMS', 'backup-info.txt', 'caddy_data.tar.gz', 'database.dump', 'keys.tar.gz']);
    const written = await backupStatusFile();
    expect(written.lastAttempt?.ok).toBe(true);
    expect(written.state).toBe('idle');
    expect(written.schedule).toBe('* * * * *');
    const readiness = await tryFetch(`${stackConfig().apiDirect}/health/ready`);
    expect(readiness?.status, 'a warning is not an outage: /health/ready stays 200').toBe(200);
    expect(await readiness?.text()).toMatch(/^Degraded\nbackup: Degraded - No off-site copy is configured/);
    const logs = (await compose(['logs', '--no-color', 'backup'])).output;
    expect(logs).toMatch(/Verified: the dump loads \(\d+ tables, newest migration \d+_\w+\)/);
    expect(logs).toMatch(/Automatic backups: '\* \* \* \* \*' \(time zone Europe\/Zurich\)/);
    // Switching the schedule off in the settings stops the runs.
    expect((await api.updateBackupSettings({ schedule: null, timezone: null, keepDaily: 7, keepWeekly: 4, ageRecipients: [], offsiteUnencrypted: false })).status).toBe(200);
    await waitUntil('the scheduler is off', async () => (await compose(['logs', '--no-color', '--tail', '20', 'backup'])).output.includes('Automatic backups are off'), { timeoutMs: 60_000, intervalMs: 2000 });
  });

  test('E2E-OPS-37 [Back up now] the button of the Server settings (POST /api/settings/backups) makes a manual backup that appears in the list', t.disruptive('@p0'), async ({ api }) => {
    test.setTimeout(300_000);
    const before = await completeBackups();
    const requested = await api.requestBackup();
    expect(requested.status, requested.raw.text()).toBe(202);
    const folder = await waitUntil('a new manual backup', async () => (await completeBackups()).find((name) => name.endsWith('_manual') && !before.includes(name)) ?? (await completeBackups()).find((name) => /_manual-\d+$/.test(name) && !before.includes(name)), { timeoutMs: 120_000, intervalMs: 2000 });
    await waitUntil('the list of the API shows it', async () => (await api.listBackups()).body.backups.some((entry) => entry.name === folder && entry.kind === 'manual'), { timeoutMs: 30_000, intervalMs: 1000 });
    const audit = await psql("select count(*) from audit_entries where action = 'backup.requested'");
    expect(Number(audit), 'the request is in the audit log').toBeGreaterThanOrEqual(1);
    const verify = await backupCommand(['restore', folder, '--verify']);
    expect(verify.code, verify.output.slice(-800)).toBe(0);
  });

  test('E2E-OPS-25 [backup service] retention keeps the newest backup of the last N days and weeks of the automatic folders, removes the others and leaves manual, safety and foreign folders alone', t.disruptive('@p1'), async ({ api }) => {
    test.setTimeout(420_000);
    expect((await api.updateBackupSettings({ schedule: null, timezone: null, keepDaily: 2, keepWeekly: 1, ageRecipients: [], offsiteUnencrypted: false })).status).toBe(200);
    await waitUntil('the backup service follows the settings', async () => (await api.getServerSettingsStatus()).body.backup.applied, { timeoutMs: 60_000, intervalMs: 1000 });
    const old = ['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04', '2026-01-05', '2026-01-06'].map((day) => `${day}_0300_auto`);
    const others = ['2026-01-02_0900_manual', '2026-01-02_1000_pre-restore'];
    try {
      // Automatic backups of earlier tests are named in the time zone of their schedule; the retention orders by name, so
      // start from a volume without them.
      await sh('rm -rf /backups/*_auto', { check: true });
      for (const name of [...old, ...others]) await sh(`mkdir -p /backups/${name} && touch /backups/${name}/SHA256SUMS`, { check: true });
      await sh('mkdir -p /backups/2025-12-31_0300_auto /backups/meine-notizen', { check: true });
      const run = await backupJob(['--label', 'auto', '--now']);
      expect(run.code, run.output.slice(-1500)).toBe(0);

      const remaining = await backupFolders();
      expect(remaining.filter((name) => name.endsWith('_auto') && name.startsWith('2026-01')), 'the newest of the old days stays').toEqual(['2026-01-06_0300_auto']);
      expect((await completeBackups()).filter((name) => name.includes('_auto')).length, 'the new backup and the newest old one').toBe(2);
      for (const name of others) expect(remaining, `${name} is not an automatic backup: the retention leaves it alone`).toContain(name);
      expect(remaining, 'a folder that is not a backup is never touched').toContain('meine-notizen');
      expect(remaining, 'an unfinished folder of a killed run (no SHA256SUMS) is removed').not.toContain('2025-12-31_0300_auto');
    } finally {
      await sh(`rm -rf ${[...old, ...others, 'meine-notizen'].map((name) => `/backups/${name}`).join(' ')}`);
    }
  });

  test('E2E-OPS-26 [backup service] no scheduled backup is taken while a broadcast is live; it runs when the broadcast has ended', t.disruptive('@p0'), async ({ api, production }) => {
    test.setTimeout(420_000);
    const before = await completeBackups();
    expect((await api.startBroadcast(production.id)).status).toBe(200);
    try {
      const run = backupJob(['--label', 'auto'], { containerEnv: { BACKUP_LIVE_POLL_SECONDS: '2' } });
      await waitUntil('the backup is postponed', async () => (await backupStatusFile()).state === 'postponed', { timeoutMs: 60_000, intervalMs: 1000 });
      await sleep(5000);
      expect(await completeBackups(), 'nothing is backed up during the broadcast').toEqual(before);
      expect((await backupStatusFile()).postponedSince).toBeTruthy();
      expect((await api.listBackups()).body.postponed, 'the Regie shows that a backup waits').toBe(true);

      expect((await api.endBroadcast(production.id)).status).toBe(200);
      const finished = await run;
      expect(finished.code, finished.output).toBe(0);
      expect(finished.stdout).toContain('A broadcast is live: the backup is postponed');
      // The retention keeps one backup per day, so an earlier automatic backup of today may go: look for the new folder.
      const created = (await completeBackups()).filter((name) => !before.includes(name));
      expect(created, 'the backup ran after the end of the broadcast').toHaveLength(1);
      expect(created[0]).toContain('_auto');
      const after = await backupStatusFile();
      expect(after.state).toBe('idle');
      expect(after.postponedSince).toBeNull();
    } finally {
      await api.resetBroadcast(production.id);
    }
  });

  test('E2E-OPS-28 [backup service] the off-site copy is encrypted with age, copies media only once; restore from it needs the private key only; a remote without an age key is refused by the settings', t.disruptive('@p1'), async ({ api, production }) => {
    test.setTimeout(600_000);
    // The key pair is made as an operator would make it: the server only ever sees the public key.
    const generated = await compose(['run', '--rm', '-T', '--entrypoint', 'age-keygen', 'backup'], { check: true });
    const recipient = /age1[a-z0-9]+/.exec(generated.output)![0];
    const identity = /AGE-SECRET-KEY-[A-Z0-9]+/.exec(generated.output)![0];
    const target = '/backups/offsite-target';
    // A local directory plays the remote: rclone treats it like S3 or SFTP, so the copy logic is the same.
    const refused = await api.updateBackupSettings({ schedule: null, keepDaily: 7, keepWeekly: 4, rcloneRemote: `offsite:${target}`, rcloneConfig: '[offsite]\ntype = local\n', ageRecipients: [], offsiteUnencrypted: false });
    expect(refused.status, 'a remote without an age key').toBe(400);
    expect(JSON.stringify(refused.body)).toContain('age_recipient_required');
    const saved = await api.updateBackupSettings({ schedule: null, keepDaily: 1, keepWeekly: 1, rcloneRemote: `offsite:${target}`, rcloneConfig: '[offsite]\ntype = local\n', ageRecipients: [recipient], offsiteUnencrypted: false });
    expect(saved.status, saved.raw.text()).toBe(200);
    expect(JSON.stringify(saved.body), 'the settings never return the rclone configuration').not.toContain('type = local');
    await waitUntil('the backup service follows the settings', async () => (await api.getServerSettingsStatus()).body.backup.applied, { timeoutMs: 60_000, intervalMs: 1000 });

    const samples = await generateSamples();
    const uploaded = await api.uploadAsset(production.id, { fileName: 'image.jpg', contentType: 'image/jpeg', data: samples.photoJpg });
    expect(uploaded.status).toBe(201);
    try {
      // Automatic backups (what the schedule starts): only these are pruned at the target, manual ones stay.
      const first = await backupJob(['--label', 'auto', '--now']);
      expect(first.code, first.output.slice(-1500)).toBe(0);
      expect(first.stdout).toContain('Off-site copy (encrypted with age)');
      expect(first.stdout).toMatch(/Uploaded media\/.+\.jpg/);
      const second = await backupJob(['--label', 'auto', '--now']);
      expect(second.code, second.output.slice(-1500)).toBe(0);
      expect(second.stdout, 'media that are already at the target are not uploaded again').not.toContain('Uploaded media/');
      const state = await backupStatusFile();
      expect(state.offsite.configured).toBe(true);
      expect(state.offsite.encrypted).toBe(true);
      expect(state.offsite.lastSuccess?.name).toBe(state.lastSuccess?.name);
      const readiness = await tryFetch(`${stackConfig().apiDirect}/health/ready`);
      expect(await readiness?.text(), 'with an off-site copy the readiness check is happy').toBe('Healthy');

      // What is at the target: encrypted files only (plus the checksum list).
      const remote = (await sh(`find ${target} -type f`, { check: true })).stdout.split('\n').filter(Boolean).sort();
      expect(remote.filter((file) => !file.endsWith('.age') && !file.endsWith('/SHA256SUMS')), 'nothing is stored unencrypted').toEqual([]);
      const dated = [...new Set(remote.map((file) => file.split('/')[3]!).filter((entry) => NAME.test(entry)))];
      expect(dated.length, 'the retention (1 daily, 1 weekly) keeps one dated folder at the target').toBe(1);
      const media = remote.filter((file) => file.includes('/media/') && file.includes(uploaded.body.id));
      expect(media, 'the uploaded file is there once, encrypted').toHaveLength(1);

      // The way back with the private key only: decrypt the dump and the media file, check the dump loads.
      const decrypt = await sh(
        `printf '%s\\n' "$AGE_IDENTITY" >/tmp/key && cd ${target}/${dated[0]} && age -d -i /tmp/key -o /tmp/database.dump database.dump.age && pg_restore --list /tmp/database.dump | grep -c 'TABLE DATA' && age -d -i /tmp/key -o /tmp/media.jpg ${media[0]} && sha256sum /tmp/media.jpg | cut -d' ' -f1`,
        { containerEnv: { AGE_IDENTITY: identity } },
      );
      expect(decrypt.code, decrypt.output).toBe(0);
      expect(decrypt.stdout.trim().split('\n').at(-1), 'the media file decrypts to the uploaded bytes').toBe(sha256(samples.photoJpg));
    } finally {
      await api.deleteAsset(production.id, uploaded.body.id);
      await sh(`rm -rf ${target}`);
    }
  });
});

