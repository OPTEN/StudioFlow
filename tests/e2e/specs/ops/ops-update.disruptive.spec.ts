import fs from 'node:fs';
import path from 'node:path';
import { AdminApi } from '../../support/api';
import { expect, test } from '../../support/fixtures';
import { PROJECT, volumeNameOf } from '../../support/env';
import { OpsSandbox } from '../../support/ops';
import { exec } from '../../support/shell';
import { SERVICES, compose, docker, ensureHealthy, inspectService } from '../../support/stack';
import { t } from '../../support/tags';

/**
 * E2E-OPS-09: update.sh refuses while a broadcast is live [GAP-31]. The script runs unmodified in an isolated git work
 * tree that tracks a local bare remote; docker compose finds the stack under test through the environment (support/ops.ts).
 * The “docker compose up -d --build” of a successful update builds from the repository's build contexts (layer cache).
 */

let box: OpsSandbox;
let pushExtraCommit: (message: string) => Promise<void>;

test.beforeAll(async () => {
  test.setTimeout(120_000);
  box = OpsSandbox.create('update');
  const git = await box.initGit();
  pushExtraCommit = git.pushExtraCommit;
});

test.afterAll(async () => {
  await box.cleanup();
});

test.afterEach(async () => {
  test.setTimeout(420_000);
  await ensureHealthy();
});

const git = (args: string[]) => exec('git', ['-c', 'user.name=e2e', '-c', 'user.email=e2e@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd: box.root, check: true });
const head = async () => (await git(['rev-parse', 'HEAD'])).stdout.trim();

/** Container ids and start times: equal before and after means nothing was restarted. */
async function fingerprint(): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const service of SERVICES) {
    const state = await inspectService(service);
    result[service] = `${state?.id}@${state?.startedAt}`;
  }
  return result;
}

test.describe('OPS update', () => {
  test('E2E-OPS-09 [update.sh] a live broadcast blocks the update: no git pull, no rebuild, no restart', t.disruptive('@p0'), async ({ config, api, production }) => {
    test.setTimeout(300_000);
    await pushExtraCommit('Change during the broadcast');
    const headBefore = await head();
    expect((await api.startBroadcast(production.id)).status).toBe(200);
    const before = await fingerprint();
    const result = await box.run('update.sh');
    expect(result.code, result.output).toBe(1);
    expect(result.stderr).toMatch(/Error: A broadcast is LIVE/);
    expect(result.output, 'no git pull was attempted').not.toMatch(/git pull|Updated:|Already up to date/);
    expect(await head(), 'HEAD unchanged').toBe(headBefore);
    expect(await fingerprint(), 'container ids and start times unchanged').toEqual(before);
    expect((await new AdminApi(config.baseURL, api.cookie).getSnapshot(production.id)).body.production.broadcast, 'the broadcast is still live').toBe('live');
    await api.resetBroadcast(production.id);
  });

  test('E2E-OPS-09 [update.sh] standby: pulls fast-forward, rebuilds, waits until healthy, keeps the data; --backup writes a “pre-update” backup first', t.disruptive('@p0'), async ({ config, api, production }) => {
    test.setTimeout(1_200_000);
    await api.resetBroadcast(production.id);
    await pushExtraCommit('New change');
    const headBefore = await head();
    const snapshot = (await api.getSnapshot(production.id)).body;
    const result = await box.run('update.sh', ['--backup']);
    expect(result.code, result.output.slice(-3000)).toBe(0);
    test.info().annotations.push({ type: 'measurement', description: `update.sh --backup took ${result.durationMs} ms` });
    expect(result.stdout).toMatch(/Broadcast status: no broadcast is live/);
    expect(result.stdout).toMatch(/Updated: [0-9a-f]+ -> [0-9a-f]+/);
    expect(result.stdout).toContain('Update complete.');
    expect(await head(), 'HEAD moved to the remote commit').not.toBe(headBefore);
    const backups = fs.readdirSync(box.path('backups')).filter((name) => name.endsWith('_pre-update') || /_pre-update-\d+$/.test(name));
    expect(backups, 'a “pre-update” backup was written before the update').toHaveLength(1);
    await ensureHealthy();
    const after = (await new AdminApi(config.baseURL, api.cookie).getSnapshot(production.id)).body;
    expect(after.scenes.map((scene) => scene.id), 'data retained').toEqual(snapshot.scenes.map((scene) => scene.id));
    const volumes = (await docker(['volume', 'ls', '--filter', `label=com.docker.compose.project=${PROJECT}`, '--format', '{{.Name}}'])).stdout;
    for (const name of ['pgdata', 'media', 'keys', 'caddy_data']) expect(volumes, `volume ${name} retained`).toContain(volumeNameOf(name));
  });

  test('E2E-OPS-09 [update.sh] an ended broadcast does not block; --no-pull only rebuilds', t.disruptive('@p1'), async ({ api, production }) => {
    test.setTimeout(1_200_000);
    await api.resetBroadcast(production.id);
    expect((await api.startBroadcast(production.id)).status).toBe(200);
    expect((await api.endBroadcast(production.id)).status).toBe(200);
    const headBefore = await head();
    const result = await box.run('update.sh', ['--no-pull']);
    expect(result.code, result.output.slice(-3000)).toBe(0);
    expect(result.output, '--no-pull does not touch git').not.toMatch(/git pull|Updated:|Already up to date/);
    expect(await head()).toBe(headBefore);
    expect(result.stdout).toContain('Update complete.');
    await ensureHealthy();
  });

  test('E2E-OPS-09 [update.sh] with the api container stopped the state is unknown: the update refuses unless --force', t.disruptive('@p0'), async () => {
    test.setTimeout(1_200_000);
    await compose(['stop', 'api'], { check: true });
    const before = await fingerprint();
    const refused = await box.run('update.sh', ['--no-pull']);
    expect(refused.code, refused.output).toBe(1);
    expect(refused.stderr).toMatch(/Error: Broadcast status unknown/);
    expect(await fingerprint(), 'nothing was restarted').toEqual(before);
    const forced = await box.run('update.sh', ['--no-pull', '--force']);
    expect(forced.code, forced.output.slice(-3000)).toBe(0);
    expect(forced.stderr).toMatch(/Broadcast status unknown \(the API does not answer\)\. The update will run anyway because of --force/);
    await ensureHealthy();
  });

  test('E2E-OPS-09 [update.sh] with the whole stack stopped the update proceeds and starts everything', t.disruptive('@p1'), async () => {
    test.setTimeout(1_200_000);
    await compose(['stop'], { check: true, timeoutMs: 240_000 });
    const result = await box.run('update.sh', ['--no-pull']);
    expect(result.code, result.output.slice(-3000)).toBe(0);
    expect(result.stdout).toMatch(/Broadcast status: the stack is not running, no broadcast is live/);
    expect(result.stdout).toContain('Update complete.');
    await ensureHealthy();
  });

  test('E2E-OPS-09 [update.sh] a pull that is not a fast-forward aborts before anything is restarted', t.disruptive('@p1'), async () => {
    test.setTimeout(300_000);
    await pushExtraCommit('Remote change');
    fs.writeFileSync(path.join(box.root, 'LOCAL.txt'), 'local change\n');
    await git(['add', 'LOCAL.txt']);
    await git(['commit', '-m', 'local change']);
    const headBefore = await head();
    const before = await fingerprint();
    const result = await box.run('update.sh');
    expect(result.code, result.output).toBe(1);
    expect(result.stderr).toMatch(/Error: git pull --ff-only failed/);
    expect(result.stderr).toMatch(/Nothing was restarted/);
    expect(await head(), 'the local history is untouched').toBe(headBefore);
    expect(await fingerprint(), 'nothing was restarted').toEqual(before);
    // Bring the work tree back to the remote state for the following tests.
    await git(['reset', '--hard', 'origin/main']);
  });

  test('E2E-OPS-09 [update.sh] invalid options and a missing .env are refused', t.disruptive('@p2'), async () => {
    const unknown = await box.run('update.sh', ['--bogus']);
    expect(unknown.code).toBe(1);
    expect(unknown.stderr).toMatch(/Error: Unknown option/);
    const help = await box.run('update.sh', ['--help']);
    expect(help.code).toBe(0);
    expect(help.stdout).toMatch(/Never during a broadcast/);
    const lonely = OpsSandbox.create('noenv', { mode: 'none' });
    try {
      const result = await lonely.run('update.sh', ['--no-pull']);
      expect(result.code).toBe(1);
      expect(result.stderr).toMatch(/Error: \.env is missing/);
    } finally {
      await lonely.cleanup();
    }
  });
});
