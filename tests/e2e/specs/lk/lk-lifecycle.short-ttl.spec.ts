import { AdminApi, DeviceApi } from '../../support/api';
import { dockerCtl } from '../../support/docker-ctl';
import { expect, skipUnsupported, test, uniqueIp } from '../../support/fixtures';
import { livekitAdmin } from '../../support/livekit';
import { LiveKitPage } from '../../support/livekit-browser';
import { pairPhone, waitForSource } from '../../support/production';
import { SenderSim, eventually } from '../../support/sim';
import { sleep, waitUntil } from '../../support/shell';
import { apiReady, serviceLogs } from '../../support/stack';
import { t } from '../../support/tags';
import { probeTtlSupport, useDefaultTtl, useDefaultTtlLiveKit, useShortTtl, useShortTtlLiveKit, type TtlSupport } from '../../support/ttl';

/**
 * LK with the short profile (docs/testing.md 1.2.6): LiveKit room.empty_timeout 10 s and, where the API reads the
 * keys, LiveKit:TokenTtl 60 s. E2E-LK-03 room lifecycle and E2E-NET-26 token expiry.
 */

let support: TtlSupport;

test.beforeAll(async () => {
  test.setTimeout(420_000);
  await useShortTtl();
  await useShortTtlLiveKit();
  support = await probeTtlSupport();
  test.info().annotations.push({ type: 'ttl-support', description: JSON.stringify(support) });
});

test.afterAll(async () => {
  test.setTimeout(420_000);
  await useDefaultTtl();
  await useDefaultTtlLiveKit();
});

test.describe('LK short profile', () => {
  test('E2E-LK-03 [lk] an empty room is closed after empty_timeout, recreated on demand under the same name; after an API restart the live source returns to ok without an incident', t.shortTtl('@p2'), async ({ api, production, pairContext, stack, context, onCleanup }) => {
    test.setTimeout(300_000);
    const phone = await pairPhone(pairContext, { name: 'Room Phone' });
    const headers: Record<string, string> = stack.forwardedForWorks ? { 'X-Forwarded-For': uniqueIp() } : {};
    let sim = await SenderSim.start(stack.anonymousBase, phone.credentials, { headers });
    onCleanup(() => sim.stop());
    const publish = async (label: string) => {
      const token = (await phone.api.getDeviceLiveKitToken()).body;
      const page = await LiveKitPage.open(context, label);
      onCleanup(() => page.close());
      await page.publishStamped({ url: token.url, token: token.token, name: 'camera' });
      return page;
    };
    const first = await publish('first');
    await waitForSource(api, production.id, phone.sourceId(), (source) => source.status === 'ok', 15_000);
    expect((await livekitAdmin.listRooms()).map((room) => room.name), 'the room is named after the production').toContain(production.id);

    // Everybody leaves: the sender page and the device connection.
    await first.leave();
    await sim.stop();
    const gone = await eventually(async () => !(await livekitAdmin.listRooms()).some((room) => room.name === production.id), 40_000, 1000);
    test.info().annotations.push({ type: 'measurement', description: `empty room closed ${gone} ms after the last participant left (departure_timeout 20 s, empty_timeout 10 s)` });
    expect(gone, 'the empty room is closed after empty_timeout').not.toBeNull();
    expect(gone!, 'not earlier than the timeout, not much later').toBeGreaterThanOrEqual(5000);

    // A sender rejoins: auto_create recreates the room under the same name; the source is ok again.
    sim = await SenderSim.start(stack.anonymousBase, phone.credentials, { headers });
    onCleanup(() => sim.stop());
    await publish('second');
    expect((await livekitAdmin.listRooms()).map((room) => room.name), 'the room is recreated on demand').toContain(production.id);
    await waitForSource(api, production.id, phone.sourceId(), (source) => source.status === 'ok', 15_000);

    // API restart with participants present: the live source comes back to ok, no incident stays open.
    await dockerCtl.restart('api');
    await waitUntil('api ready', apiReady, { timeoutMs: 120_000, intervalMs: 250 });
    const session = new AdminApi(api.base, api.cookie);
    await waitForSource(session, production.id, phone.sourceId(), (source) => source.status === 'ok', 40_000);
    await sleep(17_000); // beyond SOURCES__RESTARTGRACE
    const snapshot = (await session.getSnapshot(production.id)).body;
    expect(snapshot.sources.find((source) => source.id === phone.sourceId())?.status).toBe('ok');
    expect(snapshot.incidents.filter((incident) => incident.endedAt === null), 'no open incident after the restart').toEqual([]);
    expect((await livekitAdmin.listParticipants(production.id)).map((participant) => participant.identity)).toContain(phone.id);
  });

  test('E2E-NET-26 [lk] with a token lifetime of 60 s a connection survives 5 minutes; an expired token is refused; a rejoin fetches exactly one new token and causes no 401 loop', t.shortTtl('@p1'), async ({ config, api, production, pairContext, stack, context, onCleanup }) => {
    skipUnsupported(!support.tokenTtl, `GAP-01: LiveKit:TokenTtl is not read by the API (a token lives ${support.observed.token} s, expected about 60 s)`);
    test.setTimeout(600_000);
    const phone = await pairPhone(pairContext, { name: 'Token Phone' });
    const netHeaders: Record<string, string> = stack.forwardedForWorks ? { 'X-Forwarded-For': uniqueIp() } : {};
    const sim = await SenderSim.start(stack.anonymousBase, phone.credentials, { headers: netHeaders });
    onCleanup(() => sim.stop());
    // Through Caddy, so that its access log counts the token requests (the direct API port is not logged).
    const viaCaddy = new DeviceApi(config.baseURL, phone.credentials);
    const since = new Date().toISOString();
    const first = (await viaCaddy.getDeviceLiveKitToken()).body;
    expect(Date.parse(first.expiresAt) - Date.now(), 'token lifetime').toBeLessThanOrEqual(90_000);
    const publisher = await LiveKitPage.open(context, 'publisher');
    onCleanup(() => publisher.close());
    await publisher.publishStamped({ url: first.url, token: first.token, name: 'camera' });
    const viewerToken = (await api.getStudioLiveKitToken(production.id)).body;
    const viewer = await LiveKitPage.open(context, 'viewer');
    onCleanup(() => viewer.close());
    await viewer.connect({ url: viewerToken.url, token: viewerToken.token });
    await viewer.measure({ identity: phone.id, trackName: 'camera', durationMs: 1000 });
    const frames = async () => (await viewer.inboundStats()).filter((stat) => stat.kind === 'video').reduce((sum, stat) => sum + (stat.framesDecoded ?? 0), 0);

    // Five minutes, far beyond the 60 s lifetime of both tokens.
    const started = Date.now();
    while (Date.now() - started < 300_000) {
      const before = await frames();
      await sleep(30_000);
      expect((await frames()) - before, `frames advance at ${Math.round((Date.now() - started) / 1000)} s`).toBeGreaterThan(100);
      expect((await publisher.roomState()).state, 'publisher stays connected').toBe('connected');
    }
    expect((await livekitAdmin.listParticipants(production.id)).map((participant) => participant.identity), 'the publisher is still in the room').toContain(phone.id);
    const log = await serviceLogs('caddy', since);
    expect(log.match(/"uri":"\/api\/device\/livekit-token"/g)?.length ?? 0, 'token requests of the first 5 minutes').toBe(1);
    const unauthorizedIn = (text: string) => [...text.matchAll(/"uri":"\/rtc[^"]*"[^\n]*?"status":401/g)].length;
    expect(unauthorizedIn(log), 'no 401 on /rtc while the tokens expired under a running connection').toBe(0);

    // The expired token is refused by LiveKit.
    const stale = await LiveKitPage.open(context, 'stale');
    onCleanup(() => stale.close());
    const refused = await stale.tryConnect({ url: first.url, token: first.token });
    expect(refused.ok, 'a token older than its lifetime does not connect').toBe(false);
    const refusals = unauthorizedIn(await serviceLogs('caddy', since));
    expect(refusals, 'the refused attempt shows as 401 on /rtc (validate and upgrade request: at most 3)').toBeGreaterThanOrEqual(1);
    expect(refusals).toBeLessThanOrEqual(3);

    // A rejoin fetches one new token and works.
    await publisher.leave();
    const fresh = (await viaCaddy.getDeviceLiveKitToken()).body;
    const rejoin = await LiveKitPage.open(context, 'rejoin');
    onCleanup(() => rejoin.close());
    await rejoin.publishStamped({ url: fresh.url, token: fresh.token, name: 'camera' });
    const back = await eventually(async () => (await livekitAdmin.listParticipants(production.id)).some((participant) => participant.identity === phone.id && participant.tracks.some((track) => track.name === 'camera')), 15_000, 250);
    expect(back, 'the rejoined sender publishes again').not.toBeNull();
    const after = await serviceLogs('caddy', since);
    expect(after.match(/"uri":"\/api\/device\/livekit-token"/g)?.length ?? 0, 'one more token request for the rejoin').toBe(2);
    await sleep(10_000);
    expect(unauthorizedIn(await serviceLogs('caddy', since)), 'no stale-token 401 loop: nothing after the deliberate attempt').toBe(refusals);
  });
});
