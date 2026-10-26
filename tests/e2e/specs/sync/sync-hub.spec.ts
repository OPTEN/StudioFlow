import fs from 'node:fs';
import path from 'node:path';
import type { ProductionEvent } from '../../../../packages/scene-model/src/contracts';
import { stateFromSnapshot } from '../../../../packages/scene-model/src/production-state';
import { DeviceApi, OutputApi, PublicApi, inviteToken } from '../../support/api';
import { ERROR, LIMITS } from '../../support/constants';
import { TEXT } from '../../support/text';
import { REPO_ROOT } from '../../support/env';
import { expect, expectProblem, knownBug, test, uniqueIp } from '../../support/fixtures';
import { describeEvents, expectConsecutive, openStudio, percentile } from '../../support/helpers';
import { DeviceHub, OutputHub, StudioHub, invokeRaw, openRawHub, sendRaw } from '../../support/hubs';
import { makePng } from '../../support/media-samples';
import { createProduction, pairPhone } from '../../support/production';
import { sleep } from '../../support/shell';
import { SyncClient, comparableSnapshot, comparableState } from '../../support/sync-client';
import { t } from '../../support/tags';

/**
 * SYNC - the realtime protocol and state model against the real stack, with Node SignalR clients (docs/testing.md
 * 2.12 and INT-NET-01/02): subscribe, presence, resync, JSON shape, keep-alive, telemetry, delta/snapshot boundary,
 * ordering under concurrent writes, output filtering, surface completeness.
 */

test.describe('SYNC studio hub', () => {
  test('INT-SYNC-01 [stack] Subscribe answers a snapshot equal to REST; unknown production is a HubException; presence follows connections; resync on activation', t.smoke, async ({ config, api, production, onCleanup }) => {
    const a = StudioHub.connect(config.baseURL, api.cookie);
    onCleanup(() => a.stop());
    await a.start();
    // Unknown production: a HubException with the error code prefix.
    await expect(a.subscribe('prd_aaaaaaaaaaaaaaaa')).rejects.toThrow(/not_found/);
    await expect(a.subscribe('not-a-production')).rejects.toThrow(/not_found|validation_failed/);
    const changes = await a.subscribe(production.id);
    expect(changes.snapshot, 'a first subscribe (no revision) is answered with a snapshot').not.toBeNull();
    expect(changes.events).toBeNull();
    const rest = (await api.getSnapshot(production.id)).body;
    expect(changes.revision).toBe(rest.revision);
    expect(comparableSnapshot(changes.snapshot!)).toEqual(comparableSnapshot(rest));
    expect(changes.snapshot!.operatorsOnline).toBe(1);
    await expect.poll(() => a.presence(), { message: 'presence announced to the new subscriber' }).toBe(1);

    // A second operator: both see 2; a clean disconnect and an abrupt one both decrement.
    const b = StudioHub.connect(config.baseURL, api.cookie);
    onCleanup(() => b.stop());
    await b.open(production.id);
    await expect.poll(() => a.presence()).toBe(2);
    expect(b.presence()).toBe(2);
    const raw = await openRawHub(config.baseURL, 'studio', { cookie: api.cookie });
    expect(raw.status).toBe(101);
    await invokeRaw(raw, 'Subscribe', [production.id, null]);
    await expect.poll(() => a.presence(), { message: 'third operator counted' }).toBe(3);
    const killed = Date.now();
    raw.close(); // terminate(): no close handshake, like a pulled network cable at the TCP level
    await expect.poll(() => a.presence(), { timeout: 8000, message: 'abrupt disconnect is noticed within 8 s' }).toBe(2);
    expect(Date.now() - killed).toBeLessThanOrEqual(8000);
    await b.stop();
    await expect.poll(() => a.presence()).toBe(1);

    // Activating another production tells every connected Regie to resubscribe (payload: the new production id).
    const other = await createProduction(api, 'INT-SYNC-01-other');
    onCleanup(() => api.activateProduction(production.id));
    expect((await api.activateProduction(other.id)).status).toBe(200);
    const resync = await a.waitFor('resync', (entry) => entry.method === 'resync');
    expect(resync.args[0]).toBe(other.id);
  });

  test('INT-SYNC-03 [stack] JSON protocol shape: camelCase names, enums as camelCase strings, ISO timestamps, type discriminators', t.p1, async ({ config, api, production }) => {
    const raw = await openRawHub(config.baseURL, 'studio', { cookie: api.cookie });
    expect(raw.status).toBe(101);
    try {
      const subscribe = await invokeRaw(raw, 'Subscribe', [production.id, null]);
      expect(subscribe.error).toBeUndefined();
      await api.createScene(production.id, { name: 'Shape Test' });
      await expect.poll(() => raw.frames.some((frame) => frame.includes('"sceneUpserted"')), { timeout: 5000 }).toBe(true);
      const eventFrame = JSON.parse(raw.frames.find((frame) => frame.includes('"sceneUpserted"'))!) as { type: number; target: string; arguments: Array<{ type: string; revision: number }> };
      expect(eventFrame.type, 'invocation').toBe(1);
      expect(eventFrame.target, 'wire method names are camelCase').toBe('event');
      expect(eventFrame.arguments[0]!.type, 'discriminator').toBe('sceneUpserted');

      const keys = new Set<string>();
      const walk = (value: unknown, pathKey = ''): void => {
        if (Array.isArray(value)) value.forEach((item) => walk(item, pathKey));
        else if (value && typeof value === 'object') {
          for (const [key, child] of Object.entries(value)) {
            keys.add(key);
            walk(child, key);
          }
        }
      };
      const snapshot = (subscribe.result as { snapshot: Record<string, unknown> }).snapshot;
      walk(snapshot);
      walk(eventFrame.arguments[0]);
      const pascal = [...keys].filter((key) => /^[A-Z]/.test(key));
      expect(pascal, 'no PascalCase property names').toEqual([]);
      // Enums are strings, never numbers.
      const production0 = snapshot['production'] as Record<string, unknown>;
      expect(typeof production0['broadcast']).toBe('string');
      expect(production0['broadcast']).toBe('standby');
      const scene = (snapshot['scenes'] as Array<Record<string, unknown>>)[0]!;
      expect(typeof scene['layoutMode']).toBe('string');
      expect(scene['layoutMode']).toMatch(/^(free|autoGrid)$/);
      expect(JSON.stringify(snapshot)).not.toMatch(/"(broadcast|layoutMode|fit|kind|status|state)":\d/);
      // Timestamps are ISO 8601 with an offset.
      expect(snapshot['serverTime']).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/);
      expect(production0['createdAt'] ?? snapshot['serverTime']).toMatch(/^\d{4}-/);
      // Unknown client fields are ignored.
      const withExtra = await invokeRaw(raw, 'Subscribe', [production.id, null, 'unexpected extra argument']);
      expect(withExtra.error ?? '').not.toMatch(/internal_error/);
    } finally {
      raw.close();
    }
  });

  test('INT-SYNC-03 [stack, 64 KiB] a client message above 64 KiB closes that connection and nobody else', t.p1, async ({ config, api, production, onCleanup }) => {
    const bystander = StudioHub.connect(config.baseURL, api.cookie);
    onCleanup(() => bystander.stop());
    await bystander.open(production.id);
    const raw = await openRawHub(config.baseURL, 'studio', { cookie: api.cookie });
    onCleanup(() => raw.close());
    await invokeRaw(raw, 'Subscribe', [production.id, null]);
    sendRaw(raw, { type: 1, invocationId: 'big', target: 'Subscribe', arguments: ['x'.repeat(70 * 1024), null] });
    await expect.poll(() => raw.closed !== undefined || raw.frames.some((frame) => frame.includes('"type":7')), { timeout: 8000, message: 'the oversized message ends that connection' }).toBe(true);
    await api.createScene(production.id, { name: 'After the big message' });
    await bystander.waitForEvent('sceneUpserted', (event) => event.scene.name === 'After the big message');
    expect(bystander.isConnected).toBe(true);
  });

  test('INT-SYNC-04 [stack] keep-alive: pings every 2 s, a client that stops sending is dropped after the server timeout (T-DETECT-SILENT), an answering client stays', t.p2, async ({ config, api, onCleanup }) => {
    test.setTimeout(60_000);
    const silent = await openRawHub(config.baseURL, 'studio', { cookie: api.cookie });
    const answering = await openRawHub(config.baseURL, 'studio', { cookie: api.cookie });
    onCleanup(() => silent.close());
    onCleanup(() => answering.close());
    expect(silent.status).toBe(101);
    const answeringTimer = setInterval(() => sendRaw(answering, { type: 6 }), 2000);
    onCleanup(() => clearInterval(answeringTimer));
    // One ping like every SignalR client sends, then silence. (ASP.NET Core arms the client timeout with the first
    // client message of the connection: a socket that only completes the handshake is never timed out.)
    sendRaw(silent, { type: 6 });
    const lastMessageAt = Date.now();
    await expect.poll(() => silent.closed !== undefined, { timeout: 15_000, intervals: [250] }).toBe(true);
    const silentFor = silent.closed!.at - lastMessageAt;
    test.info().annotations.push({ type: 'measurement', description: `silent client closed ${silentFor} ms after its last message` });
    const pings = silent.frameTimes.filter((_, index) => silent.frames[index] === '{"type":6}');
    expect(pings.length, 'the server pings a quiet client').toBeGreaterThanOrEqual(2);
    const gaps = pings.slice(1).map((time, index) => time - pings[index]!);
    expect(percentile(gaps, 50), 'ping interval about 2 s (2-3 s: one-second heartbeat granularity)').toBeGreaterThan(1500);
    expect(percentile(gaps, 50)).toBeLessThan(3200);
    // Spec section 12 (GAP-12): server timeout 5 s (the first plan said 6 s). T-DETECT-SILENT hard limit 6.5 s.
    expect(silentFor, 'a silent client is dropped after the server timeout').toBeGreaterThan(4000);
    expect(silentFor).toBeLessThanOrEqual(6500);
    expect(answering.closed, 'the answering client is still connected').toBeUndefined();
  });

  test('INT-SYNC-05 [stack] telemetry is relayed at most every 2 s per device, is not revisioned and never crosses productions', t.p2, async ({ config, api, production, pairContext, stack, onCleanup }) => {
    test.setTimeout(60_000);
    const { hub, revision } = await openStudio(config.baseURL, api, production, onCleanup);
    const busy = await pairPhone(pairContext, { name: 'Telemetry' });
    const idle = await pairPhone(pairContext, { name: 'Quiet' });
    const foreign = await createProduction(api, 'INT-SYNC-05-other');
    const foreignContext = { production: foreign, stack };
    const foreignPhone = await pairPhone(foreignContext, { name: 'Foreign' });
    const hubs = [busy, idle, foreignPhone].map((device) => DeviceHub.connect(stack.anonymousBase, device.credentials, { headers: stack.forwardedForWorks ? { 'X-Forwarded-For': uniqueIp() } : {} }));
    for (const device of hubs) onCleanup(() => device.stop());
    for (const device of hubs) await device.open();
    await api.activateProduction(production.id);
    const from = hub.received.length;
    const events = hub.events().length;
    // 10 reports per second for 10 s from one device, the foreign device reports as well, the idle one never does.
    const end = Date.now() + 10_000;
    while (Date.now() < end) {
      await hubs[0]!.reportLive(['camera'], { batteryPct: 80, rttMs: 12 });
      await hubs[2]!.reportLive(['camera']);
      await sleep(100);
    }
    const telemetry = hub.received.slice(from).filter((entry) => entry.method === 'telemetry').map((entry) => ({ at: entry.at, message: entry.args[0] as { deviceId: string; telemetry: { rtc: string; batteryPct: number | null; slots: unknown[] } } }));
    const ids = new Set(telemetry.map((entry) => entry.message.deviceId));
    expect([...ids], 'only the busy device of this production is relayed').toEqual([busy.id]);
    expect(telemetry.length, `relayed ${telemetry.length} messages in 10 s`).toBeGreaterThanOrEqual(3);
    test.info().annotations.push({ type: 'measurement', description: `${telemetry.length} telemetry messages in 10 s for 100 reports/s` });
    expect(telemetry[0]!.message.telemetry).toMatchObject({ rtc: 'connected', batteryPct: 80 });
    // Telemetry carries no revision; the only revisioned events are the status changes (offline/connecting -> ok).
    const revisioned = hub.events().slice(events);
    expect(revisioned.every((event) => ['sourceUpserted', 'deviceUpserted', 'logAppended'].includes(event.type)), describeEvents(hub)).toBe(true);
    expect(revisioned.length, 'a report every 100 ms does not create an event every 100 ms').toBeLessThan(10);
    expect(revision).toBeGreaterThan(0);
  });

  test('INT-SYNC-05 [stack, throttle] telemetry is relayed at most every 2 s per device even when the device reports faster', t.p2, async ({ config, api, production, pairContext, stack, onCleanup }) => {
    knownBug('BUG-19', 'every device report is relayed to the Regie as a telemetry message at once (92 messages in 10 s for 10 reports/s); spec 6 and INT-SYNC-05/INT-SRC-03 pin at most one per 2 s per device');
    test.setTimeout(60_000);
    const { hub } = await openStudio(config.baseURL, api, production, onCleanup);
    const phone = await pairPhone(pairContext, { name: 'Telemetry' });
    const device = DeviceHub.connect(stack.anonymousBase, phone.credentials, { headers: stack.forwardedForWorks ? { 'X-Forwarded-For': uniqueIp() } : {} });
    onCleanup(() => device.stop());
    await device.open();
    const from = hub.received.length;
    const end = Date.now() + 8000;
    while (Date.now() < end) {
      await device.reportLive(['camera']);
      await sleep(100);
    }
    const times = hub.received.slice(from).filter((entry) => entry.method === 'telemetry').map((entry) => entry.at);
    expect(times.length, `relayed ${times.length} messages in 8 s`).toBeLessThanOrEqual(6);
    const gaps = times.slice(1).map((time, index) => time - times[index]!);
    expect(Math.min(...gaps), 'at most every 2 s').toBeGreaterThanOrEqual(1700);
  });

  test('INT-NET-01 [stack] delta versus snapshot boundary: GET changes and Subscribe agree', t.p0, async ({ config, api, production, onCleanup }) => {
    test.setTimeout(120_000);
    const sceneId = production.sceneIds[0]!;
    const current = (await api.getSnapshot(production.id)).body.revision;
    // 520 events: 520 renames.
    for (let index = 0; index < 520; index += 10) {
      await Promise.all(Array.from({ length: 10 }, (_, k) => api.updateScene(production.id, sceneId, { name: `Boundary ${index + k}` })));
    }
    const now = (await api.getSnapshot(production.id)).body.revision;
    expect(now - current, 'one revision per mutation').toBeGreaterThanOrEqual(520);
    const changes = (since: number | string | undefined) => api.getChanges(production.id, since);

    const same = await changes(now);
    expect(same.status).toBe(200);
    expect(same.body.events, 'since = current -> empty delta').toEqual([]);
    expect(same.body.snapshot).toBeNull();
    const recent = await changes(now - 10);
    expect(recent.body.snapshot).toBeNull();
    expect(recent.body.events!.map((event: ProductionEvent) => event.revision)).toEqual(Array.from({ length: 10 }, (_, index) => now - 9 + index));
    const oldestKept = await changes(now - LIMITS.ringBufferEvents);
    expect(oldestKept.body.snapshot, 'the last 500 events are buffered').toBeNull();
    expect(oldestKept.body.events).toHaveLength(LIMITS.ringBufferEvents);
    for (const since of [now - LIMITS.ringBufferEvents - 1, now - 600, 0, 1, 12345, now + 1000, now + 10_000_000_000]) {
      const answer = await changes(since);
      expect(answer.status, `since ${since}`).toBe(200);
      expect(answer.body.events, `since ${since}: snapshot instead of events`).toBeNull();
      expect(answer.body.snapshot, `since ${since}`).not.toBeNull();
      expect(answer.body.snapshot!.revision).toBe(answer.body.revision);
    }
    // Invalid / missing since.
    for (const since of ['-1', 'abc', '1.5', '']) expectProblem(await changes(since), 400, ERROR.validationFailed);
    expectProblem(await changes(undefined), 400, ERROR.validationFailed);
    expectProblem(await api.getChanges('prd_aaaaaaaaaaaaaaaa', 5), 404, ERROR.notFound);

    // Subscribe on the hub follows the same rule.
    const hub = StudioHub.connect(config.baseURL, api.cookie);
    onCleanup(() => hub.stop());
    await hub.start();
    expect((await hub.subscribe(production.id, now - 100)).events).toHaveLength(100);
    expect((await hub.subscribe(production.id, now - 700)).snapshot).not.toBeNull();
    expect((await hub.subscribe(production.id, null)).snapshot).not.toBeNull();
  });

  test('INT-SYNC-07 [stack] ordering under concurrent writes: every client sees every revision exactly once, in order, and ends equal to REST (INT-NET-02)', t.p1, async ({ config, api, production, onCleanup }) => {
    test.setTimeout(120_000);
    const clients: SyncClient[] = [];
    for (let index = 0; index < 3; index++) {
      const client = await SyncClient.connect(config.baseURL, api.cookie, production.id);
      onCleanup(() => client.stop());
      clients.push(client);
    }
    const startRevision = clients[0]!.revision;
    const scenes = production.sceneIds;
    // 300 mutations from 10 parallel workers on three scenes.
    let counter = 0;
    await Promise.all(
      Array.from({ length: 10 }, async (_, worker) => {
        for (let step = 0; step < 30; step++) {
          const sceneId = scenes[(worker + step) % scenes.length]!;
          const result = await api.updateScene(production.id, sceneId, { name: `Concurrent ${worker}-${step}-${counter++}` });
          expect(result.status, result.raw.text()).toBe(200);
        }
      }),
    );
    const rest = (await api.getSnapshot(production.id)).body;
    for (const client of clients) await client.waitForRevision(rest.revision);
    for (const [index, client] of clients.entries()) {
      const events = client.hub.events();
      expectConsecutive(events, startRevision);
      expect(events.length, `client ${index} saw every event once`).toBe(rest.revision - startRevision);
      expect(client.gaps, `client ${index} needed no resubscribe`).toBe(0);
      expect(client.ignored).toBe(0);
      expect(comparableState(client.state!), `client ${index} equals the REST snapshot`).toEqual(comparableState(stateFromSnapshot(rest)));
    }
  });
});

test.describe('SYNC output hub', () => {
  test('INT-SYNC-02 [stack] the output sees scene, asset and switching events in full; everything private arrives as revisionOnly with the same revision', t.p0, async ({ config, api, production, pairContext, stack, onCleanup }) => {
    test.setTimeout(60_000);
    const studio = StudioHub.connect(config.baseURL, api.cookie);
    onCleanup(() => studio.stop());
    await studio.open(production.id);
    const output = OutputHub.connect(config.baseURL, production.outputKey);
    onCleanup(() => output.stop());
    const opened = await output.open();
    expect(opened.snapshot).not.toBeNull();
    const snapshotJson = JSON.stringify(opened.snapshot);
    expect(snapshotJson).not.toMatch(/"(devices|incidents|pairingRequests|invites|recentLog|outputStatus|operatorsOnline)"/);
    const studioFrom = studio.received.length;

    const privateNames = ['Secret Phone', 'Knock Laptop Name', 'Platform-Secret-Text'];
    // 1. pairing a device (deviceUpserted, sourceUpserted, inviteRemoved/Upserted, logAppended)
    const phone = await pairPhone(pairContext, { name: privateNames[0], platform: privateNames[2] });
    // 2. knock request (pairingRequestUpserted / Removed)
    const publicApi = new PublicApi(stack.anonymousBase, stack.forwardedForWorks ? uniqueIp() : undefined);
    const knock = await publicApi.createPairingRequest({ name: privateNames[1], kind: 'laptop', platform: 'x' });
    production.pendingRequests.push({ requestId: knock.body.requestId, pollToken: knock.body.pollToken });
    await api.denyPairingRequest(production.id, knock.body.requestId);
    // 3. invite
    const link = (await api.createInvite(production.id, { kind: 'laptopLink' })).body;
    // 4. an incident through the device hub (connect, live, disconnect) and the output status (output report)
    const device = DeviceHub.connect(stack.anonymousBase, phone.credentials, { headers: stack.forwardedForWorks ? { 'X-Forwarded-For': uniqueIp() } : {} });
    await device.open();
    await device.reportLive(['camera']);
    await studio.waitForEvent('sourceUpserted', (event) => event.source.deviceId === phone.id && event.source.status === 'ok', { from: studioFrom });
    await device.stop();
    await studio.waitForEvent('incidentUpserted', () => true, { from: studioFrom, timeoutMs: 8000 });
    await output.report({ rendering: true });
    // 5. public events: scene, asset, program switch, slate
    const scene = production.sceneIds[0]!;
    const next = production.sceneIds[1]!;
    await api.updateScene(production.id, scene, { name: 'Scene Output' });
    const asset = (await api.uploadAsset(production.id, { fileName: 'out.png', contentType: 'image/png', data: makePng(1, 1) })).body;
    await api.switchProgram(production.id, { sceneId: next, transition: { kind: 'cut', durationMs: 0 } });
    await api.updateProduction(production.id, { standbySlate: { title: 'Slate Title', subtitle: 'Subtitle', backgroundAssetId: asset.id } });
    await api.startBroadcast(production.id);
    await sleep(500);

    const studioEvents = studio.events();
    const finalRevision = (await api.getSnapshot(production.id)).body.revision;
    await expect.poll(() => (output.events().at(-1)?.revision ?? 0), { timeout: 8000 }).toBeGreaterThanOrEqual(finalRevision - 1);
    const outEvents = output.events();
    expectConsecutive(outEvents, opened.revision);
    const FULL = ['productionChanged', 'programSwitched', 'sceneUpserted', 'sceneRemoved', 'scenesReordered', 'assetUpserted', 'assetRemoved', 'sourceUpserted', 'sourceRemoved'];
    const PRIVATE = ['deviceUpserted', 'deviceRemoved', 'pairingRequestUpserted', 'pairingRequestRemoved', 'inviteUpserted', 'inviteRemoved', 'incidentUpserted', 'incidentRemoved', 'outputStatusChanged', 'logAppended'];
    const studioTypes = new Map(studioEvents.map((event) => [event.revision, event.type]));
    let privateCount = 0;
    for (const event of outEvents) {
      expect([...FULL, 'revisionOnly'], `output event ${event.type}`).toContain(event.type);
      const original = studioTypes.get(event.revision);
      if (original && PRIVATE.includes(original)) {
        expect(event.type, `studio ${original} @${event.revision} is revisionOnly for the output`).toBe('revisionOnly');
        privateCount += 1;
      }
    }
    expect(privateCount, 'the scenario produced private events').toBeGreaterThanOrEqual(6);
    const types = new Set(outEvents.map((event) => event.type));
    for (const wanted of ['sceneUpserted', 'assetUpserted', 'sourceUpserted', 'programSwitched', 'productionChanged']) expect(types.has(wanted as never), `the output receives ${wanted}`).toBe(true);
    // Never any private text in anything the output received.
    const wire = JSON.stringify(outEvents);
    const cleaned = JSON.stringify(JSON.parse(wire, (key, value) => (key === 'label' ? undefined : value)));
    for (const secret of [privateNames[1], privateNames[2], link.url, inviteToken(link.url), 'inc_', 'paired', 'denied', 'reconnecting', 'Phone', TEXT.log.paired('K1', privateNames[0]!)]) {
      expect(cleaned.toLowerCase(), `no ${secret} in output events`).not.toContain(secret.toLowerCase());
    }
    expect(wire).not.toMatch(/"(deviceSecret|pollToken|checkCode|platform|batteryPct)"/);
    // Source statuses are always ok for the output; no statusSince.
    for (const event of outEvents) {
      if (event.type === 'sourceUpserted') {
        expect(event.source.status).toBe('ok');
        expect(event.source.statusSince).toBeNull();
      }
    }
    // Reconnect semantics: Subscribe with an old revision answers the filtered events.
    const again = OutputHub.connect(config.baseURL, production.outputKey);
    onCleanup(() => again.stop());
    const delta = await again.open(opened.revision);
    expect(delta.snapshot).toBeNull();
    expect(JSON.stringify(delta.events).includes('paired')).toBe(false);
    const lastSeen = outEvents.at(-1)!.revision;
    expect(delta.events!.filter((event) => event.revision <= lastSeen).map((event) => event.revision)).toEqual(outEvents.map((event) => event.revision));
  });

  test('INT-SYNC-02 [stack, isolation] events of another production never reach the output', t.p0, async ({ config, api, production, onCleanup }) => {
    const output = OutputHub.connect(config.baseURL, production.outputKey);
    onCleanup(() => output.stop());
    const opened = await output.open();
    const other = await createProduction(api, 'INT-SYNC-02-other');
    onCleanup(() => api.activateProduction(production.id));
    await api.updateScene(other.id, other.sceneIds[0]!, { name: 'Foreign Scene' });
    await api.switchProgram(other.id, { sceneId: other.sceneIds[1]!, transition: { kind: 'cut', durationMs: 0 } });
    await sleep(500);
    const foreign = output.events().filter((event) => JSON.stringify(event).includes(other.id) || JSON.stringify(event).includes('Foreign Scene'));
    expect(foreign, 'nothing from the other production').toEqual([]);
    // Our own production only reports that it is no longer the active one (productionChanged); no scene or switch events.
    expect(output.events().filter((event) => event.type !== 'productionChanged' && event.type !== 'revisionOnly')).toEqual([]);
    await api.updateScene(production.id, production.sceneIds[0]!, { name: 'Own Scene' });
    await output.waitForEvent('sceneUpserted', (event) => event.scene.name === 'Own Scene');
    expect(output.events().every((event) => event.revision > opened.revision)).toBe(true);
  });
});

test.describe('SYNC surface', () => {
  test('INT-SYNC-08 [stack] no operation of the API surface is a placeholder: every route is implemented', t.p0, async ({ config, api, production, pairContext, stack }) => {
    const document = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'apps/api/openapi/studioflow.json'), 'utf8')) as { paths: Record<string, Record<string, { operationId: string }>> };
    const phone = await pairPhone(pairContext, { name: 'Surface' });
    const output = new OutputApi(config.baseURL, production.slug, production.outputKey);
    const device = new DeviceApi(config.baseURL, phone.credentials);
    const asset = (await api.uploadAsset(production.id, { fileName: 'surface.png', contentType: 'image/png', data: makePng(1, 1) })).body;
    const invite = (await api.createInvite(production.id, { kind: 'laptopLink' })).body;
    const knock = await new PublicApi(stack.anonymousBase, stack.forwardedForWorks ? uniqueIp() : undefined).createPairingRequest({ name: 'Surface', kind: 'laptop', platform: 'x' });
    production.pendingRequests.push({ requestId: knock.body.requestId, pollToken: knock.body.pollToken });
    const values: Record<string, string> = {
      '{productionId}': production.id,
      '{sceneId}': production.sceneIds[0]!,
      '{itemId}': 'itm_aaaaaaaaaaaaaaaa',
      '{deviceId}': phone.id,
      '{inviteId}': invite.id,
      '{requestId}': knock.body.requestId,
      '{assetId}': asset.id,
      '{incidentId}': 'inc_aaaaaaaaaaaaaaaa',
      '{linkId}': 'olk_aaaaaaaaaaaaaaaa',
      '{slug}': production.slug,
      '{slot}': 'screen-7',
      '{token}': 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    };
    const failures: string[] = [];
    let called = 0;
    const skip = new Set(['logout', 'login', 'unpairDevice', 'deleteDevice', 'activateProduction', 'receiveLiveKitWebhook']);
    for (const [route, verbs] of Object.entries(document.paths)) {
      for (const [verb, operation] of Object.entries(verbs)) {
        if (skip.has(operation.operationId)) continue;
        let url = route;
        for (const [placeholder, value] of Object.entries(values)) url = url.replaceAll(placeholder, value);
        const method = verb.toUpperCase();
        const hasBody = ['POST', 'PUT', 'PATCH'].includes(method);
        const headers: Record<string, string> = {};
        let base = config.baseURL;
        if (route.startsWith('/api/device/')) headers['Authorization'] = `Bearer ${device.bearer}`;
        else if (route.startsWith('/api/output/')) headers['X-Output-Key'] = production.outputKey;
        else if (route.startsWith('/api/pairing/')) {
          base = stack.anonymousBase;
          if (stack.forwardedForWorks) headers['X-Forwarded-For'] = uniqueIp();
          if (route.includes('{requestId}')) headers['X-Pairing-Token'] = knock.body.pollToken;
        } else headers['Cookie'] = api.cookie;
        if (!route.startsWith('/api/device/') && !route.startsWith('/api/output/') && !route.startsWith('/api/pairing/')) headers['X-StudioFlow'] = '1';
        const { send } = await import('../../support/http');
        const response = await send({
          method,
          url: `${base}${url}${operation.operationId === 'getChanges' ? '?since=1' : ''}`,
          headers,
          json: hasBody && operation.operationId !== 'bandwidthTest' && operation.operationId !== 'uploadAsset' ? {} : undefined,
        });
        called += 1;
        const label = `${method} ${route} (${operation.operationId}) -> ${response.status}`;
        if (response.status === 501 || response.status >= 500 || /not implemented/i.test(response.text())) failures.push(label);
      }
    }
    expect(called, 'operations exercised').toBeGreaterThan(50);
    expect(failures, failures.join('\n')).toEqual([]);
    expect(output.slug).toBe(production.slug);
  });
});
