import type { SlotState } from '../../../../packages/scene-model/src/contracts';
import { ERROR, THRESHOLD } from '../../support/constants';
import { expect, expectProblem, test, uniqueIp } from '../../support/fixtures';
import { expectConsecutive, openStudio, percentile } from '../../support/helpers';
import { DeviceHub, StudioHub, type HubSession } from '../../support/hubs';
import { pairLaptopByLink, pairPhone, type PairedDevice, type PairContext } from '../../support/production';
import { sleep } from '../../support/shell';
import { TcpProxy } from '../../support/tcp-proxy';
import { t } from '../../support/tags';

/**
 * SRC at API level: device hub connections drive the source status, incidents, log and tally the Regie sees
 * (docs/testing.md 2.5: INT-SRC-01..07, E2E-SRC-02/03/04/10/17/20/22 without browsers). The Node SignalR device client
 * plays the sender; silence is simulated with a TCP forwarder in front of the API (see TcpProxy): it swallows every
 * byte in both directions while the sockets stay open - what a Wi-Fi drop looks like to the server - and affects that
 * one connection only (docker pause/disconnect would hit every client at once).
 */

const slotReport = (slot: string, state: SlotState) => ({ slot, state, width: 1280, height: 720, fps: 30, bitrateKbps: 2500, packetLossPct: 0, codec: 'h264' });

function deviceHub(stack: PairContext['stack'], device: PairedDevice, base?: string, sessionId?: string): DeviceHub {
  const hub = DeviceHub.connect(base ?? stack.anonymousBase, device.credentials, { headers: stack.forwardedForWorks ? { 'X-Forwarded-For': uniqueIp() } : {} });
  if (sessionId) hub.sessionId = sessionId;
  return hub;
}

async function waitSource(studio: HubSession, sourceId: string, status: string, from: number, timeoutMs = 6000) {
  return (studio as StudioHub).waitForEvent('sourceUpserted', (event) => event.source.id === sourceId && event.source.status === status, { from, timeoutMs });
}

test.describe('SRC device hub', () => {
  test('INT-SRC-03 [stack] the source status follows the device report: connecting, ok, ended, lost, recovered, reconnecting', t.p0, async ({ config, api, production, pairContext, stack, onCleanup }) => {
    const { hub: studio } = await openStudio(config.baseURL, api, production, onCleanup);
    const phone = await pairPhone(pairContext, { name: 'Handy 1' });
    const id = phone.sourceId();
    const device = deviceHub(stack, phone);
    onCleanup(() => device.stop());

    expect((await production.snapshot()).sources.find((source) => source.id === id)!.status, 'a paired device that never connected').toBe('offline');
    const hello = await device.open();
    expect(hello.device.id).toBe(phone.id);
    expect(hello.tally.overall).toBe('off');
    await waitSource(studio, id, 'connecting', 0);
    expect((await production.snapshot()).incidents, 'no incident for a source that never went live').toHaveLength(0);

    // ok
    await device.reportLive(['camera']);
    const ok = await waitSource(studio, id, 'ok', 0);
    expect(ok.source.statusSince).not.toBeNull();

    // Decided 2026-10-22 (implementation spec 4.5, DOC-06): a camera the operating system paused is not live but expected
    // back - reconnecting, amber incident, «K1 verbindet neu». (docs/testing.md still pins paused = ended.)
    let from = studio.received.length;
    await device.report({ rtc: 'connected', slots: [slotReport('camera', 'paused')] });
    await waitSource(studio, id, 'reconnecting', from);
    const incidentPaused = await studio.waitForEvent('incidentUpserted', (event) => event.incident.sourceId === id && event.incident.kind === 'reconnecting', { from });
    expect(incidentPaused.incident.endedAt).toBeNull();
    expect((await studio.waitForEvent('logAppended', (event) => event.entry.text === 'K1 verbindet neu', { from })).entry.text).toBe('K1 verbindet neu');

    // The user stops the camera on purpose: the open incident keeps its id and start and turns into «ended» (red).
    from = studio.received.length;
    await device.report({ rtc: 'connected', slots: [slotReport('camera', 'ended')] });
    await waitSource(studio, id, 'ended', from);
    const incidentEnded = await studio.waitForEvent('incidentUpserted', (event) => event.incident.sourceId === id && event.incident.kind === 'ended', { from });
    expect(incidentEnded.incident.id, 'the open incident is escalated, not replaced').toBe(incidentPaused.incident.id);
    expect(incidentEnded.incident.startedAt).toBe(incidentPaused.incident.startedAt);
    expect(incidentEnded.incident.endedAt).toBeNull();
    expect((await studio.waitForEvent('logAppended', (event) => event.entry.text.includes('Kamera beendet'), { from })).entry.text).toBe('K1 Kamera beendet');

    // Back to live: the incident is recovered (endedAt) and stays until acknowledged.
    from = studio.received.length;
    await sleep(1200);
    await device.reportLive(['camera']);
    await waitSource(studio, id, 'ok', from);
    const recovered = await studio.waitForEvent('incidentUpserted', (event) => event.incident.id === incidentEnded.incident.id && event.incident.endedAt !== null, { from });
    expect(new Date(recovered.incident.endedAt!).getTime()).toBeGreaterThan(new Date(recovered.incident.startedAt).getTime());
    const recoveredLog = await studio.waitForEvent('logAppended', (event) => event.entry.text.includes('wieder da'), { from });
    expect(recoveredLog.entry.text).toMatch(/^K1 wieder da, war [1-9]\d* s weg$/);
    expect((await production.snapshot()).incidents.map((incident) => incident.id), 'recovered incidents stay until «Gesehen»').toEqual([incidentEnded.incident.id]);

    // A new outage replaces the recovered incident of the same source: removed first, then upserted.
    from = studio.received.length;
    await device.report({ rtc: 'connected', slots: [slotReport('camera', 'failed')] });
    await waitSource(studio, id, 'lost', from);
    const lost = await studio.waitForEvent('incidentUpserted', (event) => event.incident.kind === 'lost', { from });
    const removedOld = await studio.waitForEvent('incidentRemoved', (event) => event.incidentId === incidentEnded.incident.id, { from });
    expect(removedOld.revision, 'incidentRemoved(old) comes before incidentUpserted(new)').toBeLessThan(lost.revision);
    expect((await studio.waitForEvent('logAppended', (event) => event.entry.text.includes('kein Bild'), { from })).entry.text).toBe('K1 kein Bild');

    // Acknowledging an open incident is a conflict.
    expectProblem(await api.acknowledgeIncident(production.id, lost.incident.id), 409, ERROR.conflict);

    // The media connection of the sender reports trouble while its hub stays up: reconnecting at once (spec 12, GAP-08 a).
    from = studio.received.length;
    await device.reportLive(['camera']);
    await waitSource(studio, id, 'ok', from);
    from = studio.received.length;
    await device.report({ rtc: 'reconnecting', slots: [slotReport('camera', 'live')] });
    const reconnecting = await waitSource(studio, id, 'reconnecting', from, THRESHOLD.detectCleanHardMs);
    expect(reconnecting.source.statusSince).not.toBeNull();
    expect((await studio.waitForEvent('logAppended', (event) => event.entry.text === 'K1 verbindet neu', { from })).entry.text).toBe('K1 verbindet neu');
    await device.reportLive(['camera']);
    await waitSource(studio, id, 'ok', from);
    expectConsecutive(studio.events());
  });

  // The slot-state rules decided on 2026-10-22 (implementation spec 4.5, DOC-06).
  test('INT-SRC-03 [stack, paused before live] a slot that is paused before it ever went live stays connecting, without an incident', t.p1, async ({ config, api, production, pairContext, stack, onCleanup }) => {
    const { hub: studio } = await openStudio(config.baseURL, api, production, onCleanup);
    const phone = await pairPhone(pairContext, { name: 'Handy Pause' });
    const device = deviceHub(stack, phone);
    onCleanup(() => device.stop());
    await device.open();
    await waitSource(studio, phone.sourceId(), 'connecting', 0);
    const from = studio.received.length;
    await device.report({ rtc: 'connected', slots: [slotReport('camera', 'paused')] });
    await sleep(1500);
    const snapshot = await production.snapshot();
    expect(snapshot.sources.find((source) => source.id === phone.sourceId())!.status).toBe('connecting');
    expect(snapshot.incidents, 'no incident: it never was live').toHaveLength(0);
    expect(studio.received.slice(from).filter((entry) => entry.method === 'event' && (entry.args[0] as { type: string }).type === 'incidentUpserted')).toHaveLength(0);
  });

  test('INT-SRC-03 [stack, replace] a report replaces all earlier slot states: a slot missing from the report is no longer live', t.p1, async ({ config, api, production, pairContext, stack, onCleanup }) => {
    const { hub: studio } = await openStudio(config.baseURL, api, production, onCleanup);
    const phone = await pairPhone(pairContext, { name: 'Handy Ersatz' });
    const device = deviceHub(stack, phone);
    onCleanup(() => device.stop());
    await device.open();
    await device.reportLive(['camera']);
    await waitSource(studio, phone.sourceId(), 'ok', 0);
    const from = studio.received.length;
    await device.report({ rtc: 'connected', slots: [] });
    await waitSource(studio, phone.sourceId(), 'reconnecting', from);
    expect((await studio.waitForEvent('incidentUpserted', (event) => event.incident.sourceId === phone.sourceId() && event.incident.kind === 'reconnecting', { from })).incident.endedAt).toBeNull();
    await device.reportLive(['camera']);
    await waitSource(studio, phone.sourceId(), 'ok', from);
  });

  test('INT-SRC-03 [stack, new session] a page reload starts without slot states: what the previous page reported does not make the slot look live', t.p1, async ({ config, api, production, pairContext, stack, onCleanup }) => {
    const { hub: studio } = await openStudio(config.baseURL, api, production, onCleanup);
    const phone = await pairPhone(pairContext, { name: 'Handy Neuladen' });
    const before = deviceHub(stack, phone, undefined, 'tab-before');
    onCleanup(() => before.stop());
    await before.open();
    await before.reportLive(['camera']);
    await waitSource(studio, phone.sourceId(), 'ok', 0);
    const from = studio.received.length;
    const after = deviceHub(stack, phone, undefined, 'tab-after');
    onCleanup(() => after.stop());
    await after.open();
    // Hello of another session replaces the old one; until the new page reports, only a published track would count.
    await waitSource(studio, phone.sourceId(), 'reconnecting', from);
    await after.reportLive(['camera']);
    await waitSource(studio, phone.sourceId(), 'ok', from);
  });

  test('INT-SRC-03 [stack, silent session] a connected session that reports nothing for 6 s counts as rtc disconnected (GAP-29)', t.p1, async ({ config, api, production, pairContext, stack, onCleanup }) => {
    test.setTimeout(60_000);
    const { hub: studio } = await openStudio(config.baseURL, api, production, onCleanup);
    const phone = await pairPhone(pairContext, { name: 'Handy Stumm' });
    const device = deviceHub(stack, phone);
    onCleanup(() => device.stop());
    await device.open();
    await device.reportLive(['camera']);
    await waitSource(studio, phone.sourceId(), 'ok', 0);
    const silentSince = Date.now();
    const from = studio.received.length;
    await waitSource(studio, phone.sourceId(), 'reconnecting', from, 12_000);
    const took = Date.now() - silentSince;
    test.info().annotations.push({ type: 'measurement', description: `connected but silent: reconnecting after ${took} ms (SOURCES__REPORTSTALEAFTER 6 s)` });
    expect(took, 'not before the stale time').toBeGreaterThanOrEqual(5000);
    expect(took, 'within stale time plus one check interval').toBeLessThanOrEqual(8500);
    expect(device.isConnected, 'the hub connection itself stays up').toBe(true);
    await device.reportLive(['camera']);
    await waitSource(studio, phone.sourceId(), 'ok', from);
  });

  test('INT-SRC-03 [stack, validation] invalid reports are refused with 400 and a flood does not hurt the server', t.p0, async ({ production, pairContext, stack }) => {
    const phone = await pairPhone(pairContext, { name: 'Handy Flood' });
    const device = phone.api;
    for (const body of [
      { rtc: 'sideways', slots: [] },
      { rtc: 'connected', slots: [{ slot: 'camera', state: 'exploding' }] },
      { rtc: 'connected', slots: 'nope' },
      {},
    ]) {
      const result = await device.reportDeviceStatus(body);
      expect([400, 204], JSON.stringify(body)).toContain(result.status);
      expect(result.status).not.toBe(500);
    }
    expect((await device.reportDeviceStatus({ rtc: 'connected', slots: [slotReport('camera', 'live')], batteryPct: 101, charging: null, network: 'wifi', rttMs: -5, techCheck: null })).status, 'out-of-range values are cleaned, not rejected').toBe(204);
    // 100 reports in a burst.
    const burst = await Promise.all(Array.from({ length: 100 }, () => device.reportDeviceStatus({ rtc: 'connected', slots: [slotReport('camera', 'live')], batteryPct: 50, charging: false, network: 'wifi', rttMs: 12, techCheck: null })));
    const statuses = new Set(burst.map((result) => result.status));
    for (const status of statuses) expect([204, 429], `burst status ${status}`).toContain(status);
    expect(statuses.has(500)).toBe(false);
    expect((await production.snapshot()).sources.length).toBeGreaterThan(0);
    void stack;
  });

  test('INT-SRC-06 [stack] tech check in the report reaches the Regie; telemetry endpoint lists the last values', t.p2, async ({ api, production, pairContext, stack, config, onCleanup }) => {
    const { hub: studio } = await openStudio(config.baseURL, api, production, onCleanup);
    const phone = await pairPhone(pairContext, { name: 'Handy Check' });
    const device = deviceHub(stack, phone);
    onCleanup(() => device.stop());
    await device.open();
    const techCheck = { overall: 'warn', camera: 'ok', network: 'ok', bandwidth: 'warn', uploadKbps: 4200, rttMs: 18, at: new Date().toISOString(), note: 'Upload nur 4,2 Mbit/s' };
    await device.report({ rtc: 'connected', slots: [slotReport('camera', 'live')], batteryPct: 77, charging: false, network: 'wifi', rttMs: 18, techCheck: techCheck as never });
    const updated = await studio.waitForEvent('deviceUpserted', (event) => event.device.id === phone.id && event.device.techCheck !== null);
    expect(updated.device.techCheck).toMatchObject({ overall: 'warn', bandwidth: 'warn', uploadKbps: 4200, rttMs: 18 });
    const telemetry = await api.getTelemetry(production.id);
    expect(telemetry.status).toBe(200);
    const mine = (telemetry.body as unknown as Array<{ deviceId: string; telemetry: { batteryPct: number; rttMs: number; network: string } }>).find((entry) => entry.deviceId === phone.id)!;
    expect(mine.telemetry).toMatchObject({ batteryPct: 77, rttMs: 18, network: 'wifi' });
    expect((await production.snapshot()).devices.find((entry) => entry.id === phone.id)!.techCheck).toMatchObject({ overall: 'warn' });
  });

  test('INT-SRC-04 [stack] session replacement: the newer Hello wins, a late Hello of the replaced tab does not ping-pong (GAP-21)', t.smoke, async ({ api, production, pairContext, stack, onCleanup }) => {
    const phone = await pairPhone(pairContext, { name: 'Handy Tabs' });
    const make = (sessionId: string) => {
      const hub = deviceHub(stack, phone, undefined, sessionId);
      onCleanup(() => hub.stop());
      return hub;
    };
    const tab1 = make('tab-S1');
    await tab1.open();
    const tab2 = make('tab-S2');
    await tab2.open();
    // S2's Hello tells connection 1 that it was replaced and aborts it.
    await tab1.waitFor('sessionReplaced', (entry) => entry.method === 'sessionReplaced', { timeoutMs: 3000 });
    await tab1.waitClosed(3000);
    expect(tab2.of('sessionReplaced'), 'the winner is never told').toHaveLength(0);
    expect(tab2.isConnected).toBe(true);

    // The replaced tab reconnects and says Hello with its old session id: it is told again and aborted, S2 stays.
    const tab1again = make('tab-S1');
    await tab1again.start();
    let rejected: unknown;
    await tab1again.hello().catch((error) => {
      rejected = error;
    });
    await tab1again.waitFor('sessionReplaced', (entry) => entry.method === 'sessionReplaced', { timeoutMs: 3000 });
    await tab1again.waitClosed(3000);
    void rejected;
    await sleep(1500);
    expect(tab2.isConnected, 'no ping-pong: S2 stays connected').toBe(true);
    expect(tab2.of('sessionReplaced')).toHaveLength(0);

    // A new connection of the current tab replaces the old one silently.
    const tab2b = make('tab-S2');
    await tab2b.open();
    await tab2.waitClosed(3000);
    expect(tab2.of('sessionReplaced'), 'same tab: no sessionReplaced').toHaveLength(0);
    expect(tab2b.isConnected).toBe(true);
    const status = (await production.snapshot()).devices.find((device) => device.id === phone.id)!;
    expect(status.connection, 'the device stays online throughout').toBe('online');
    void api;
  });

  test('INT-SRC-05 [stack] commands: delivered once to a connected device, dropped otherwise, validated', t.p1, async ({ api, production, pairContext, stack, onCleanup }) => {
    const phone = await pairPhone(pairContext, { name: 'Handy Befehl' });
    const laptop = await pairLaptopByLink(pairContext, { name: 'Laptop Befehl' });
    const send = (deviceId: string, body: Record<string, unknown>) => api.sendDeviceCommand(production.id, deviceId, body);

    // Offline: 202 and nothing is delivered later.
    const offline = await send(phone.id, { kind: 'message', text: 'In 10 s live' });
    expect(offline.status).toBe(202);
    expect(offline.body.id).toMatch(/^cmd_[a-z2-7]{16}$/);
    const device = deviceHub(stack, phone);
    onCleanup(() => device.stop());
    await device.open();
    await sleep(500);
    expect(device.commands(), 'a command to an offline device is never queued').toHaveLength(0);

    // Connected: exactly one command message with the same id.
    const message = await send(phone.id, { kind: 'message', text: '  In 10 s live  ' });
    expect(message.status).toBe(202);
    await device.waitFor('command', (entry) => entry.method === 'command');
    await sleep(300);
    expect(device.commands()).toHaveLength(1);
    expect(device.commands()[0]).toMatchObject({ id: message.body.id, kind: 'message', text: 'In 10 s live' });
    const switchCamera = await send(phone.id, { kind: 'switchCamera' });
    expect(switchCamera.status).toBe(202);
    await device.waitFor('switchCamera command', (entry) => entry.method === 'command' && (entry.args[0] as { kind: string }).kind === 'switchCamera');

    // Validation.
    for (const text of ['', ' ', '\u0001\u0002']) expectProblem(await send(phone.id, { kind: 'message', text }), 400, ERROR.validationFailed);
    expectProblem(await send(phone.id, { kind: 'message' }), 400, ERROR.validationFailed);
    expectProblem(await send(phone.id, { kind: 'message', text: 'x'.repeat(141) }), 400, ERROR.validationFailed);
    expect((await send(phone.id, { kind: 'message', text: 'x'.repeat(140) })).status, '140 characters are fine').toBe(202);
    expectProblem(await send(phone.id, { kind: 'reshare', slot: 'camera' }), 400, ERROR.validationFailed);
    expectProblem(await send(phone.id, { kind: 'reshare', slot: 'screen-3' }), 400, ERROR.validationFailed);
    expectProblem(await send(phone.id, { kind: 'dance' }), 400, ERROR.validationFailed);
    expect((await send(laptop.id, { kind: 'reshare', slot: 'screen-1' })).status).toBe(202);
    expectProblem(await send(laptop.id, { kind: 'switchCamera' }), 400, ERROR.validationFailed);
    expectProblem(await send('dev_aaaaaaaaaaaaaaaa', { kind: 'switchCamera' }), 404, ERROR.notFound);

    // Blocked devices get 202 but nothing is delivered either.
    await api.blockDevice(production.id, phone.id);
    expect((await send(phone.id, { kind: 'message', text: 'Gesperrt' })).status).toBe(202);
  });

  test('INT-SWITCH-03 [stack] tally over the device hub: Hello carries it, changes follow within T-TALLY, standby is off', t.smoke, async ({ api, production, pairContext, stack, onCleanup }) => {
    const [sceneA, sceneB] = production.sceneIds as [string, string];
    const one = await pairPhone(pairContext, { name: 'Handy Eins' });
    const two = await pairPhone(pairContext, { name: 'Handy Zwei' });
    await api.addSceneItem(production.id, sceneA, { source: one.sourceId() });
    await api.addSceneItem(production.id, sceneB, { source: two.sourceId() });
    const hubOne = deviceHub(stack, one);
    const hubTwo = deviceHub(stack, two);
    onCleanup(() => hubOne.stop());
    onCleanup(() => hubTwo.stop());
    const helloOne = await hubOne.open();
    const helloTwo = await hubTwo.open();
    // Program is scene A (first scene) but the broadcast is in standby: nothing is on air.
    expect(helloOne.tally, 'standby: off').toEqual({ overall: 'off', slots: { camera: 'off' } });
    expect(helloTwo.tally).toEqual({ overall: 'off', slots: { camera: 'off' } });

    const next = (hub: DeviceHub, overall: string, label: string, since: number) =>
      hub.waitFor(label, (message) => message.method === 'tally' && (message.args[0] as { overall: string }).overall === overall, { from: since, timeoutMs: 2000 });
    const messagesOf = (hub: DeviceHub) => hub.received.length;

    // start: scene A is on air -> device one program, device two stays off (no message for an unchanged tally)
    const startMark = [messagesOf(hubOne), messagesOf(hubTwo)] as const;
    const startedAt = Date.now();
    await api.startBroadcast(production.id);
    const live = await next(hubOne, 'program', 'program tally', startMark[0]);
    expect(live.at - startedAt, 'tally within T-TALLY').toBeLessThanOrEqual(THRESHOLD.tallyHardMs);
    expect(hubOne.tallies().at(-1)).toEqual({ overall: 'program', slots: { camera: 'program' } });
    await sleep(300);
    expect(hubTwo.received.slice(startMark[1]).filter((entry) => entry.method === 'tally'), 'device two gets no message for an unchanged tally').toHaveLength(0);

    // preview = scene B: device two preview
    let mark = messagesOf(hubTwo);
    await api.setPreview(production.id, { sceneId: sceneB });
    await next(hubTwo, 'preview', 'preview tally', mark);
    // take: swap
    mark = messagesOf(hubTwo);
    const markOne = messagesOf(hubOne);
    await api.take(production.id, { transition: { kind: 'cut', durationMs: 0 } });
    await next(hubTwo, 'program', 'program tally for two', mark);
    await next(hubOne, 'preview', 'preview tally for one', markOne);
    // hiding the item removes the tally
    const scene = (await production.snapshot()).scenes.find((entry) => entry.id === sceneB)!;
    const item = scene.items[0]!;
    mark = messagesOf(hubTwo);
    await api.updateSceneItem(production.id, sceneB, item.id, { ...item, hidden: true });
    await next(hubTwo, 'off', 'off tally after hiding', mark);
    mark = messagesOf(hubTwo);
    await api.updateSceneItem(production.id, sceneB, item.id, { ...item, hidden: false });
    await next(hubTwo, 'program', 'program again', mark);
    // end: everything off (nothing is on air any more)
    mark = messagesOf(hubTwo);
    await api.endBroadcast(production.id);
    const ended = await next(hubTwo, 'off', 'ended: off', mark);
    expect(ended.at).toBeGreaterThan(0);
    expect(hubTwo.tallies().at(-1)).toEqual({ overall: 'off', slots: { camera: 'off' } });
    // reset (standby) after end: still off, no message for an unchanged tally
    mark = messagesOf(hubTwo);
    await api.resetBroadcast(production.id);
    await sleep(400);
    expect(hubTwo.received.slice(mark).filter((entry) => entry.method === 'tally')).toHaveLength(0);
  });
});

test.describe('SRC outage detection', () => {
  test('E2E-SRC-02 [api] clean connection loss: outage in the Regie within T-DETECT-CLEAN, recovery with «wieder da», «Gesehen» is shared', t.smoke, async ({ config, api, production, pairContext, stack, onCleanup }) => {
    test.setTimeout(90_000);
    const proxy = await new TcpProxy(new URL(stack.direct).hostname, Number(new URL(stack.direct).port)).start();
    onCleanup(() => proxy.stop());
    const { hub: studio } = await openStudio(config.baseURL, api, production, onCleanup);
    const second = await openStudio(config.baseURL, api, production, onCleanup);
    const phone = await pairPhone(pairContext, { name: 'Handy Netz' });
    const id = phone.sourceId();
    const device = DeviceHub.connect(proxy.url, phone.credentials, { headers: stack.forwardedForWorks ? { 'X-Forwarded-For': uniqueIp() } : {} });
    onCleanup(() => device.stop());
    await device.open();
    await device.reportLive(['camera']);
    await waitSource(studio, id, 'ok', 0);
    await sleep(1500);

    // The network of this phone breaks cleanly (connection reset).
    const from = studio.received.length;
    const droppedAt = Date.now();
    proxy.dropConnections();
    const down = await waitSource(studio, id, 'reconnecting', from, THRESHOLD.detectCleanHardMs + 2000);
    const detected = Date.now() - droppedAt;
    test.info().annotations.push({ type: 'measurement', description: `T-DETECT-CLEAN ${detected} ms` });
    expect(detected, 'T-DETECT-CLEAN (hard 3 s)').toBeLessThanOrEqual(THRESHOLD.detectCleanHardMs);
    const incident = await studio.waitForEvent('incidentUpserted', (event) => event.incident.sourceId === id, { from });
    expect(incident.incident).toMatchObject({ kind: 'reconnecting', code: 'K1', endedAt: null });
    expect(down.source.statusSince).not.toBeNull();
    await studio.waitForEvent('logAppended', (event) => event.entry.text === 'K1 verbindet neu', { from });
    const connection = await studio.waitForEvent('deviceUpserted', (event) => event.device.id === phone.id && event.device.connection === 'reconnecting', { from });
    expect(connection.device.connectionSince).not.toBeNull();

    // 6 s later the phone is back.
    await sleep(6000);
    const back = DeviceHub.connect(stack.anonymousBase, phone.credentials, { headers: stack.forwardedForWorks ? { 'X-Forwarded-For': uniqueIp() } : {} });
    onCleanup(() => back.stop());
    await back.open();
    const reportedAt = Date.now();
    await back.reportLive(['camera']);
    await waitSource(studio, id, 'ok', from, 3000);
    expect(Date.now() - reportedAt, 'report -> «ok» in the Regie (T-RECOVER-SHORT, 1 s)').toBeLessThanOrEqual(1500);
    const recovered = await studio.waitForEvent('incidentUpserted', (event) => event.incident.id === incident.incident.id && event.incident.endedAt !== null, { from });
    const outage = (new Date(recovered.incident.endedAt!).getTime() - new Date(recovered.incident.startedAt).getTime()) / 1000;
    expect(outage, 'the incident covers the outage').toBeGreaterThanOrEqual(5.5);
    expect(outage).toBeLessThanOrEqual(10);
    const log = await studio.waitForEvent('logAppended', (event) => event.entry.text.includes('wieder da'), { from });
    expect(log.entry.text).toBe(`K1 wieder da, war ${Math.round(outage)} s weg`);

    // The recovered incident stays (the Regie shows «wieder da»), and «Gesehen» is shared between two operators.
    await sleep(3000);
    expect((await production.snapshot()).incidents.map((entry) => entry.id), 'the recovered entry stays until acknowledged').toEqual([incident.incident.id]);
    const results = await Promise.all([api.acknowledgeIncident(production.id, incident.incident.id), api.acknowledgeIncident(production.id, incident.incident.id)]);
    expect(results.map((result) => result.status).sort(), 'one 204, one 404').toEqual([204, 404]);
    for (const operator of [{ hub: studio }, second]) await operator.hub.waitForEvent('incidentRemoved', (event) => event.incidentId === incident.incident.id, { timeoutMs: 2000 });
    expect((await production.snapshot()).incidents).toHaveLength(0);
    expectProblem(await api.acknowledgeIncident(production.id, incident.incident.id), 404, ERROR.notFound);
    expect(studio.eventsOfType('incidentRemoved').filter((event) => event.incidentId === incident.incident.id), 'removed once').toHaveLength(1);
  });

  test('E2E-SRC-02 [api, silent] silent packet loss is detected within T-DETECT-SILENT (target 5 s, hard 6.5 s)', t.p0, async ({ config, api, production, pairContext, stack, onCleanup }) => {
    test.setTimeout(150_000);
    const apiUrl = new URL(stack.direct);
    const proxy = await new TcpProxy(apiUrl.hostname, Number(apiUrl.port)).start();
    onCleanup(() => proxy.stop());
    const { hub: studio } = await openStudio(config.baseURL, api, production, onCleanup);
    const phone = await pairPhone(pairContext, { name: 'Handy Stumm' });
    const id = phone.sourceId();
    const samples: number[] = [];
    for (let round = 0; round < 3; round++) {
      // Fresh connection through the forwarder, a sender that reports every second.
      const device = DeviceHub.connect(proxy.url, phone.credentials, { headers: stack.forwardedForWorks ? { 'X-Forwarded-For': uniqueIp() } : {}, serverTimeoutMs: 60_000 });
      await device.open();
      const reporter = setInterval(() => {
        if (device.isConnected && !proxy.blackholed) void device.reportLive(['camera']).catch(() => undefined);
      }, 1000);
      try {
        await device.reportLive(['camera']);
        const from = studio.received.length;
        await waitSource(studio, id, 'ok', from > 0 ? Math.max(0, from - 5) : 0, 5000);
        await sleep(2300 + round * 400); // varies the phase between the client's pings and the blackhole
        const fromLoss = studio.received.length;
        const lossAt = Date.now();
        proxy.blackhole();
        await waitSource(studio, id, 'reconnecting', fromLoss, 12_000);
        samples.push(Date.now() - lossAt);
      } finally {
        clearInterval(reporter);
        proxy.dropConnections();
        proxy.resume();
        await device.stop();
      }
      // Recovery through a new connection so the next round starts from «ok».
      const back = DeviceHub.connect(proxy.url, phone.credentials, { headers: stack.forwardedForWorks ? { 'X-Forwarded-For': uniqueIp() } : {} });
      await back.open();
      await back.reportLive(['camera']);
      await waitSource(studio, id, 'ok', studio.received.length - 3, 5000).catch(() => undefined);
      await back.stop();
      await sleep(600);
    }
    test.info().annotations.push({ type: 'measurement', description: `T-DETECT-SILENT samples (ms): ${samples.join(', ')}; p50 ${percentile(samples, 50)}` });
    await test.info().attach('detect-silent.json', { body: JSON.stringify({ samples, p50: percentile(samples, 50), hardMs: THRESHOLD.detectSilentHardMs, targetMs: THRESHOLD.detectSilentTargetMs }), contentType: 'application/json' });
    expect(Math.max(...samples), `silent loss detection ${samples.join(', ')} ms vs hard limit ${THRESHOLD.detectSilentHardMs} ms`).toBeLessThanOrEqual(THRESHOLD.detectSilentHardMs);
  });

  test('E2E-SRC-10 [api] blocking removes the incident, shows «blocked» in the source, and unblocking leads to offline without an incident', t.p0, async ({ config, api, production, pairContext, stack, onCleanup }) => {
    const { hub: studio } = await openStudio(config.baseURL, api, production, onCleanup);
    const phone = await pairPhone(pairContext, { name: 'Handy Sperre' });
    const id = phone.sourceId();
    const device = deviceHub(stack, phone);
    onCleanup(() => device.stop());
    await device.open();
    await device.reportLive(['camera']);
    await waitSource(studio, id, 'ok', 0);
    // Create an open incident, then block while it is open.
    await device.report({ rtc: 'reconnecting', slots: [slotReport('camera', 'live')] });
    const incident = await studio.waitForEvent('incidentUpserted', (event) => event.incident.sourceId === id);
    const from = studio.received.length;
    const blockedAt = Date.now();
    expect((await api.blockDevice(production.id, phone.id)).status).toBe(200);
    await studio.waitForEvent('incidentRemoved', (event) => event.incidentId === incident.incident.id, { from });
    await waitSource(studio, id, 'blocked', from);
    await device.waitClosed(3000);
    expect(Date.now() - blockedAt, 'T-BLOCK').toBeLessThanOrEqual(THRESHOLD.blockHardMs + 500);
    expect((await production.snapshot()).incidents, 'blocking clears the incidents of the device').toHaveLength(0);
    expect(device.selfMessages().at(-1)?.state).toBe('blocked');
    // The blocked sender retries: every attempt is 403 (the sender shows «Gesperrt»).
    await expect(deviceHub(stack, phone).start()).rejects.toThrow(/403/);
    expectProblem(await phone.api.getDeviceSelf(), 403, ERROR.deviceBlocked);
    // Unblock: offline, no incident; the sender reconnects and publishes again.
    expect((await api.unblockDevice(production.id, phone.id)).status).toBe(200);
    await waitSource(studio, id, 'offline', from);
    const again = deviceHub(stack, phone);
    onCleanup(() => again.stop());
    await again.open();
    await again.reportLive(['camera']);
    await waitSource(studio, id, 'ok', from);
    expect((await production.snapshot()).incidents, 'no incident after unblocking').toHaveLength(0);
  });

  test('E2E-SRC-20 [api] a returning source keeps its item, rectangle, z-order and code', t.smoke, async ({ api, production, pairContext, stack, config, onCleanup }) => {
    const { hub: studio } = await openStudio(config.baseURL, api, production, onCleanup);
    const phone = await pairPhone(pairContext, { name: 'Handy Platz' });
    const other = await pairPhone(pairContext, { name: 'Handy Zwei' });
    const scene = production.sceneIds[0]!;
    await api.addSceneItem(production.id, scene, { source: other.sourceId(), x: 0, y: 0, w: 400, h: 225 });
    const added = await api.addSceneItem(production.id, scene, { source: phone.sourceId(), x: 321, y: 123, w: 640, h: 360 });
    const before = added.body.items;
    const device = deviceHub(stack, phone);
    onCleanup(() => device.stop());
    await device.open();
    await device.reportLive(['camera']);
    await waitSource(studio, phone.sourceId(), 'ok', 0);
    for (let round = 0; round < 2; round++) {
      await device.stop();
      const back = deviceHub(stack, phone);
      onCleanup(() => back.stop());
      await back.open();
      await back.reportLive(['camera']);
      await waitSource(studio, phone.sourceId(), 'ok', studio.received.length - 2, 5000).catch(() => undefined);
      await sleep(300);
    }
    const snapshot = await production.snapshot();
    const items = snapshot.scenes.find((entry) => entry.id === scene)!.items;
    expect(items, 'same items in the same order with the same geometry').toEqual(before);
    expect(snapshot.sources.filter((source) => source.deviceId === phone.id), 'no duplicate source').toHaveLength(1);
    expect(snapshot.sources.find((source) => source.deviceId === phone.id)!.code, 'the code never changes').toBe('K1');
  });

  test('E2E-SRC-22 [api] deleting a connected device closes its hub, removes the station and keeps the scene items', t.p2, async ({ api, production, pairContext, stack, config, onCleanup }) => {
    const { hub: studio } = await openStudio(config.baseURL, api, production, onCleanup);
    const phone = await pairPhone(pairContext, { name: 'Handy Weg' });
    const scene = production.sceneIds[0]!;
    await api.addSceneItem(production.id, scene, { source: phone.sourceId() });
    const device = deviceHub(stack, phone);
    onCleanup(() => device.stop());
    await device.open();
    await device.reportLive(['camera']);
    await waitSource(studio, phone.sourceId(), 'ok', 0);
    const at = Date.now();
    expect((await api.deleteDevice(production.id, phone.id)).status).toBe(204);
    await device.waitClosed(3000);
    expect(Date.now() - at).toBeLessThanOrEqual(THRESHOLD.blockHardMs + 500);
    await studio.waitForEvent('deviceRemoved', (event) => event.deviceId === phone.id);
    await studio.waitForEvent('sourceRemoved', (event) => event.sourceId === phone.sourceId());
    const snapshot = await production.snapshot();
    expect(snapshot.devices).toHaveLength(0);
    expect(snapshot.scenes.find((entry) => entry.id === scene)!.items.map((item) => item.source)).toEqual([phone.sourceId()]);
    // The sender gets 401 everywhere and does not reconnect in a loop: one rejected hub start is a plain 401.
    await expect(deviceHub(stack, phone).start()).rejects.toThrow(/401/);
    expectProblem(await phone.api.getDeviceSelf(), 401, ERROR.unauthorized);
  });
});
