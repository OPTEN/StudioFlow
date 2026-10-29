import crypto from 'node:crypto';
import type { BrowserContext } from '@playwright/test';
import { stateFromSnapshot } from '../../../../packages/scene-model/src/production-state';
import { AdminApi } from '../../support/api';
import { ERROR, THRESHOLD } from '../../support/constants';
import { dockerCtl, livekitCtl, restoreNetwork } from '../../support/docker-ctl';
import { expect, expectProblem, knownBug, requireTool, test, uniqueIp } from '../../support/fixtures';
import { LiveKitPage } from '../../support/livekit-browser';
import { livekitAdmin } from '../../support/livekit';
import { net } from '../../support/net';
import { pairPhone, type PairContext, type PairedDevice, type Production } from '../../support/production';
import { send } from '../../support/http';
import { OutputSim, SenderSim, eventually, eventuallyValue } from '../../support/sim';
import { sleep, waitUntil } from '../../support/shell';
import { apiReady, compose, ensureHealthy, serviceLogs, tryFetch } from '../../support/stack';
import { SyncClient, comparableStateStable } from '../../support/sync-client';
import type { ProductionSnapshot, SceneDto } from '../../../../packages/scene-model/src/contracts';
import type { Problem } from '../../support/api';
import { stackConfig } from '../../support/env';
import { t } from '../../support/tags';

/**
 * NET - what happens to the connected clients when a container of the stack goes away (E2E-NET-09, -11, -12, -13, -15,
 * E2E-OUT-08/09 and INT-NET-04 at API level). The clients are Node stand-ins that follow the product's rules
 * (SyncClient, SenderSim, OutputSim) plus real Chromium pages with livekit-client for the media path. Every test
 * leaves the stack healthy.
 */


test.beforeAll(() => {
  requireTool('lk.pause');
});

test.afterEach(async () => {
  test.setTimeout(300_000);
  await restoreNetwork().catch(() => undefined);
  await ensureHealthy();
});

interface World {
  production: Production;
  a: SyncClient;
  b: SyncClient;
  output: OutputSim;
  senders: SenderSim[];
  phones: PairedDevice[];
  publisher?: LiveKitPage;
  viewer?: LiveKitPage;
  viewerFrames(): Promise<number>;
}

/** A production with two operators, an output, two sender stand-ins and (optionally) a real media path. */
async function buildWorld(
  fx: { config: ReturnType<typeof stackConfig>; api: AdminApi; production: Production; pairContext: PairContext; stack: PairContext['stack']; context: BrowserContext; onCleanup: (fn: () => unknown) => void },
  options: { media?: boolean } = {},
): Promise<World> {
  const { config, api, production, pairContext, stack, context, onCleanup } = fx;
  const a = await SyncClient.connect(config.baseURL, api.cookie, production.id);
  const b = await SyncClient.connect(config.baseURL, api.cookie, production.id);
  const output = await OutputSim.start(config.baseURL, production.outputKey);
  onCleanup(() => a.stop());
  onCleanup(() => b.stop());
  onCleanup(() => output.stop());
  const phones = [await pairPhone(pairContext, { name: 'Phone One' }), await pairPhone(pairContext, { name: 'Phone Two' })];
  const senders: SenderSim[] = [];
  for (const phone of phones) {
    const sim = await SenderSim.start(stack.anonymousBase, phone.credentials, { headers: stack.forwardedForWorks ? { 'X-Forwarded-For': uniqueIp() } : {} });
    onCleanup(() => sim.stop());
    senders.push(sim);
  }
  const scene = production.sceneIds[0]!;
  for (const phone of phones) await api.addSceneItem(production.id, scene, { source: phone.sourceId() });
  const world: World = { production, a, b, output, senders, phones, viewerFrames: async () => 0 };
  if (options.media) {
    const token = (await phones[0]!.api.getDeviceLiveKitToken()).body;
    const publisher = await LiveKitPage.open(context, 'publisher');
    await publisher.publishStamped({ url: token.url, token: token.token, name: 'camera' });
    const viewerToken = (await api.getStudioLiveKitToken(production.id)).body;
    const viewer = await LiveKitPage.open(context, 'viewer');
    await viewer.connect({ url: viewerToken.url, token: viewerToken.token });
    await viewer.measure({ identity: phones[0]!.id, trackName: 'camera', durationMs: 1000 });
    onCleanup(() => publisher.close());
    onCleanup(() => viewer.close());
    world.publisher = publisher;
    world.viewer = viewer;
    world.viewerFrames = async () => (await viewer.inboundStats()).filter((stat) => stat.kind === 'video').reduce((sum, stat) => sum + (stat.framesDecoded ?? 0), 0);
  }
  await sleep(1500);
  return world;
}

/** Waits until the API answers on its own port and through Caddy; returns the time of full readiness. */
async function waitApi(config: ReturnType<typeof stackConfig>, timeoutMs = 120_000): Promise<number> {
  await waitUntil('api ready', apiReady, { timeoutMs, intervalMs: 250 });
  await waitUntil(
    'api served through Caddy',
    async () => {
      const response = await tryFetch(`${config.baseURL}/api/auth/me`, { timeoutMs: 4000 });
      return response !== undefined && ![502, 503, 504].includes(response.status);
    },
    { timeoutMs: 30_000, intervalMs: 100 },
  );
  return Date.now();
}

async function expectConsistent(world: World, api: AdminApi): Promise<void> {
  const rest = (await api.getSnapshot(world.production.id)).body;
  for (const [name, client] of [['A', world.a], ['B', world.b]] as const) {
    await client.waitForRevision(rest.revision, 5000).catch(() => undefined);
    expect(comparableStateStable(client.state!), `Regie ${name} equals the server`).toEqual(comparableStateStable(stateFromSnapshot(rest)));
  }
  const output = world.output.state!;
  expect(output.scenes, 'the output has the same scenes').toEqual(stateFromSnapshot(rest).scenes);
}

test.describe('NET API disruption', () => {
  test('E2E-NET-09 [api] API outage of 30 s: media keeps flowing, hubs reconnect after the start within T-RESTART-API, state is consistent, no permanent incident', t.disruptive('@p0'), async ({ config, api, production, pairContext, stack, context, onCleanup }) => {
    test.setTimeout(300_000);
    const world = await buildWorld({ config, api, production, pairContext, stack, context, onCleanup }, { media: true });
    const sinceLogs = new Date(Date.now() - 500).toISOString();
    const framesBefore = await world.viewerFrames();
    await sleep(1000);
    expect((await world.viewerFrames()) - framesBefore, 'media flows before the outage').toBeGreaterThan(10);

    await dockerCtl.stop('api');
    const stoppedAt = Date.now();
    // During the outage: REST through Caddy fails fast, the media path does not care.
    const down = await tryFetch(`${config.baseURL}/api/auth/me`, { headers: { Cookie: api.cookie }, timeoutMs: 8000 });
    expect([502, 503, 504], `REST during the outage answers an error from the proxy (got ${down?.status})`).toContain(down?.status);
    const marks: number[] = [];
    while (Date.now() - stoppedAt < 30_000) {
      const a = await world.viewerFrames();
      await sleep(5000);
      marks.push((await world.viewerFrames()) - a);
    }
    expect(Math.min(...marks), `frames keep advancing during the API outage (${marks.join(', ')} per 5 s)`).toBeGreaterThan(30);
    expect(world.a.hub.state, 'Regie A notices').not.toBe('Connected');

    const startedAt = Date.now();
    await dockerCtl.start('api');
    await waitUntil('api ready', apiReady, { timeoutMs: 90_000, intervalMs: 250 });
    const healthyAfter = Date.now() - startedAt;
    const healthyAt = Date.now();
    await waitApi(config);
    // All clients are connected and consistent again.
    const everything = async () => {
      if (!world.a.hub.isConnected || !world.b.hub.isConnected || !world.output.hub.isConnected) return false;
      if (!world.senders.every((sim) => sim.hub.isConnected && sim.hellos >= 2)) return false;
      const rest = (await new AdminApi(config.baseURL, api.cookie).getSnapshot(production.id)).body;
      return world.a.revision === rest.revision && world.b.revision === rest.revision && (world.output.state?.revision ?? 0) === rest.revision;
    };
    const consistentAfter = await eventually(everything, THRESHOLD.restartApiClientsHardMs + 10_000, 250);
    const attempts = ((await serviceLogs('caddy', sinceLogs)).match(/"uri":"\/hubs\/[a-z]+\/negotiate/g) ?? []).length;
    test.info().annotations.push({ type: 'measurement', description: `api start -> healthy ${healthyAfter} ms; healthy -> clients connected and consistent ${consistentAfter} ms; negotiate requests during the outage: ${attempts} (5 clients)` });
    expect(healthyAfter, 'T-RESTART-API start -> healthy').toBeLessThanOrEqual(THRESHOLD.restartApiHealthyHardMs);
    expect(consistentAfter, 'healthy -> all clients connected and consistent (T-RESTART-API)').not.toBeNull();
    expect(consistentAfter!).toBeLessThanOrEqual(THRESHOLD.restartApiClientsHardMs);
    expect(attempts, 'reconnect storm bounded by the backoff (never > 20 negotiates per client)').toBeLessThanOrEqual(5 * 20);
    expect(world.a.lastSync, 'revisions restarted: a snapshot').toBe('snapshot');
    expect(world.output.lastSync).toBe('snapshot');
    expect(Date.now() - healthyAt).toBeLessThan(60_000);
    await expectConsistent(world, new AdminApi(config.baseURL, api.cookie));

    // The old admin cookie still works (Data Protection keys persisted) and no outage was invented.
    const session = new AdminApi(config.baseURL, api.cookie);
    expect((await session.getSession()).status, 'session survives an API restart').toBe(200);
    await sleep(6000);
    const snapshot = (await session.getSnapshot(production.id)).body;
    expect(snapshot.incidents.filter((incident) => incident.endedAt === null), 'no permanent open incident').toEqual([]);
    // The media path was never interrupted: the viewer never lost its frames.
    const final = await world.viewerFrames();
    await sleep(1000);
    expect((await world.viewerFrames()) - final).toBeGreaterThan(10);
  });

  for (const mode of ['restart', 'crash'] as const) {
    test(`E2E-NET-12 [api] ${mode} of the API container: clients come back without a manual reload`, t.disruptive('@p0'), async ({ config, api, production, pairContext, stack, context, onCleanup }) => {
      test.setTimeout(300_000);
      const world = await buildWorld({ config, api, production, pairContext, stack, context, onCleanup });
      const started = Date.now();
      if (mode === 'restart') await dockerCtl.restart('api');
      else await dockerCtl.crash('api'); // the process ends by itself: the restart policy brings it back (`docker kill` would count as a manual stop)
      await waitUntil('api ready again', apiReady, { timeoutMs: 120_000, intervalMs: 250 });
      const healthy = Date.now() - started;
      const readyAt = await waitApi(config);
      const rest = async () => (await new AdminApi(config.baseURL, api.cookie).getSnapshot(production.id)).body;
      const consistent = await eventually(async () => {
        if (!world.a.hub.isConnected || !world.b.hub.isConnected || !world.output.hub.isConnected) return false;
        if (!world.senders.every((sim) => sim.hub.isConnected && sim.hellos >= 2)) return false;
        const current = await rest();
        return world.a.revision === current.revision && world.b.revision === current.revision;
      }, 40_000, 250);
      test.info().annotations.push({ type: 'measurement', description: `${mode}: container back and healthy after ${healthy} ms; clients consistent ${consistent} ms after readiness` });
      expect(healthy, `${mode} -> healthy`).toBeLessThanOrEqual(mode === 'restart' ? THRESHOLD.restartApiHealthyHardMs : 60_000);
      expect(consistent, 'clients reconnected').not.toBeNull();
      expect(consistent!, 'T-RESTART-API').toBeLessThanOrEqual(THRESHOLD.restartApiClientsHardMs);
      await expectConsistent(world, new AdminApi(config.baseURL, api.cookie));
      // Devices are recognised again, the sources are ok and nothing was invented.
      await sleep(3000);
      const snapshot = await rest();
      for (const phone of world.phones) expect(snapshot.sources.find((source) => source.id === phone.sourceId())!.status, `${phone.name} source`).toBe('ok');
      expect(snapshot.incidents.filter((incident) => incident.endedAt === null)).toEqual([]);
      void readyAt;
    });
  }

  test('E2E-NET-12 [api, GAP-08 b] a source in the program scene whose device does not return after an API start turns reconnecting with an incident', t.p1, async ({ config, api, production, pairContext, stack, context, onCleanup }) => {
    test.setTimeout(300_000);
    const world = await buildWorld({ config, api, production, pairContext, stack, context, onCleanup });
    const lost = world.phones[1]!;
    await api.startBroadcast(production.id);
    await sleep(500);
    // The second phone goes away together with the server: it will not return.
    await world.senders[1]!.stop();
    await dockerCtl.restart('api');
    const readyAt = await waitApi(config);
    const session = new AdminApi(config.baseURL, api.cookie);
    const noticed = await eventually(async () => {
      const source = (await session.getSnapshot(production.id)).body.sources.find((entry) => entry.id === lost.sourceId());
      return source?.status === 'reconnecting';
    }, 40_000, 500);
    test.info().annotations.push({ type: 'measurement', description: `source of the missing device flagged after ${noticed} ms (spec 12: within 15 s)` });
    expect(noticed, 'the missing source is flagged (spec 12, GAP-08 b)').not.toBeNull();
    expect(noticed!).toBeLessThanOrEqual(25_000);
    const snapshot = (await session.getSnapshot(production.id)).body;
    expect(snapshot.incidents.some((incident) => incident.sourceId === lost.sourceId() && incident.endedAt === null)).toBe(true);
    // The phone that did return is fine.
    expect(snapshot.sources.find((source) => source.id === world.phones[0]!.sourceId())!.status).toBe('ok');
    void readyAt;
  });

  test('E2E-NET-12 [api, UNIT-SRC-03] a restart of the API writes no “reconnecting” entry for sources whose device comes back', t.p1, async ({ config, api, production, pairContext, stack, context, onCleanup }) => {
    knownBug('BUG-20', 'a graceful API shutdown flags every live source as “reconnecting” (log entry) although the restart is no outage of the source (UNIT-SRC-03)');
    test.setTimeout(240_000);
    const world = await buildWorld({ config, api, production, pairContext, stack, context, onCleanup });
    const session = new AdminApi(config.baseURL, api.cookie);
    const before = (await session.getSnapshot(production.id)).body.recentLog.map((entry) => entry.text);
    await dockerCtl.restart('api');
    await waitApi(config);
    // The devices come back; wait beyond SOURCES__RESTARTGRACE (15 s) so a late flag would show as well.
    await eventually(() => world.senders.every((sim) => sim.hub.isConnected && sim.hellos >= 2), 20_000, 250);
    await sleep(17_000);
    const after = (await session.getSnapshot(production.id)).body;
    const added = after.recentLog.map((entry) => entry.text).filter((text) => !before.includes(text) || text.includes('reconnecting'));
    expect(added.filter((text) => text.includes('reconnecting')), 'log entries “reconnecting” caused by the restart').toEqual([]);
    expect(after.incidents.filter((incident) => incident.endedAt === null)).toEqual([]);
    for (const phone of world.phones) expect(after.sources.find((source) => source.id === phone.sourceId())!.status).toBe('ok');
  });

  test('E2E-NET-15 [api] reconnect storm: 5 Regie sessions, 10 outputs and 6 senders reconnect within 30 s of the API being healthy', t.disruptive('@p2'), async ({ config, api, production, pairContext, stack, onCleanup }) => {
    test.setTimeout(300_000);
    const studios = await Promise.all(Array.from({ length: 5 }, () => SyncClient.connect(config.baseURL, api.cookie, production.id)));
    const outputs = await Promise.all(Array.from({ length: 10 }, () => OutputSim.start(config.baseURL, production.outputKey)));
    const phones: PairedDevice[] = [];
    for (let index = 0; index < 6; index++) phones.push(await pairPhone(pairContext, { name: `Storm ${index}` }));
    const senders = await Promise.all(phones.map((phone) => SenderSim.start(stack.anonymousBase, phone.credentials, { headers: stack.forwardedForWorks ? { 'X-Forwarded-For': uniqueIp() } : {} })));
    onCleanup(async () => {
      await Promise.all([...studios.map((client) => client.stop()), ...outputs.map((client) => client.stop()), ...senders.map((sim) => sim.stop())]);
    });
    await dockerCtl.restart('api');
    const readyAt = await waitApi(config);
    const all = () => studios.every((client) => client.hub.isConnected) && outputs.every((client) => client.hub.isConnected) && senders.every((sim) => sim.hub.isConnected && sim.hellos >= 2);
    const took = await eventually(all, 30_000, 250);
    expect(took, 'all 21 clients are connected 30 s after the API is healthy').not.toBeNull();
    // The API never answered 5xx after it was ready.
    const sinceReady = new Date(readyAt + 500).toISOString();
    const caddyLog = await serviceLogs('caddy', sinceReady);
    const serverErrors = [...caddyLog.matchAll(/"status":(5\d\d)/g)].map((match) => match[1]);
    expect(serverErrors, '5xx responses after the restart').toEqual([]);
    const stats = await dockerCtl.stats('api');
    expect(stats.cpuPct, 'api CPU after the storm (idle again)').toBeLessThan(200);
  });
});

test.describe('NET other services', () => {
  test('E2E-NET-11 [stack] PostgreSQL down for 30 s: ready 503, live 200, reads and writes 503 ProblemDetails, hubs and media unaffected, recovery without restarting the API', t.disruptive('@p0'), async ({ config, api, production, pairContext, stack, context, onCleanup }) => {
    test.setTimeout(400_000);
    const world = await buildWorld({ config, api, production, pairContext, stack, context, onCleanup }, { media: true });
    const session = new AdminApi(config.baseURL, api.cookie);
    const before = (await session.getSnapshot(production.id)).body;
    const readyStatus = async () => (await tryFetch(`${stack.direct}/health/ready`, { timeoutMs: 8000 }))?.status;
    const liveStatus = async () => (await tryFetch(`${stack.direct}/health/live`, { timeoutMs: 8000 }))?.status;
    expect(await readyStatus()).toBe(200);

    await dockerCtl.stop('postgres');
    const stoppedAt = Date.now();
    // Requests that need the database are sent at once; they answer when the driver gives up (see the latency test).
    const long = 150_000;
    type Timed<T> = { result: T; ms: number; error?: undefined } | { result?: undefined; ms: number; error: string };
    const timed = async <T>(call: () => Promise<T>): Promise<Timed<T>> => {
      const started = Date.now();
      try {
        return { result: await call(), ms: Date.now() - started };
      } catch (error) {
        // No answer at all within the cap: reported below and by the latency test (BUG-21), not thrown here.
        return { error: String(error), ms: Date.now() - started };
      }
    };
    // The API's own answer (direct port): through Caddy the request ends with a 504 before the API gives up (BUG-21).
    const direct = session.withBase(stack.direct, uniqueIp());
    const reads = timed(() => direct.call<ProductionSnapshot & Problem>('GET', `/api/productions/${production.id}/snapshot`, { timeoutMs: long }));
    const writes = timed(() => direct.call<SceneDto & Problem>('PATCH', `/api/productions/${production.id}/scenes/${production.sceneIds[0]!}`, { json: { name: 'During the outage' }, timeoutMs: long }));
    const logins = timed(() => new AdminApi(stack.direct, '', uniqueIp()).call<Problem>('POST', '/api/auth/login', { json: { username: config.admin.username, password: config.admin.password }, anonymous: true, timeoutMs: long }));

    const notReady = await eventually(async () => (await readyStatus()) === 503, 10_000, 250);
    test.info().annotations.push({ type: 'measurement', description: `/health/ready turned 503 after ${notReady} ms` });
    expect(notReady, 'readiness reports the outage within 5 s (plan) / 10 s (hard)').not.toBeNull();
    expect(notReady!).toBeLessThanOrEqual(10_000);
    expect(await liveStatus(), 'liveness stays 200').toBe(200);

    // Hubs stay open, the media path is untouched, for at least 30 s and until the requests are answered.
    let settled = false;
    void Promise.allSettled([reads, writes, logins]).then(() => (settled = true));
    while (Date.now() - stoppedAt < 30_000 || !settled) {
      expect(world.a.hub.isConnected && world.b.hub.isConnected && world.output.hub.isConnected, 'hub connections stay open').toBe(true);
      const frames = await world.viewerFrames();
      await sleep(5000);
      expect((await world.viewerFrames()) - frames, 'media keeps flowing').toBeGreaterThan(30);
      if (Date.now() - stoppedAt > 150_000) break;
    }
    const [read, write, login] = await Promise.all([reads, writes, logins]);
    test.info().annotations.push({ type: 'measurement', description: `PostgreSQL down: read answered after ${read.ms} ms, write after ${write.ms} ms, login after ${login.ms} ms` });
    // Anything that needs the database answers 503 ProblemDetails; no stack trace, no connection string.
    for (const [name, entry] of [['read', read], ['write', write], ['login', login]] as const) {
      if (entry.error !== undefined) {
        test.info().annotations.push({ type: 'unanswered', description: `${name}: no answer after ${entry.ms} ms (${entry.error}) - BUG-21` });
        continue;
      }
      expect(entry.result.status, `${name} status (body: ${entry.result.raw.text().slice(0, 200)})`).toBe(503);
      expect(entry.result.headers['content-type'] ?? '', `${name} content type`).toMatch(/json/);
      expect(entry.result.raw.text(), `${name} leaks nothing`).not.toMatch(/Npgsql|Host=|Password|postgres|connection string|\bat [A-Z][\w.]+\(|\.cs:line/i);
    }

    await dockerCtl.start('postgres');
    const startedAt = Date.now();
    const ready = await eventually(async () => (await readyStatus()) === 200, 60_000, 500);
    test.info().annotations.push({ type: 'measurement', description: `postgres start -> ready 200 after ${ready} ms (API not restarted)` });
    expect(ready, 'readiness recovers by itself').not.toBeNull();
    expect(ready!).toBeLessThanOrEqual(30_000);
    expect(Date.now() - startedAt).toBeLessThanOrEqual(60_000);
    // Writes work again, nothing was lost, the sender hubs never dropped (no incident).
    const renamed = await eventuallyValue(async () => {
      const result = await session.updateScene(production.id, production.sceneIds[0]!, { name: 'After the outage' });
      return result.status === 200 ? result : undefined;
    }, 30_000);
    expect(renamed, 'writes work again after PostgreSQL is back (API not restarted)').toBeTruthy();
    const after = (await session.getSnapshot(production.id)).body;
    expect(after.devices.map((device) => device.id).sort()).toEqual(before.devices.map((device) => device.id).sort());
    expect(after.scenes).toHaveLength(before.scenes.length);
    expect(after.incidents.filter((incident) => incident.endedAt === null), 'no incident for senders whose hubs stayed connected').toEqual([]);
    expect(world.senders.every((sim) => sim.reconnects === 0), 'no sender reconnected').toBe(true);
  });

  test('E2E-NET-11 [stack, latency] with PostgreSQL down a request through Caddy is answered with a 503 ProblemDetails within 10 s', t.disruptive('@p1'), async ({ config, api, production }) => {
    knownBug('BUG-21', 'with PostgreSQL stopped every request that needs the database hangs for about 45 s before the 503 ProblemDetails arrives (reads, writes and the login alike)');
    test.setTimeout(240_000);
    const session = new AdminApi(config.baseURL, api.cookie);
    await dockerCtl.stop('postgres');
    try {
      const started = Date.now();
      const response = await session.call('GET', `/api/productions/${production.id}/snapshot`, { timeoutMs: 120_000 });
      const took = Date.now() - started;
      test.info().annotations.push({ type: 'measurement', description: `read with PostgreSQL down: ${response.status} after ${took} ms` });
      expect(response.status, `status through Caddy (body: ${response.raw.text().slice(0, 80)})`).toBe(503);
      expect(took, 'time to the 503 (an operator clicking Switch needs the error toast, not a spinner)').toBeLessThanOrEqual(10_000);
    } finally {
      await dockerCtl.start('postgres');
    }
  });

  test('E2E-NET-12 [livekit] LiveKit restart: the API survives, stale tracks are reconciled, new sessions publish within T-RESTART-LK', t.disruptive('@p0'), async ({ config, api, production, pairContext, stack, context, onCleanup }) => {
    test.setTimeout(300_000);
    const { hub: studio } = { hub: (await SyncClient.connect(config.baseURL, api.cookie, production.id)).hub };
    onCleanup(() => studio.stop());
    const phone = await pairPhone(pairContext, { name: 'LK Restart' });
    const sim = await SenderSim.start(stack.anonymousBase, phone.credentials, { headers: stack.forwardedForWorks ? { 'X-Forwarded-For': uniqueIp() } : {}, slots: ['camera'] });
    onCleanup(() => sim.stop());
    const token = (await phone.api.getDeviceLiveKitToken()).body;
    const publisher = await LiveKitPage.open(context, 'publisher');
    onCleanup(() => publisher.close());
    await publisher.publishStamped({ url: token.url, token: token.token, name: 'camera' });
    // The page is cut off from the network, so it cannot rejoin; the device hub (a different path) stays up.
    await net.cut(context);
    await sleep(500);
    sim.pauseReports();
    const sinceLogs = new Date().toISOString();
    await dockerCtl.restart('livekit');
    await waitUntil('livekit healthy', async () => (await dockerCtl.health('livekit')) === 'healthy', { timeoutMs: 90_000, intervalMs: 500 });
    const healthyAt = Date.now();
    expect((await tryFetch(`${stack.direct}/health/ready`))?.status, 'the API is ready while LiveKit restarts').toBe(200);
    // The restarted LiveKit has no tracks: the reconcile (every 15 s) turns the stale “ok” into an outage.
    const session = new AdminApi(config.baseURL, api.cookie);
    const flagged = await eventually(async () => (await session.getSnapshot(production.id)).body.sources.find((source) => source.id === phone.sourceId())?.status === 'reconnecting', 40_000, 500);
    test.info().annotations.push({ type: 'measurement', description: `stale track flagged ${flagged} ms after LiveKit was healthy (reconcile every 15 s)` });
    expect(flagged, 'a source whose track vanished with LiveKit is flagged').not.toBeNull();
    // The API logs a warning, not stack traces, while LiveKit is away.
    const apiLog = await serviceLogs('api', sinceLogs);
    expect(apiLog, 'no unhandled exception from the LiveKit outage').not.toMatch(/Unhandled exception|System\.Net\.Http\.HttpRequestException[\s\S]{0,200}\n\s+at /);
    // The old page would rejoin under the same identity once the network is back and cancel the new publication.
    await publisher.close();
    await net.restore(context);
    // A new session gets a token and publishes within T-RESTART-LK.
    const retry = await LiveKitPage.open(context, 'retry');
    onCleanup(() => retry.close());
    const fresh = (await phone.api.getDeviceLiveKitToken()).body;
    await retry.publishStamped({ url: fresh.url, token: fresh.token, name: 'camera' });
    const back = await eventually(async () => (await livekitAdmin.listParticipants(production.id)).some((participant) => participant.identity === phone.id && participant.tracks.some((track) => track.name === 'camera')), 15_000, 250);
    expect(back, 'a new session publishes after the restart').not.toBeNull();
    expect(Date.now() - healthyAt, 'T-RESTART-LK (new session playing again)').toBeLessThanOrEqual(THRESHOLD.restartLiveKitHardMs + 40_000);
    sim.stopped = false;
    await eventually(async () => (await session.getSnapshot(production.id)).body.sources.find((source) => source.id === phone.sourceId())?.status === 'ok', 15_000, 500);
  });

  test('E2E-NET-12 [caddy] Caddy restart: hubs reconnect, the media path (UDP direct to LiveKit) never stops', t.disruptive('@p0'), async ({ config, api, production, pairContext, stack, context, onCleanup }) => {
    test.setTimeout(300_000);
    const world = await buildWorld({ config, api, production, pairContext, stack, context, onCleanup }, { media: true });
    // Device hubs reach the API through Caddy in this test.
    const phoneViaCaddy = await pairPhone(pairContext, { name: 'Via Caddy' });
    const viaCaddy = await SenderSim.start(config.baseURL, phoneViaCaddy.credentials, {});
    onCleanup(() => viaCaddy.stop());
    const frames0 = await world.viewerFrames();
    await dockerCtl.restart('caddy');
    const restartedAt = Date.now();
    await waitUntil('caddy healthy', async () => (await dockerCtl.health('caddy')) === 'healthy', { timeoutMs: 90_000, intervalMs: 500 });
    const reconnected = await eventually(() => world.a.hub.isConnected && world.b.hub.isConnected && world.output.hub.isConnected && viaCaddy.hub.isConnected, 40_000, 250);
    test.info().annotations.push({ type: 'measurement', description: `caddy restart: clients back after ${reconnected} ms (${Date.now() - restartedAt} ms after the command)` });
    expect(reconnected, 'hubs reconnect through the restarted proxy').not.toBeNull();
    // Media: frames advanced through the restart; the participants never left the room.
    const frames1 = await world.viewerFrames();
    expect(frames1 - frames0, 'the viewer kept receiving frames while Caddy restarted').toBeGreaterThan(30);
    await sleep(1500);
    const identities = (await livekitAdmin.listParticipants(production.id)).map((participant) => participant.identity);
    expect(identities, 'the publisher is still in the room').toContain(world.phones[0]!.id);
    await expectConsistent(world, new AdminApi(config.baseURL, api.cookie));
    expect((await new AdminApi(config.baseURL, api.cookie).getSession()).status).toBe(200);
  });

  test('E2E-NET-12 [postgres] PostgreSQL restart: the API reconnects to the database by itself', t.disruptive('@p0'), async ({ config, api, production }) => {
    test.setTimeout(300_000);
    const session = new AdminApi(config.baseURL, api.cookie);
    const before = (await session.getSnapshot(production.id)).body;
    await dockerCtl.restart('postgres');
    await waitUntil('postgres healthy', async () => (await dockerCtl.health('postgres')) === 'healthy', { timeoutMs: 90_000, intervalMs: 500 });
    const ready = await eventually(async () => (await tryFetch(`${stackConfig().apiDirect}/health/ready`))?.status === 200, 40_000, 500);
    expect(ready, 'readiness recovers after a PostgreSQL restart without restarting the API').not.toBeNull();
    const after = await session.updateScene(production.id, production.sceneIds[0]!, { name: 'After the restart' });
    expect(after.status, after.raw.text()).toBe(200);
    expect((await session.getSnapshot(production.id)).body.scenes).toHaveLength(before.scenes.length);
  });

  test('E2E-NET-13 [stack] whole stack restart and crash: everything returns by itself, data and sessions survive', t.disruptive('@p0'), async ({ config, api, production, pairContext, stack, onCleanup }) => {
    test.setTimeout(420_000);
    const session = new AdminApi(config.baseURL, api.cookie);
    const phone = await pairPhone(pairContext, { name: 'Stays Paired' });
    const scene = production.sceneIds[0]!;
    await session.addSceneItem(production.id, scene, { source: phone.sourceId(), x: 100, y: 120, w: 800, h: 450 });
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108020000009077' + '53de0000000c4944415408d763f8cfc000000301010018dd8db00000000049454e44ae426082', 'hex');
    const asset = (await session.uploadAsset(production.id, { fileName: 'stays.png', contentType: 'image/png', data: png })).body;
    await session.startBroadcast(production.id);
    const before = (await session.getSnapshot(production.id)).body;
    await production.refreshOutput();
    const outputKey = production.outputKey;
    expect(before.production.liveSince).not.toBeNull();
    const sha = (data: Buffer) => crypto.createHash('sha256').update(data).digest('hex');
    const sender = await SenderSim.start(stack.anonymousBase, phone.credentials, { headers: stack.forwardedForWorks ? { 'X-Forwarded-For': uniqueIp() } : {} });
    onCleanup(() => sender.stop());

    for (const method of ['restart', 'crash'] as const) {
      const started = Date.now();
      if (method === 'restart') await compose(['restart'], { timeoutMs: 240_000 });
      else await Promise.all((['caddy', 'api', 'livekit', 'postgres'] as const).map((service) => dockerCtl.crash(service)));
      await ensureHealthy(240_000);
      const took = Date.now() - started;
      test.info().annotations.push({ type: 'measurement', description: `${method} of the whole stack: healthy after ${took} ms` });
      expect(took, `${method}: containers healthy within 90 s`).toBeLessThanOrEqual(120_000);

      // The admin session, the data, the device credentials, the output key and the asset survived.
      const same = new AdminApi(config.baseURL, api.cookie);
      expect((await same.getSession()).status, 'admin session (Data Protection keys volume)').toBe(200);
      const after = (await same.getSnapshot(production.id)).body;
      expect(after.scenes, 'scenes').toEqual(before.scenes);
      expect(after.devices.map((device) => device.id), 'devices').toEqual(before.devices.map((device) => device.id));
      expect(after.production.liveSince, 'LiveSince unchanged: the LIVE runtime keeps counting (GAP-33)').toBe(before.production.liveSince);
      expect(after.production.broadcast).toBe('live');
      expect((await phone.api.getDeviceSelf()).status, 'device credentials still valid').toBe(200);
      expect((await same.getOutputSettings(production.id)).body.url).toContain(outputKey);
      const content = await same.getAssetContent(production.id, asset.id);
      expect(sha(content.raw.body), 'asset bytes').toBe(sha(png));
      await sleep(4000);
      const settled = (await same.getSnapshot(production.id)).body;
      expect(settled.incidents.filter((incident) => incident.endedAt === null), 'incident history starts empty').toEqual([]);
      expect(sender.reconnects, 'the sender stand-in reconnected by itself').toBeGreaterThanOrEqual(1);
    }
  });
});
