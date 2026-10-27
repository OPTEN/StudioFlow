import { AdminApi, DeviceApi } from '../../support/api';
import { ENV_FILE, PROJECT, REPO_ROOT, imageNameOf } from '../../support/env';
import { expect, test } from '../../support/fixtures';
import { certSerial, secretFingerprint } from '../../support/ops';
import { pairPhone } from '../../support/production';
import { exec } from '../../support/shell';
import { compose, containerName, docker, ensureHealthy, inspectService } from '../../support/stack';
import { t } from '../../support/tags';

/**
 * OPS update (docs/testing.md E2E-OPS-09): an update is `docker compose pull && docker compose up -d` and nothing else - no
 * script, no `git pull`, no `.env` edit. Compose replaces the containers whose image changed; the volumes (database,
 * media, keys, certificates, secrets, backups) stay, the init service keeps the secrets it made, the settings of the wizard
 * are in the database. The release file runs here against the images of the stack under test, tagged as a release would be
 * (the registry is a local name, `--pull never` stands in for the pull).
 */

test.describe.configure({ mode: 'serial' });

const RELEASE_IMAGES = { caddy: 'studioflow-web', api: 'studioflow-api', livekit: 'studioflow-livekit', backup: 'studioflow-backup' } as const;
const REGISTRY = 'e2e.local';
const TAG = 'e2e';

test.afterEach(async () => {
  test.setTimeout(420_000);
  // Back to the compose files of the harness (build file + test override): this recreates what the release file replaced.
  await compose(['up', '-d', '--wait', '--wait-timeout', '240'], { timeoutMs: 300_000 });
  await ensureHealthy();
});

/** The release file against the stack's own project, volumes and ports (the env file holds only overrides). */
function releaseCompose(args: string[], registry = REGISTRY) {
  return exec(
    'docker',
    ['compose', '-p', PROJECT, '--env-file', ENV_FILE, '-f', `${REPO_ROOT}/docker-compose.release.yml`, ...args],
    { cwd: REPO_ROOT, env: { ...process.env, STUDIOFLOW_IMAGE_REGISTRY: registry, STUDIOFLOW_IMAGE_TAG: TAG }, timeoutMs: 600_000 },
  );
}

async function tagReleaseImages(): Promise<void> {
  for (const [service, name] of Object.entries(RELEASE_IMAGES)) {
    await docker(['tag', imageNameOf(service), `${REGISTRY}/${name}:${TAG}`], { check: true });
  }
}

async function untagReleaseImages(): Promise<void> {
  for (const name of Object.values(RELEASE_IMAGES)) await docker(['rmi', `${REGISTRY}/${name}:${TAG}`]);
}

test.describe('OPS update', () => {
  test('E2E-OPS-09 [update] `up -d --force-recreate` (what an update does with new images) keeps scenes, devices, assets, session, certificate, secrets, settings and backups', t.disruptive('@p0'), async ({ config, api, production, pairContext }) => {
    test.setTimeout(600_000);
    const phone = await pairPhone(pairContext, { name: 'Survives Update' });
    await api.updateScene(production.id, production.sceneIds[0]!, { name: 'Update Kept' });
    const snapshot = (await api.getSnapshot(production.id)).body;
    const settings = (await api.getServerSettings()).body;
    const serial = await certSerial();
    const secrets = await Promise.all((['postgres-password', 'livekit-api-key', 'livekit-api-secret'] as const).map((name) => secretFingerprint(name)));
    const before = await Promise.all(['api', 'caddy', 'livekit', 'postgres', 'backup'].map(async (service) => (await inspectService(service))?.id));
    const backup = await compose(['run', '--rm', '-T', 'backup', 'backup-now'], { check: true });
    const backupName = /Backing up to \/backups\/(\S+)/.exec(backup.stdout)![1]!;

    const started = Date.now();
    await compose(['up', '-d', '--force-recreate', '--wait', '--wait-timeout', '240'], { check: true, timeoutMs: 300_000 });
    await ensureHealthy();
    test.info().annotations.push({ type: 'measurement', description: `up -d --force-recreate: all healthy again after ${Date.now() - started} ms` });
    const after = await Promise.all(['api', 'caddy', 'livekit', 'postgres', 'backup'].map(async (service) => (await inspectService(service))?.id));
    after.forEach((id, index) => expect(id, `container ${index} was replaced`).not.toBe(before[index]));

    const same = new AdminApi(config.baseURL, api.cookie);
    expect((await same.getSession()).status, 'the admin session survives the update (keys volume)').toBe(200);
    expect((await same.getSnapshot(production.id)).body.scenes.map((scene) => scene.name)).toEqual(snapshot.scenes.map((scene) => scene.name));
    // (The phone's own client talks to the direct API port, which only the harness override publishes: go through Caddy.)
      expect((await new DeviceApi(config.baseURL, phone.credentials).getDeviceSelf()).status, 'device credentials stay valid').toBe(200);
    expect((await same.getServerSettings()).body, 'the settings of the wizard are the same').toEqual(settings);
    expect(await certSerial(), 'same certificate').toBe(serial);
    expect(await Promise.all((['postgres-password', 'livekit-api-key', 'livekit-api-secret'] as const).map((name) => secretFingerprint(name))), 'the init service did not make the secrets again').toEqual(secrets);
    const listed = (await compose(['run', '--rm', '-T', 'backup', 'list'], { check: true })).stdout;
    expect(listed, 'the backups are still there').toContain(backupName);
  });

  test('E2E-OPS-09 [update] a broadcast that is live when the update starts is still live afterwards; nothing refuses or waits (the operator picks the moment)', t.disruptive('@p0'), async ({ config, api, production }) => {
    test.setTimeout(600_000);
    expect((await api.startBroadcast(production.id)).status).toBe(200);
    try {
      await compose(['up', '-d', '--force-recreate', '--no-deps', '--wait', '--wait-timeout', '240', 'api'], { check: true, timeoutMs: 300_000 });
      await ensureHealthy();
      const same = new AdminApi(config.baseURL, api.cookie);
      expect((await same.getSnapshot(production.id)).body.production.broadcast, 'the broadcast state is in the database').toBe('live');
    } finally {
      await api.resetBroadcast(production.id);
    }
  });

  test('E2E-OPS-09 [update] a pull that fails (registry not reachable) stops and changes nothing', t.disruptive('@p0'), async ({ api, production }) => {
    test.setTimeout(300_000);
    const before = await Promise.all(['api', 'caddy', 'livekit', 'postgres', 'backup'].map(async (service) => (await inspectService(service))?.startedAt));
    const pull = await releaseCompose(['pull'], '127.0.0.1:1/none');
    expect(pull.code, pull.output.slice(-600)).not.toBe(0);
    const after = await Promise.all(['api', 'caddy', 'livekit', 'postgres', 'backup'].map(async (service) => (await inspectService(service))?.startedAt));
    expect(after, 'no container was touched').toEqual(before);
    expect((await api.getSnapshot(production.id)).status).toBe(200);
  });

  test('E2E-OPS-09 [update, release file] the release compose file takes over the running stack in place: same volumes, same secrets, same settings, no .env', t.disruptive('@p0'), async ({ config, api, production, pairContext }) => {
    test.setTimeout(900_000);
    const phone = await pairPhone(pairContext, { name: 'Release Update' });
    await api.updateScene(production.id, production.sceneIds[0]!, { name: 'Release Kept' });
    const snapshot = (await api.getSnapshot(production.id)).body;
    const settings = (await api.getServerSettings()).body;
    const secrets = await Promise.all((['postgres-password', 'livekit-api-key', 'livekit-api-secret'] as const).map((name) => secretFingerprint(name)));
    await tagReleaseImages();
    try {
      // `docker compose pull` would fetch the tag from the registry; the images are local, so the update is `up -d --pull never`.
      const up = await releaseCompose(['up', '-d', '--pull', 'never', '--wait', '--wait-timeout', '300']);
      expect(up.code, up.output.slice(-1500)).toBe(0);
      const images = await Promise.all(['api', 'caddy', 'livekit', 'backup'].map(async (service) => (await docker(['inspect', '-f', '{{.Config.Image}}', containerName(service)], { check: true })).stdout.trim()));
      expect(images, 'the containers run the release images').toEqual([`${REGISTRY}/studioflow-api:${TAG}`, `${REGISTRY}/studioflow-web:${TAG}`, `${REGISTRY}/studioflow-livekit:${TAG}`, `${REGISTRY}/studioflow-backup:${TAG}`]);

      // The release file publishes the same ports; the Regie answers under the saved address with the same session.
      await ensureReleaseStackUsable(config.baseURL, api.cookie);
      const same = new AdminApi(config.baseURL, api.cookie);
      expect((await same.getSnapshot(production.id)).body.scenes.map((scene) => scene.name)).toEqual(snapshot.scenes.map((scene) => scene.name));
      // (The phone's own client talks to the direct API port, which only the harness override publishes: go through Caddy.)
      expect((await new DeviceApi(config.baseURL, phone.credentials).getDeviceSelf()).status, 'device credentials stay valid').toBe(200);
      expect((await same.getServerSettings()).body).toEqual(settings);
      expect(await Promise.all((['postgres-password', 'livekit-api-key', 'livekit-api-secret'] as const).map((name) => secretFingerprint(name)))).toEqual(secrets);
    } finally {
      // The afterEach puts the harness files back; the tags are not needed any more.
      await compose(['up', '-d', '--wait', '--wait-timeout', '240'], { timeoutMs: 300_000 });
      await untagReleaseImages();
    }
  });
});

/** Waits until the admin session works through Caddy again (the release file has no direct API port). */
async function ensureReleaseStackUsable(baseURL: string, cookie: string): Promise<void> {
  const deadline = Date.now() + 180_000;
  for (;;) {
    const status = await new AdminApi(baseURL, cookie).getSession().then((response) => response.status).catch(() => 0);
    if (status === 200) return;
    if (Date.now() > deadline) throw new Error(`the Regie does not answer after the update (last status ${status})`);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}
