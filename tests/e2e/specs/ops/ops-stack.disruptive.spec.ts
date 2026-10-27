import net from 'node:net';
import { AdminApi } from '../../support/api';
import { dockerCtl } from '../../support/docker-ctl';
import { PROJECT, stackConfig, volumeNameOf } from '../../support/env';
import { expect, test } from '../../support/fixtures';
import { makePng } from '../../support/media-samples';
import { certSerial, secretFingerprint } from '../../support/ops';
import { pairPhone } from '../../support/production';
import { sleep, waitUntil } from '../../support/shell';
import { HEALTH_SERVICES, SERVICES, compose, containerName, docker, ensureHealthy, inspectService, tryFetch, type Service } from '../../support/stack';
import { t } from '../../support/tags';

/**
 * OPS on the running stack (docs/testing.md 2.11): E2E-OPS-05 healthchecks are real, -06 restart policy and
 * persistence, -34 secrets are made exactly once, -35 a port that is taken is named, -36 the settings of the wizard
 * survive a restart. Everything here disturbs the stack and puts it back.
 */

test.afterEach(async () => {
  test.setTimeout(300_000);
  for (const service of SERVICES) await docker(['unpause', containerName(service)]);
  await ensureHealthy();
});

const HEALTH_SLACK_MS = 60_000;

test.describe('OPS healthchecks', () => {
  test('E2E-OPS-05 [stack] all five containers report healthy and the init service has finished', t.p1, async () => {
    for (const service of HEALTH_SERVICES) {
      const state = await inspectService(service);
      expect(state?.running, `${service} running`).toBe(true);
      expect(state?.health, `${service} health`).toBe('healthy');
    }
    const init = await inspectService('init');
    expect(init?.status, 'init exited').toBe('exited');
    expect(init?.exitCode, 'init exit code').toBe(0);
  });

  for (const service of ['livekit', 'postgres', 'api', 'caddy'] as const) {
    // Docker 29 flips a paused container to unhealthy at once, whatever its check does (DOC-07), so this only proves the
    // reporting chain and the recovery after unpause; the [command] tests below prove that the checks exercise the service.
    test(`E2E-OPS-05 [stack] docker pause ${service}: the container is reported unhealthy within interval x retries and healthy again after unpause`, t.p1, async () => {
      test.setTimeout(300_000);
      await dockerCtl.pause(service);
      let ready: number | undefined;
      if (service === 'postgres') {
        // The API stays alive (liveness) but is no longer ready.
        const probe = Date.now();
        await waitUntil('api readiness 503', async () => (await tryFetch(`${stackConfig().apiDirect}/health/ready`, { timeoutMs: 4000 }))?.status !== 200, { timeoutMs: 30_000, intervalMs: 500 });
        ready = Date.now() - probe;
      }
      const took = await dockerCtl.waitUnhealthy(service, HEALTH_SLACK_MS + 30_000);
      test.info().annotations.push({ type: 'measurement', description: `${service}: unhealthy ${took} ms after pause${ready === undefined ? '' : `; API not ready after ${ready} ms`}` });
      expect(took, `${service} turns unhealthy within 60 s (interval x retries)`).toBeLessThanOrEqual(HEALTH_SLACK_MS);
      await dockerCtl.unpause(service);
      await waitUntil(`${service} healthy again`, async () => (await inspectService(service))?.health === 'healthy', { timeoutMs: 90_000, intervalMs: 1000 });
    });
  }

  for (const service of ['postgres', 'api', 'livekit', 'caddy', 'backup'] as const) {
    test(`E2E-OPS-05 [stack, command] the healthcheck of ${service} succeeds against the running service and fails where the service is not running`, t.p1, async () => {
      test.setTimeout(120_000);
      const info = JSON.parse((await docker(['inspect', containerName(service)], { check: true })).stdout)[0] as { Config: { Image: string; Healthcheck?: { Test: string[] } } };
      const [kind, ...rest] = info.Config.Healthcheck?.Test ?? [];
      expect(rest.length, `${service} has a healthcheck command`).toBeGreaterThan(0);
      const shell = kind === 'CMD-SHELL';
      const running = await docker(['exec', containerName(service), ...(shell ? ['sh', '-c', rest.join(' ')] : rest)]);
      expect(running.code, `${service}: the check succeeds in the running container (${rest.join(' ')})`).toBe(0);
      // The same command in a container of the same image where the service is not started: it must fail, i.e. it really
      // asks the service (pg_isready over TCP, GET /health/live, GET / on LiveKit, Caddy's loopback health listener,
      // the scheduler process of the backup service).
      const alone = await docker(['run', '--rm', '--network', 'none', ...(shell ? ['--entrypoint', 'sh', info.Config.Image, '-c', rest.join(' ')] : ['--entrypoint', rest[0]!, info.Config.Image, ...rest.slice(1)])], { timeoutMs: 90_000 });
      expect(alone.code, `${service}: the same check fails without the service (${alone.output.trim().slice(0, 120)})`).not.toBe(0);
    });
  }

  test('E2E-OPS-05 [stack] depends_on ordering: with postgres stopped, `up -d api` runs init, starts postgres first and the API only after it is healthy', t.p1, async () => {
    test.setTimeout(300_000);
    await compose(['stop', 'caddy', 'api', 'postgres'], { check: true });
    await compose(['up', '-d', '--wait', '--wait-timeout', '240', 'api'], { check: true });
    const readInfo = async (service: Service) => JSON.parse((await docker(['inspect', containerName(service)], { check: true })).stdout)[0] as { State: { StartedAt: string; Health?: { Log?: Array<{ End: string; ExitCode: number }> } } };
    const postgres = await readInfo('postgres');
    const api = await readInfo('api');
    const apiStarted = new Date(api.State.StartedAt).getTime();
    expect(new Date(postgres.State.StartedAt).getTime(), 'postgres started before the API').toBeLessThanOrEqual(apiStarted);
    const firstHealthy = (postgres.State.Health?.Log ?? []).find((entry) => entry.ExitCode === 0);
    expect(firstHealthy, 'postgres had a successful healthcheck').toBeTruthy();
    expect(new Date(firstHealthy!.End).getTime(), 'the API started only after postgres was healthy').toBeLessThanOrEqual(apiStarted + 1000);
    expect((await inspectService('caddy'))?.running, 'caddy was not started by `up api`').toBe(false);
    await compose(['up', '-d', '--wait', '--wait-timeout', '240'], { check: true });
  });
});

test.describe('OPS restart policy and persistence', () => {
  for (const service of ['api', 'caddy', 'livekit', 'postgres'] as const) {
    test(`E2E-OPS-06 [stack] a crash of ${service}: running again within 20 s and healthy within 60 s`, t.p0, async () => {
      test.setTimeout(240_000);
      const before = await inspectService(service);
      const started = Date.now();
      await dockerCtl.crash(service);
      const running = await waitUntil(`${service} running again`, async () => {
        const state = await inspectService(service);
        return state?.running && state.startedAt !== before?.startedAt ? Date.now() - started : false;
      }, { timeoutMs: 60_000, intervalMs: 250 });
      await waitUntil(`${service} healthy`, async () => (await inspectService(service))?.health === 'healthy', { timeoutMs: 120_000, intervalMs: 500 });
      const healthy = Date.now() - started;
      test.info().annotations.push({ type: 'measurement', description: `${service}: running after ${running} ms, healthy after ${healthy} ms` });
      expect(running, `${service} running again`).toBeLessThanOrEqual(20_000);
      expect(healthy, `${service} healthy again`).toBeLessThanOrEqual(HEALTH_SLACK_MS);
    });
  }

  test('E2E-OPS-06 [stack, DOC-04] a crash (kill -TERM 1 inside the container) of a service with restart: unless-stopped brings it back', t.p2, async () => {
    test.setTimeout(240_000);
    await dockerCtl.crash('caddy');
    await sleep(15_000);
    expect((await inspectService('caddy'))?.running, 'caddy running again 15 s after its process ended').toBe(true);
    if (!(await inspectService('caddy'))?.running) await compose(['start', 'caddy']);
  });

  test('E2E-OPS-06 [stack] a restarted Caddy gets its configuration back from the API without anybody touching it', t.p0, async ({ config }) => {
    test.setTimeout(240_000);
    await dockerCtl.crash('caddy');
    await waitUntil('Caddy serves the site of the settings again', async () => {
      const response = await tryFetch(`${config.baseURL}/api/auth/setup`, { timeoutMs: 4000 });
      return response?.status === 200;
    }, { timeoutMs: 120_000, intervalMs: 1000 });
    const serial = await certSerial();
    expect(serial, 'a certificate is presented').toBeTruthy();
  });

  test('E2E-OPS-06 [stack] down and up keeps the data: scenes, devices, assets, the admin session, the certificate, the secrets and the volumes', t.p0, async ({ config, api, production, pairContext }) => {
    test.setTimeout(420_000);
    const phone = await pairPhone(pairContext, { name: 'Stays Here' });
    const png = makePng(40, 30);
    const asset = (await api.uploadAsset(production.id, { fileName: 'stays.png', contentType: 'image/png', data: png })).body;
    await api.updateScene(production.id, production.sceneIds[0]!, { name: 'Stays Kept' });
    const snapshot = (await api.getSnapshot(production.id)).body;
    const serial = await certSerial();
    const postgresSecret = await secretFingerprint('postgres-password');
    const volumes = (await docker(['volume', 'ls', '--filter', `label=com.docker.compose.project=${PROJECT}`, '--format', '{{.Name}}'], { check: true })).stdout.split(/\r?\n/).filter(Boolean).sort();
    for (const name of ['caddy_config', 'caddy_data', 'keys', 'media', 'pgdata', 'secrets']) expect(volumes, `volume ${name}`).toContain(volumeNameOf(name));

    await compose(['down'], { check: true, timeoutMs: 240_000 });
    const gone = await docker(['ps', '-a', '--filter', `label=com.docker.compose.project=${PROJECT}`, '-q']);
    expect(gone.stdout.trim(), 'down removes the containers').toBe('');
    const started = Date.now();
    await compose(['up', '-d', '--wait', '--wait-timeout', '240'], { check: true, timeoutMs: 300_000 });
    await ensureHealthy();
    test.info().annotations.push({ type: 'measurement', description: `up -d --wait: all healthy after ${Date.now() - started} ms` });

    const same = new AdminApi(config.baseURL, api.cookie);
    expect((await same.getSession()).status, 'the admin session survives down/up (keys volume)').toBe(200);
    const after = (await same.getSnapshot(production.id)).body;
    expect(after.scenes.map((scene) => scene.name)).toEqual(snapshot.scenes.map((scene) => scene.name));
    expect(after.devices.map((device) => device.id)).toEqual(snapshot.devices.map((device) => device.id));
    expect((await phone.api.getDeviceSelf()).status, 'device credentials stay valid').toBe(200);
    const content = await same.getAssetContent(production.id, asset.id);
    expect(content.status).toBe(200);
    expect(Buffer.compare(content.raw.body, png), 'asset bytes').toBe(0);
    expect(await certSerial(), 'same certificate (caddy_data volume)').toBe(serial);
    expect(await secretFingerprint('postgres-password'), 'the database password is not made again').toBe(postgresSecret);
    expect(after.production.broadcast).toBe(snapshot.production.broadcast);
  });

  test('E2E-OPS-36 [stack] the settings of the wizard survive a restart of the whole stack and of the API alone', t.p0, async ({ config, api }) => {
    test.setTimeout(420_000);
    const before = (await api.getServerSettings()).body;
    expect(before.configured).toBe(true);
    expect(before.media.address).toBe(config.nodeIp);
    expect(before.address.domain).toBe('localhost');
    expect(before.embedding.origins).toEqual(['https://embed.e2e.test', 'https://embed.test']);

    await compose(['restart', 'api'], { check: true, timeoutMs: 240_000 });
    await ensureHealthy();
    expect((await new AdminApi(config.baseURL, api.cookie).getServerSettings()).body, 'after a restart of the API').toEqual(before);

    await compose(['down'], { check: true, timeoutMs: 240_000 });
    await compose(['up', '-d', '--wait', '--wait-timeout', '240'], { check: true, timeoutMs: 300_000 });
    await ensureHealthy();
    const after = (await new AdminApi(config.baseURL, api.cookie).getServerSettings()).body;
    expect(after, 'after down and up').toEqual(before);
    // The edge and the media server run what the database says: the site answers under the saved address and with the
    // embedding, LiveKit announces the saved media address.
    const response = await fetch(`${config.baseURL}/o/x`, { signal: AbortSignal.timeout(10_000) });
    expect(response.headers.get('content-security-policy') ?? '').toContain("frame-ancestors 'self' https://embed.e2e.test https://embed.test");
    const logs = (await compose(['logs', '--no-color', 'livekit'])).output;
    expect(logs, 'LiveKit announces the saved media address').toContain(`"nodeIP": "${config.nodeIp}"`);
  });
});

test.describe('OPS secrets and ports', () => {
  test('E2E-OPS-34 [stack] the init service makes the secrets exactly once: running it again, recreating it and down/up change nothing', t.p0, async () => {
    test.setTimeout(420_000);
    const names = ['postgres-password', 'livekit-api-key', 'livekit-api-secret'] as const;
    const before = await Promise.all(names.map((name) => secretFingerprint(name)));
    expect(new Set(before).size, 'three different secrets').toBe(3);

    const again = await compose(['run', '--rm', '-T', 'init'], { check: true });
    expect(again.output, 'a second run makes nothing').not.toContain('created');
    expect(again.output, 'a second run says it is ready').toContain('secrets: ready');
    expect(await Promise.all(names.map((name) => secretFingerprint(name)))).toEqual(before);

    await compose(['up', '-d', '--force-recreate', '--no-deps', '--wait', '--wait-timeout', '240', 'postgres', 'api'], { check: true, timeoutMs: 300_000 });
    await ensureHealthy();
    expect(await Promise.all(names.map((name) => secretFingerprint(name))), 'the database still opens with the stored password').toEqual(before);
    expect((await AdminApi.login()).cookie, 'the API reads the stored secrets and the database accepts them').toBeTruthy();
  });

  test('E2E-OPS-35 [stack] a taken port stops the start of Caddy with Docker\'s own message that names the port; freeing it lets Caddy start', t.p0, async () => {
    test.setTimeout(300_000);
    const config = stackConfig();
    await compose(['stop', 'caddy'], { check: true });
    const holder = net.createServer();
    await new Promise<void>((resolve, reject) => {
      holder.once('error', reject);
      holder.listen({ port: config.httpsPort, host: '0.0.0.0', exclusive: true }, () => resolve());
    });
    try {
      const start = await compose(['up', '-d', 'caddy']);
      expect(start.code, 'caddy cannot start on a port that is taken').not.toBe(0);
      expect(start.output, 'the message names the port').toContain(String(config.httpsPort));
      expect(start.output, 'the message says why').toMatch(/port is already allocated|address already in use|already in use/i);
      expect((await inspectService('caddy'))?.running, 'caddy is not running').not.toBe(true);
    } finally {
      await new Promise<void>((resolve) => holder.close(() => resolve()));
    }
    // Docker 29 leaves the container that failed to start without its network and port bindings, and a plain `up -d`
    // starts it again in that state although its own healthcheck passes; the way out is to create it anew (the runbook
    // says so). The stack answers on the port again only then.
    await compose(['up', '-d', '--force-recreate', '--no-deps', '--wait', '--wait-timeout', '120', 'caddy'], { check: true });
    await waitUntil('caddy answers on the port that was taken', async () => (await tryFetch(`${config.baseURL}/`))?.status === 200, { timeoutMs: 60_000 });
  });
});
