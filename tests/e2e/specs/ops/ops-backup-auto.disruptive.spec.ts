import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { AdminApi } from '../../support/api';
import { imageNameOf, stackConfig, volumeNameOf } from '../../support/env';
import { expect, test } from '../../support/fixtures';
import { generateSamples } from '../../support/media-samples';
import { OpsSandbox } from '../../support/ops';
import { compose, containerName, docker, ensureHealthy, recreateApi, tryFetch } from '../../support/stack';
import { exec, sleep, waitUntil } from '../../support/shell';
import { t } from '../../support/tags';

/**
 * OPS - automatic backups (docs/testing.md E2E-OPS-23 to -27, issue 16): the backup service of the profile `backup` on the
 * running stack. The service is started per test with the settings the test needs and removed afterwards, together with
 * its volumes; the API is recreated without the schedule, so the other specs see the stack as before.
 */

let box: OpsSandbox;
/** The "remote" of the off-site tests: a folder in the backups volume (docker cp cannot read the tmpfs of the container). */
const TARGET = '/backups/offsite-target';
const AUTO =/^\d{4}-\d{2}-\d{2}_\d{4}_auto(-\d+)?$/;
const sha256 = (data: Buffer | string) => crypto.createHash('sha256').update(data).digest('hex');

test.describe.configure({ mode: 'serial' });

test.beforeAll(() => {
  box = OpsSandbox.create('backup-auto');
});

test.afterAll(async () => {
  await stopBackup();
  await box.cleanup();
});

test.afterEach(async () => {
  test.setTimeout(420_000);
  await ensureHealthy();
});

/** Starts the backup service (and recreates the API so it sees the schedule) with these settings, on fresh volumes. */
async function startBackup(settings: Record<string, string> = {}): Promise<void> {
  await stopBackup(false);
  const env = { ...process.env, BACKUP_SCHEDULE: '0 3 * * *', BACKUP_LIVE_POLL_SECONDS: '3', ...settings };
  const result = await compose(['up', '-d', '--build', '--force-recreate', '--wait', '--wait-timeout', '240', 'backup', 'api'], { profiles: ['backup'], env, timeoutMs: 600_000 });
  expect(result.code, result.output.slice(-1500)).toBe(0);
  await ensureHealthy();
}

/** Removes the service and its volumes; the API mounts the status volume, so it is removed as well and (by default) started again. */
async function stopBackup(recreate = true): Promise<void> {
  await compose(['rm', '-sf', 'backup', 'api'], { profiles: ['backup'] });
  await docker(['volume', 'rm', '-f', volumeNameOf('backups'), volumeNameOf('backup_status')]);
  if (recreate) await recreateApi();
}

const inBackup = (args: string[], options: { env?: string[]; input?: string } = {}) =>
  docker(['exec', ...(options.env ?? []).flatMap((entry) => ['-e', entry]), '-i', containerName('backup'), ...args], { input: options.input ?? '' });
const runJob = (env: string[] = []) => inBackup(['/opt/backup/backup-job.sh'], { env });
const folders = async (): Promise<string[]> => (await inBackup(['ls', '/backups'])).stdout.split(/\s+/).filter(Boolean).sort();
const completeBackups = async (): Promise<string[]> => {
  const complete: string[] = [];
  for (const name of (await folders()).filter((entry) => AUTO.test(entry))) {
    if ((await inBackup(['test', '-f', `/backups/${name}/SHA256SUMS`])).code === 0) complete.push(name);
  }
  return complete;
};
/** The status file of the backup service (infra/backup/status.sh). */
interface BackupStatusFile {
  state: string;
  schedule: string;
  postponedSince: string | null;
  lastAttempt: { at: string; ok: boolean; message: string | null } | null;
  lastSuccess: { at: string; name: string; bytes: number } | null;
  offsite: { configured: boolean; encrypted: boolean; lastAttempt: { ok: boolean } | null; lastSuccess: { at: string; name: string } | null };
}
const status = async (): Promise<BackupStatusFile> => JSON.parse((await inBackup(['cat', '/status/backup-status.json'])).stdout) as BackupStatusFile;
const ready = async () => {
  const response = await tryFetch(`${stackConfig().apiDirect}/health/ready`);
  return { code: response?.status, text: (await response?.text()) ?? '' };
};

/** Copies a backup folder (and the media copy next to it) out of the volume into the sandbox. */
async function copyOut(name: string, withMedia = false): Promise<string> {
  const target = box.path('auto');
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(target, { recursive: true });
  await docker(['cp', `${containerName('backup')}:/backups/${name}`, target], { check: true });
  if (withMedia) await docker(['cp', `${containerName('backup')}:/backups/media`, target], { check: true });
  return path.join(target, name);
}

async function psql(sql: string): Promise<string> {
  return (await docker(['exec', containerName('postgres'), 'psql', '-U', 'studioflow', '-d', 'studioflow', '-tAc', sql], { check: true })).stdout.trim();
}

test.describe('OPS automatic backups', () => {
  test('E2E-OPS-23 [backup service] a schedule of every minute creates a complete, verified backup; the status file and the readiness check show it', t.disruptive('@p0'), async () => {
    test.setTimeout(420_000);
    await startBackup({ BACKUP_SCHEDULE: '* * * * *' });
    expect((await ready()).text, 'automatic backups are on, nothing has run yet: no failure, but the off-site hint').toContain('No off-site copy is configured');
    const folder = await waitUntil('a complete backup', async () => (await completeBackups())[0], { timeoutMs: 150_000, intervalMs: 3000 });
    const files = (await inBackup(['ls', `/backups/${folder}`])).stdout.split(/\s+/).filter(Boolean).sort();
    expect(files, 'media are not archived again; they are copied incrementally').toEqual(['SHA256SUMS', 'backup-info.txt', 'caddy_data.tar.gz', 'database.dump', 'keys.tar.gz']);

    const written = await status();
    expect(written.lastSuccess?.name).toBe(folder);
    expect(written.lastAttempt?.ok).toBe(true);
    expect(written.state).toBe('idle');
    expect(written.schedule).toBe('* * * * *');
    const readiness = await ready();
    expect(readiness.code, 'a warning is not an outage: /health/ready stays 200').toBe(200);
    expect(readiness.text).toMatch(/^Degraded\nbackup: Degraded - No off-site copy is configured/);
    expect(readiness.text, 'the backup itself is fine').not.toContain('older');

    const logs = await compose(['logs', '--no-color', 'backup'], { profiles: ['backup'] });
    expect(logs.output).toMatch(/Verified: the dump loads \(\d+ tables, newest migration \d+_\w+\)/);
    // The folder is a normal backup folder: copy it out and verify it with restore.sh.
    const copy = await copyOut(folder);
    const verify = await box.run('restore.sh', [copy, '--verify']);
    expect(verify.code, verify.output.slice(-1500)).toBe(0);
    expect(verify.stdout).toMatch(/Checksums OK/);
    expect(verify.stdout).toMatch(/Dump loaded: \d+ tables, newest migration/);
    expect(verify.stdout).toMatch(/Backup verified/);
    expect(await psql("select count(*) from pg_database where datname like 'studioflow_verify'"), 'the throwaway database is gone').toBe('0');
  });

  test('E2E-OPS-24 [restore.sh --verify] detects a tampered file, a dump that does not load and an incomplete folder', t.disruptive('@p0'), async () => {
    test.setTimeout(420_000);
    await startBackup();
    expect((await runJob()).code).toBe(0);
    const folder = (await completeBackups())[0]!;
    const original = await copyOut(folder);

    const flipped = box.path('flipped');
    fs.cpSync(original, flipped, { recursive: true });
    const dump = fs.readFileSync(path.join(flipped, 'database.dump'));
    dump[Math.floor(dump.length / 2)] ^= 0xff;
    fs.writeFileSync(path.join(flipped, 'database.dump'), dump);
    const tampered = await box.run('restore.sh', [flipped, '--verify']);
    expect(tampered.code, tampered.output).toBe(1);
    expect(tampered.stderr).toMatch(/Error: Checksum mismatch: database\.dump/);

    const archive = box.path('archive');
    fs.cpSync(original, archive, { recursive: true });
    fs.appendFileSync(path.join(archive, 'keys.tar.gz'), 'x');
    expect((await box.run('restore.sh', [archive, '--verify'])).stderr, 'every file of SHA256SUMS counts, not only the dump').toMatch(/Error: Checksum mismatch: keys\.tar\.gz/);

    // A broken dump whose checksum was rewritten: only loading it shows the damage.
    const broken = box.path('broken');
    fs.cpSync(original, broken, { recursive: true });
    const cut = fs.readFileSync(path.join(broken, 'database.dump')).subarray(0, 300);
    fs.writeFileSync(path.join(broken, 'database.dump'), cut);
    const sums = fs.readFileSync(path.join(broken, 'SHA256SUMS'), 'utf8').split('\n').map((line) => (line.endsWith('database.dump') ? `${sha256(cut)}  database.dump` : line));
    fs.writeFileSync(path.join(broken, 'SHA256SUMS'), sums.join('\n'));
    const unloadable = await box.run('restore.sh', [broken, '--verify']);
    expect(unloadable.code, unloadable.output).toBe(1);
    expect(unloadable.stderr).toMatch(/The dump could not be loaded/);
    expect(await psql("select count(*) from pg_database where datname like 'studioflow_verify'"), 'no throwaway database is left behind').toBe('0');

    fs.rmSync(path.join(original, 'SHA256SUMS'));
    expect((await box.run('restore.sh', [original, '--verify'])).stderr).toMatch(/Error: SHA256SUMS is missing/);
    const apiStarted = await docker(['inspect', '-f', '{{.State.StartedAt}}', containerName('api')]);
    expect(apiStarted.code, '--verify never stops anything').toBe(0);
  });

  test('E2E-OPS-25 [backup service] retention keeps the newest backup of the last N days and weeks, removes the others and leaves foreign folders alone', t.disruptive('@p1'), async () => {
    test.setTimeout(420_000);
    await startBackup({ BACKUP_KEEP_DAILY: '2', BACKUP_KEEP_WEEKLY: '1' });
    const old = ['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04', '2026-01-05', '2026-01-06'].map((day) => `${day}_0300_auto`);
    for (const name of old) {
      await inBackup(['mkdir', '-p', `/backups/${name}`]);
      await inBackup(['touch', `/backups/${name}/SHA256SUMS`]);
    }
    await inBackup(['mkdir', '-p', '/backups/2025-12-31_0300_auto', '/backups/meine-notizen']);
    expect((await runJob()).code).toBe(0);

    const remaining = await folders();
    expect(remaining.filter((name) => AUTO.test(name) && name.startsWith('2026-01')), 'the newest of the old days stays').toEqual(['2026-01-06_0300_auto']);
    expect((await completeBackups()).length, 'the new backup and the newest old one').toBe(2);
    expect(remaining, 'a folder that is not a backup is never touched').toContain('meine-notizen');
    expect(remaining, 'an unfinished folder of a killed run (no SHA256SUMS) is removed').not.toContain('2025-12-31_0300_auto');
  });

  test('E2E-OPS-26 [backup service] no backup is taken while a broadcast is live; it runs when the broadcast has ended', t.disruptive('@p0'), async ({ api, production }) => {
    test.setTimeout(420_000);
    await startBackup();
    expect((await api.startBroadcast(production.id)).status).toBe(200);
    try {
      const run = runJob();
      await sleep(10_000);
      expect(await completeBackups(), 'nothing is backed up during the broadcast').toEqual([]);
      const waiting = await status();
      expect(waiting.state).toBe('postponed');
      expect(waiting.postponedSince).toBeTruthy();

      expect((await api.endBroadcast(production.id)).status).toBe(200);
      const finished = await run;
      expect(finished.code, finished.output).toBe(0);
      expect(finished.stdout).toContain('A broadcast is live: the backup is postponed');
      expect((await completeBackups()).length, 'the backup ran after the end of the broadcast').toBe(1);
      const after = await status();
      expect(after.state).toBe('idle');
      expect(after.postponedSince).toBeNull();
    } finally {
      await api.resetBroadcast(production.id);
    }
  });

  test('E2E-OPS-27 [backup service] a failed run is recorded, leaves no partial folder and shows in the readiness check until a run succeeds', t.disruptive('@p0'), async () => {
    test.setTimeout(420_000);
    await startBackup();
    const failed = await runJob(['PGPASSWORD=wrong']);
    expect(failed.code, failed.output).toBe(1);
    expect(failed.stderr).toMatch(/Error: pg_dump failed/);
    expect(await folders(), 'no partial folder').toEqual([]);
    const recorded = await status();
    expect(recorded.lastAttempt?.ok).toBe(false);
    expect(recorded.lastAttempt?.message).toBe('pg_dump failed.');
    expect(recorded.lastSuccess).toBeNull();
    expect((await ready()).text).toContain('The last backup run failed: pg_dump failed.');

    expect((await runJob()).code).toBe(0);
    expect((await ready()).text, 'the next successful run clears the failure').not.toContain('failed');
  });

  test('E2E-OPS-28 [backup service] the off-site copy is encrypted with age, copies media only once and prunes like the local folders; restore needs the private key only', t.disruptive('@p1'), async ({ api, production }) => {
    test.setTimeout(600_000);
    const image = imageNameOf('backup');
    const keyFile = box.path('age-key.txt');
    // The key pair is made outside the stack, as an operator would: the server only ever sees the public key.
    await compose(['build', 'backup'], { profiles: ['backup'], check: true, timeoutMs: 600_000 });
    const keygen = await exec('docker', ['run', '--rm', '--entrypoint', 'age-keygen', image], { check: true });
    fs.writeFileSync(keyFile, keygen.stdout);
    const recipient = /age1[a-z0-9]+/.exec(keygen.stdout)![0];
    // A local directory plays the remote: rclone treats it like S3 or SFTP, so the copy logic is the same.
    const config = Buffer.from('[offsite]\ntype = local\n').toString('base64');
    await startBackup({ BACKUP_RCLONE_REMOTE: `offsite:${TARGET}`, BACKUP_RCLONE_CONFIG: config, BACKUP_AGE_RECIPIENT: recipient });

    const samples = await generateSamples();
    const uploaded = await api.uploadAsset(production.id, { fileName: 'image.jpg', contentType: 'image/jpeg', data: samples.photoJpg });
    expect(uploaded.status).toBe(201);
    const first = await runJob();
    expect(first.code, first.output.slice(-1500)).toBe(0);
    expect(first.stdout).toContain('Off-site copy (encrypted with age)');
    expect(first.stdout).toMatch(/Uploaded media\/.+\.jpg/);
    const second = await runJob();
    expect(second.code, second.output.slice(-1500)).toBe(0);
    expect(second.stdout, 'media that are already at the target are not uploaded again').not.toContain('Uploaded media/');
    const state = await status();
    expect(state.offsite.configured).toBe(true);
    expect(state.offsite.encrypted).toBe(true);
    expect(state.offsite.lastSuccess?.name).toBe(state.lastSuccess?.name);
    const readiness = (await ready()).text;
    expect(readiness, 'with an off-site copy the readiness check is happy').toBe('Healthy');

    // What is at the target: encrypted files only (plus the checksum list), one dated folder (the older one was pruned).
    const remote = (await inBackup(['find', TARGET, '-type', 'f'])).stdout.split('\n').filter(Boolean).sort();
    expect(remote.filter((file) => !file.endsWith('.age') && !file.endsWith('/SHA256SUMS')), 'nothing is stored unencrypted').toEqual([]);
    const dated = [...new Set(remote.map((file) => file.split('/')[3]!).filter((name) => AUTO.test(name)))];
    expect(dated).toHaveLength(1);
    const media = remote.filter((file) => file.includes('/media/') && file.includes(uploaded.body.id));
    expect(media, 'the uploaded file is there once, encrypted').toHaveLength(1);

    // Restore side: fetch with the private key, decrypt, check the SHA256SUMS and the media.
    const decrypted = box.path('decrypted');
    fs.rmSync(decrypted, { recursive: true, force: true });
    fs.mkdirSync(decrypted);
    const decrypt = async (file: string, output: string) => {
      await docker(['cp', `${containerName('backup')}:${file}`, `${output}.age`], { check: true });
      const run = await exec('docker', ['run', '--rm', '-i', '-v', `${keyFile.replace(/\\/g, '/')}:/key:ro`, '-v', `${path.dirname(output).replace(/\\/g, '/')}:/out`, '--entrypoint', 'age', image, '-d', '-i', '/key', '-o', `/out/${path.basename(output)}`, `/out/${path.basename(output)}.age`]);
      expect(run.code, run.output).toBe(0);
    };
    for (const name of ['database.dump', 'keys.tar.gz', 'caddy_data.tar.gz', 'backup-info.txt']) await decrypt(`${TARGET}/${dated[0]}/${name}.age`, path.join(decrypted, name));
    await docker(['cp', `${containerName('backup')}:${TARGET}/${dated[0]}/SHA256SUMS`, path.join(decrypted, 'SHA256SUMS')], { check: true });
    const verify = await box.run('restore.sh', [decrypted, '--verify']);
    expect(verify.code, verify.output.slice(-1500)).toBe(0);
    const mediaOut = path.join(decrypted, 'media.jpg');
    await decrypt(media[0]!, mediaOut);
    expect(sha256(fs.readFileSync(mediaOut)), 'the media file decrypts to the uploaded bytes').toBe(sha256(samples.photoJpg));
    await api.deleteAsset(production.id, uploaded.body.id);
  });

  test('E2E-OPS-28 [backup service] an off-site remote without an age key refuses to start unless BACKUP_OFFSITE_UNENCRYPTED is set', t.disruptive('@p1'), async () => {
    test.setTimeout(300_000);
    await stopBackup();
    const env = { ...process.env, BACKUP_SCHEDULE: '0 3 * * *', BACKUP_RCLONE_REMOTE: TARGET };
    const refused = await compose(['run', '--rm', '--no-deps', 'backup'], { profiles: ['backup'], env, timeoutMs: 120_000 });
    expect(refused.code).not.toBe(0);
    expect(refused.output).toMatch(/BACKUP_RCLONE_REMOTE is set without BACKUP_AGE_RECIPIENT/);
    const badSchedule = await compose(['run', '--rm', '--no-deps', 'backup'], { profiles: ['backup'], env: { ...process.env, BACKUP_SCHEDULE: 'every day' }, timeoutMs: 120_000 });
    expect(badSchedule.code).not.toBe(0);
    expect(badSchedule.output).toMatch(/BACKUP_SCHEDULE is not a valid cron expression/);
  });

  test('E2E-OPS-29 [restore.sh] an automatic backup restores database, keys and the media from the incremental copy', t.disruptive('@p0'), async ({ api, production }) => {
    test.setTimeout(900_000);
    await startBackup();
    const samples = await generateSamples();
    const uploaded = await api.uploadAsset(production.id, { fileName: 'image.jpg', contentType: 'image/jpeg', data: samples.photoJpg });
    expect(uploaded.status).toBe(201);
    await production.seed(['One', 'Two']);
    expect((await runJob()).code).toBe(0);
    const folder = (await completeBackups())[0]!;
    const copy = await copyOut(folder, true);
    const before = (await api.getSnapshot(production.id)).body;

    await api.updateScene(production.id, production.sceneIds[0]!, { name: 'Changed' });
    await api.deleteAsset(production.id, uploaded.body.id);

    const restore = await box.run('restore.sh', [copy, '--yes', '--no-safety-backup']);
    expect(restore.code, restore.output.slice(-2500)).toBe(0);
    expect(restore.stdout).toMatch(/Volume media from the incremental copy/);
    await ensureHealthy();
    const session = new AdminApi(stackConfig().baseURL, api.cookie);
    expect((await session.getSnapshot(production.id)).body.scenes.map((scene) => scene.name)).toEqual(before.scenes.map((scene) => scene.name));
    const content = await session.getAssetContent(production.id, uploaded.body.id);
    expect(content.status, 'the media file is back and readable by the API').toBe(200);
    expect(sha256(content.raw.body)).toBe(sha256(samples.photoJpg));
    await session.deleteAsset(production.id, uploaded.body.id);
  });
});
