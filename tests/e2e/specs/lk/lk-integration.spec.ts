import { jwtVerify, decodeJwt } from 'jose';
import { OutputApi } from '../../support/api';
import { ERROR, LIMITS, THRESHOLD } from '../../support/constants';
import { TEXT } from '../../support/text';
import { expect, expectProblem, test, uniqueIp } from '../../support/fixtures';
import { openStudio } from '../../support/helpers';
import { DeviceHub } from '../../support/hubs';
import { livekitAdmin, signLiveKitToken } from '../../support/livekit';
import { LiveKitPage } from '../../support/livekit-browser';
import { pairPhone } from '../../support/production';
import { sleep, waitUntil } from '../../support/shell';
import { t } from '../../support/tags';

/**
 * LK - LiveKit integration against the real SFU: token claims, the grants LiveKit enforces, a real publisher
 * showing up as a source through the webhook path, block/rotation kicking participants out of the room
 * (INT-LK-01, E2E-LK-01, INT-SRC-01 with a real track, E2E-SRC-10 LiveKit side, E2E-AUTH-24 LiveKit side).
 * A Chromium page plays the sender/viewer with livekit-client (support/livekit-browser.ts).
 */

const secret = (value: string) => new TextEncoder().encode(value);

test.describe('LK tokens', () => {
  test('INT-LK-01 [stack] token endpoints issue role-specific HS256 tokens with the documented claims', t.p0, async ({ config, api, production, pairContext, stack }) => {
    const phone = await pairPhone(pairContext, { name: 'Token Phone' });
    const device = await phone.api.getDeviceLiveKitToken();
    const studio = await api.getStudioLiveKitToken(production.id);
    const output = await production.output().getOutputLiveKitToken();
    for (const result of [device, studio, output]) expect(result.status, result.raw.text()).toBe(200);

    const verify = async (token: string) => (await jwtVerify(token, secret(config.livekit.apiSecret), { algorithms: ['HS256'], issuer: config.livekit.apiKey, clockTolerance: 5 })).payload as Record<string, any>;
    const deviceClaims = await verify(device.body.token);
    const studioClaims = await verify(studio.body.token);
    const outputClaims = await verify(output.body.token);

    // The signalling URL is the public origin (Caddy proxies /rtc), the room is the production id.
    for (const result of [device, studio, output]) {
      expect(result.body.url).toBe(config.baseURL.replace(/^https/, 'wss'));
      expect(result.body.room).toBe(production.id);
      expect(Date.parse(result.body.expiresAt)).toBeGreaterThan(Date.now() + 8 * 60_000);
      expect(Date.parse(result.body.expiresAt)).toBeLessThanOrEqual(Date.now() + LIMITS.livekitTokenMinutes * 60_000 + 5000);
    }
    // sender
    expect(device.body.identity).toBe(phone.id);
    expect(deviceClaims['sub']).toBe(phone.id);
    expect(deviceClaims['video']).toMatchObject({ roomJoin: true, room: production.id, canPublish: true, canSubscribe: false, canPublishData: false });
    // Picture and sound (issue #7): a sender may publish a camera, a screen, a microphone and the sound of a screen.
    expect(deviceClaims['video'].canPublishSources).toEqual(expect.arrayContaining(['camera', 'screen_share', 'microphone', 'screen_share_audio']));
    expect(deviceClaims['video'].canPublishSources).toHaveLength(4);
    expect(deviceClaims['video'].hidden ?? false).toBe(false);
    // studio: hidden subscriber
    expect(studio.body.identity).toMatch(/^studio_[a-z2-7]{16}$/);
    expect(studioClaims['video']).toMatchObject({ roomJoin: true, room: production.id, canPublish: false, canSubscribe: true, canPublishData: false, hidden: true });
    // output: hidden subscriber named after the slug
    expect(output.body.identity).toMatch(new RegExp(`^output_${production.slug}_olk_[a-z2-7]{16}_[a-z2-7]{16}$`));
    expect(outputClaims['video']).toMatchObject({ roomJoin: true, room: production.id, canPublish: false, canSubscribe: true, canPublishData: false, hidden: true });
    // lifetime: spec 7 says a participant token lives 10 minutes (docs/testing.md says 2 h, see known-bugs.json DOC-03)
    for (const claims of [deviceClaims, studioClaims, outputClaims]) {
      expect(claims['exp'] - claims['nbf'], 'exp - nbf').toBeGreaterThanOrEqual(LIMITS.livekitTokenMinutes * 60 - 5);
      expect(claims['exp'] - claims['nbf']).toBeLessThanOrEqual(LIMITS.livekitTokenMinutes * 60 + 5);
    }
    // No secret anywhere in the token; fresh identity per call for studio and output, stable one for devices.
    for (const result of [device, studio, output]) {
      expect(JSON.stringify(decodeJwt(result.body.token))).not.toContain(config.livekit.apiSecret);
      expect(result.body.token.split('.')[1]).not.toContain(Buffer.from(config.livekit.apiSecret).toString('base64'));
    }
    const studio2 = await api.getStudioLiveKitToken(production.id);
    const output2 = await production.output().getOutputLiveKitToken();
    const device2 = await phone.api.getDeviceLiveKitToken();
    expect(studio2.body.identity).not.toBe(studio.body.identity);
    expect(output2.body.identity).not.toBe(output.body.identity);
    expect(device2.body.identity).toBe(device.body.identity);
    expect(studio2.body.token).not.toBe(studio.body.token);

    // Refusals.
    expectProblem(await new OutputApi(config.baseURL, production.slug, 'wrong').getOutputLiveKitToken(), 403, ERROR.forbidden);
    expectProblem(await api.getStudioLiveKitToken('prd_aaaaaaaaaaaaaaaa'), 404, ERROR.notFound);
    await api.blockDevice(production.id, phone.id);
    expectProblem(await phone.api.getDeviceLiveKitToken(), 403, ERROR.deviceBlocked);
    void stack;
  });
});

test.describe('LK grants and publisher', () => {
  test('E2E-LK-01 real grants are enforced by LiveKit: senders cannot subscribe, studio and output cannot publish, bad tokens are refused, viewers are hidden', t.p0, async ({ context, config, api, production, pairContext }) => {
    test.setTimeout(120_000);
    const phoneA = await pairPhone(pairContext, { name: 'Sender A' });
    const phoneB = await pairPhone(pairContext, { name: 'Sender B' });
    const tokenA = (await phoneA.api.getDeviceLiveKitToken()).body;
    const tokenB = (await phoneB.api.getDeviceLiveKitToken()).body;
    const studioToken = (await api.getStudioLiveKitToken(production.id)).body;
    const outputToken = (await production.output().getOutputLiveKitToken()).body;

    const a = await LiveKitPage.open(context, 'sender-a');
    const b = await LiveKitPage.open(context, 'sender-b');
    const studio = await LiveKitPage.open(context, 'studio');
    const output = await LiveKitPage.open(context, 'output');
    const bad = await LiveKitPage.open(context, 'bad');
    try {
      // Sender B publishes; sender A only connects.
      await b.publishStamped({ url: tokenB.url, token: tokenB.token, name: 'camera' });
      await a.connect({ url: tokenA.url, token: tokenA.token });
      await studio.connect({ url: studioToken.url, token: studioToken.token });
      await output.connect({ url: outputToken.url, token: outputToken.token });

      // A sender cannot subscribe to anything and cannot publish data; it may publish a microphone (issue #7).
      await expect.poll(async () => (await a.roomState()).remote, { timeout: 8000, message: 'sender A sees sender B in the participant list' }).toContain(phoneB.id);
      await sleep(2500);
      const probe = await a.probeGrants();
      expect(probe.canSubscribeFlag, 'canSubscribe in the permissions the server sent').toBe(false);
      expect(probe.subscribedTracks, 'a sender subscribes to no track').toBe(0);
      expect(probe.microphone, 'a sender may publish a microphone').toMatch(/accepted/);
      expect(probe.canPublishFlag).toBe(true);
      const sources = await a.tryPublish('camera', 'camera');
      expect(sources.ok, `a sender may publish a camera: ${sources.error}`).toBe(true);
      expect((await a.roomState()).remote, 'viewers are hidden from senders').not.toEqual(expect.arrayContaining([expect.stringMatching(/^(studio|output)_/)]));

      // Studio and output cannot publish.
      for (const viewer of [studio, output]) {
        const attempt = await viewer.tryPublish('camera', 'camera');
        expect(attempt.ok, `${viewer.label} must not publish`).toBe(false);
        expect(attempt.error ?? '').toMatch(/permission|not allowed|denied|forbidden|publish/i);
        expect((await viewer.probeGrants()).microphone, `${viewer.label} must not publish a microphone`).toMatch(/refused/);
      }
      // ...but they can subscribe: frames of sender B arrive in the studio.
      const measured = await studio.measure({ identity: phoneB.id, trackName: 'camera', durationMs: 2500 });
      expect(measured.frames, 'decoded stamped frames').toBeGreaterThan(15);

      // The room as LiveKit sees it: hidden participants are listed by the room service.
      const participants = await livekitAdmin.listParticipants(production.id);
      const identities = participants.map((participant) => participant.identity);
      expect(identities).toEqual(expect.arrayContaining([phoneA.id, phoneB.id, studioToken.identity, outputToken.identity]));
      expect(identities.filter((identity) => /^(studio|output)_/.test(identity)).length).toBe(2);

      // Tokens that are wrong: foreign secret, expired, wrong key, no room grant.
      const room = production.id;
      const wrongSecret = await signLiveKitToken({ identity: 'intruder', grants: { roomJoin: true, room, canPublish: true, canSubscribe: true }, secret: 'sk' + '0'.repeat(40) });
      const expired = await signLiveKitToken({ identity: 'intruder', grants: { roomJoin: true, room, canSubscribe: true }, ttlSeconds: -120 });
      const wrongKey = await signLiveKitToken({ identity: 'intruder', grants: { roomJoin: true, room, canSubscribe: true }, apiKey: 'another-key' });
      const noJoin = await signLiveKitToken({ identity: 'intruder', grants: { room, canSubscribe: true } });
      for (const [name, token] of [['wrong secret', wrongSecret], ['expired', expired], ['wrong key', wrongKey], ['no roomJoin', noJoin]] as const) {
        const attempt = await bad.tryConnect({ url: tokenA.url, token });
        expect(attempt.ok, `${name} must be refused`).toBe(false);
      }
      expect((await livekitAdmin.listParticipants(room)).map((participant) => participant.identity)).not.toContain('intruder');
    } finally {
      for (const lk of [a, b, studio, output, bad]) await lk.close();
    }
  });

  test('INT-SRC-01 [stack] a real publisher makes the source ok through the webhook path; leaving and rejoining opens and recovers an incident; media-only loss is noticed quickly', t.smoke, async ({ context, config, api, production, pairContext, stack, onCleanup }) => {
    test.setTimeout(120_000);
    const { hub: studio } = await openStudio(config.baseURL, api, production, onCleanup);
    const phone = await pairPhone(pairContext, { name: 'Live Phone' });
    const id = phone.sourceId();
    const device = DeviceHub.connect(stack.anonymousBase, phone.credentials, { headers: stack.forwardedForWorks ? { 'X-Forwarded-For': uniqueIp() } : {} });
    onCleanup(() => device.stop());
    await device.open(); // Hello only: no report. The track alone has to make the source ok.
    await studio.waitForEvent('sourceUpserted', (event) => event.source.id === id && event.source.status === 'connecting');

    const token = (await phone.api.getDeviceLiveKitToken()).body;
    const sender = await LiveKitPage.open(context, 'sender');
    onCleanup(() => sender.close());
    const from = studio.received.length;
    const publishedAt = Date.now();
    await sender.publishStamped({ url: token.url, token: token.token, name: 'camera', fps: 30, width: 640, height: 360 });
    const ok = await studio.waitForEvent('sourceUpserted', (event) => event.source.id === id && event.source.status === 'ok', { from, timeoutMs: 8000 });
    test.info().annotations.push({ type: 'measurement', description: `publish -> source ok in the Regie: ${Date.now() - publishedAt} ms` });
    expect(ok.source.statusSince).not.toBeNull();
    // A real sender reports every second. A session that stays silent counts as rtc disconnected after 6 s (GAP-29),
    // which would turn this source reconnecting although the track flows - so from here on the device reports.
    // It reports what the page really does: the camera slot is live while the page is in the room, and absent when it left.
    let inRoom = true;
    const heartbeat = setInterval(() => void (inRoom ? device.reportLive(['camera']) : device.report({ rtc: 'connected', slots: [] })).catch(() => undefined), 1000);
    onCleanup(() => clearInterval(heartbeat));
    const participants = await livekitAdmin.listParticipants(production.id);
    const mine = participants.find((participant) => participant.identity === phone.id)!;
    expect(mine, 'LiveKit lists the device').toBeDefined();
    expect(mine.tracks.map((track) => track.name)).toContain('camera');

    // A viewer decodes the stamp: media flows over the real UDP path (candidate: node IP).
    const viewerToken = (await api.getStudioLiveKitToken(production.id)).body;
    const viewer = await LiveKitPage.open(context, 'viewer');
    onCleanup(() => viewer.close());
    await viewer.connect({ url: viewerToken.url, token: viewerToken.token });
    const measured = await viewer.measure({ identity: phone.id, trackName: 'camera', durationMs: 4000 });
    await test.info().attach('latency-camera.json', { body: JSON.stringify({ p50: measured.p50, p95: measured.p95, max: measured.max, frames: measured.frames, bad: measured.badFrames, width: measured.width, height: measured.height }), contentType: 'application/json' });
    test.info().annotations.push({ type: 'measurement', description: `canvas-to-video latency p50 ${measured.p50} ms, p95 ${measured.p95} ms, ${measured.frames} frames, ${measured.width}x${measured.height}` });
    expect(measured.frames, 'frames decoded in 4 s').toBeGreaterThan(40);
    expect(measured.monotonic, 'decoded timestamps are increasing').toBe(true);
    expect(measured.badFrames / (measured.frames + measured.badFrames), 'undecodable frames').toBeLessThan(0.05);
    expect(measured.p50, 'sanity bound (the hard T-LATENCY limit is for the perf runner)').toBeLessThan(1000);

    // The sender leaves cleanly: the device hub is still connected, the track is gone -> reconnecting + incident.
    const leaveFrom = studio.received.length;
    await sender.leave();
    inRoom = false;
    await studio.waitForEvent('sourceUpserted', (event) => event.source.id === id && event.source.status === 'reconnecting', { from: leaveFrom, timeoutMs: THRESHOLD.detectCleanHardMs + 2000 });
    const incident = await studio.waitForEvent('incidentUpserted', (event) => event.incident.sourceId === id && event.incident.endedAt === null, { from: leaveFrom });
    await studio.waitForEvent('logAppended', (event) => event.entry.text === TEXT.log.reconnecting('K1'), { from: leaveFrom });
    // ...and comes back with a new session.
    const again = await LiveKitPage.open(context, 'sender-2');
    onCleanup(() => again.close());
    const token2 = (await phone.api.getDeviceLiveKitToken()).body;
    const backAt = Date.now();
    await again.publishStamped({ url: token2.url, token: token2.token, name: 'camera' });
    await studio.waitForEvent('sourceUpserted', (event) => event.source.id === id && event.source.status === 'ok', { from: leaveFrom, timeoutMs: 8000 });
    inRoom = true;
    expect(Date.now() - backAt, 'rejoin -> ok in the Regie').toBeLessThanOrEqual(THRESHOLD.videoStartHardMs + 3000);
    const recovered = await studio.waitForEvent('incidentUpserted', (event) => event.incident.id === incident.incident.id && event.incident.endedAt !== null, { from: leaveFrom });
    expect(recovered.incident.endedAt).not.toBeNull();
    await studio.waitForEvent('logAppended', (event) => /^K1 is back, was gone for \d+ s$/.test(event.entry.text), { from: leaveFrom });
  });

  test('INT-SRC-01 [stack, media-only loss] a device report “media reconnecting” marks a published source reconnecting within seconds (spec 12, GAP-08 a)', t.p1, async ({ context, config, api, production, pairContext, stack, onCleanup }) => {
    test.setTimeout(120_000);
    const { hub: studio } = await openStudio(config.baseURL, api, production, onCleanup);
    const phone = await pairPhone(pairContext, { name: 'Media Phone' });
    const id = phone.sourceId();
    const device = DeviceHub.connect(stack.anonymousBase, phone.credentials, { headers: stack.forwardedForWorks ? { 'X-Forwarded-For': uniqueIp() } : {} });
    onCleanup(() => device.stop());
    await device.open();
    const token = (await phone.api.getDeviceLiveKitToken()).body;
    const sender = await LiveKitPage.open(context, 'sender');
    onCleanup(() => sender.close());
    await sender.publishStamped({ url: token.url, token: token.token, name: 'camera' });
    await device.reportLive(['camera']);
    await studio.waitForEvent('sourceUpserted', (event) => event.source.id === id && event.source.status === 'ok', { timeoutMs: 8000 });

    // The track stays published (LiveKit has not noticed anything), but the sender's own media connection is broken.
    const from = studio.received.length;
    const reportedAt = Date.now();
    await device.report({ rtc: 'reconnecting', slots: [{ slot: 'camera', state: 'live', width: 640, height: 360, fps: 30, bitrateKbps: 0, packetLossPct: 100, codec: 'vp8' }] });
    const down = await studio.waitForEvent('sourceUpserted', (event) => event.source.id === id && event.source.status === 'reconnecting', { from, timeoutMs: 12_000 }).catch(() => undefined);
    const elapsed = Date.now() - reportedAt;
    test.info().annotations.push({ type: 'measurement', description: `media-only loss noticed after ${down ? elapsed : 'more than 12000'} ms` });
    expect(down, 'T-DETECT-SILENT media-only loss: hard limit 10 s').toBeDefined();
    expect(elapsed).toBeLessThanOrEqual(10_000);
  });

  test('E2E-SRC-10 [api, LiveKit] blocking removes the publisher from the room within T-BLOCK and a rejoin with the old token is kicked again', t.p0, async ({ context, config, api, production, pairContext, stack, onCleanup }) => {
    test.setTimeout(120_000);
    const phone = await pairPhone(pairContext, { name: 'Block Phone' });
    const token = (await phone.api.getDeviceLiveKitToken()).body;
    const sender = await LiveKitPage.open(context, 'sender');
    onCleanup(() => sender.close());
    await sender.publishStamped({ url: token.url, token: token.token, name: 'camera' });
    expect((await livekitAdmin.listParticipants(production.id)).map((p) => p.identity)).toContain(phone.id);

    const blockedAt = Date.now();
    expect((await api.blockDevice(production.id, phone.id)).status).toBe(200);
    await waitUntil('participant removed from LiveKit', async () => !(await livekitAdmin.listParticipants(production.id)).some((participant) => participant.identity === phone.id), { timeoutMs: 6000, intervalMs: 100 });
    const gone = Date.now() - blockedAt;
    test.info().annotations.push({ type: 'measurement', description: `T-BLOCK (LiveKit participant gone): ${gone} ms` });
    expect(gone, 'T-BLOCK').toBeLessThanOrEqual(THRESHOLD.blockHardMs + 300);
    const disconnected = await sender.waitForEvent('disconnected', 5000);
    expect(disconnected.detail, 'the sender is told it was removed (reason PARTICIPANT_REMOVED)').toBeDefined();

    // The old token is still cryptographically valid: LiveKit lets it in, the join webhook makes the API kick it again.
    const retry = await LiveKitPage.open(context, 'retry');
    onCleanup(() => retry.close());
    const joined = await retry.tryConnect({ url: token.url, token: token.token });
    if (joined.ok) {
      await waitUntil('blocked device kicked again after a rejoin', async () => !(await livekitAdmin.listParticipants(production.id)).some((participant) => participant.identity === phone.id), { timeoutMs: 8000, intervalMs: 200 });
    }
    expectProblem(await phone.api.getDeviceLiveKitToken(), 403, ERROR.deviceBlocked);

    // Unblocked: it may join again with a fresh token.
    await api.unblockDevice(production.id, phone.id);
    const fresh = (await phone.api.getDeviceLiveKitToken()).body;
    const again = await LiveKitPage.open(context, 'again');
    onCleanup(() => again.close());
    await again.publishStamped({ url: fresh.url, token: fresh.token, name: 'camera' });
    await sleep(2500);
    expect((await livekitAdmin.listParticipants(production.id)).map((p) => p.identity), 'stays in the room after unblocking').toContain(phone.id);
    void config;
    void stack;
  });

  test('E2E-AUTH-24 [LiveKit] rotating the output key removes every output_{slug}_* participant from the room and no other', t.smoke, async ({ context, api, production, pairContext, onCleanup }) => {
    test.setTimeout(120_000);
    const phone = await pairPhone(pairContext, { name: 'Stays' });
    const senderToken = (await phone.api.getDeviceLiveKitToken()).body;
    const sender = await LiveKitPage.open(context, 'sender');
    onCleanup(() => sender.close());
    await sender.publishStamped({ url: senderToken.url, token: senderToken.token, name: 'camera' });
    const outputToken = (await production.output().getOutputLiveKitToken()).body;
    const output = await LiveKitPage.open(context, 'output');
    onCleanup(() => output.close());
    await output.connect({ url: outputToken.url, token: outputToken.token });
    const studioToken = (await api.getStudioLiveKitToken(production.id)).body;
    const studio = await LiveKitPage.open(context, 'studio');
    onCleanup(() => studio.close());
    await studio.connect({ url: studioToken.url, token: studioToken.token });
    const before = (await livekitAdmin.listParticipants(production.id)).map((participant) => participant.identity);
    expect(before).toEqual(expect.arrayContaining([phone.id, outputToken.identity, studioToken.identity]));

    const rotatedAt = Date.now();
    expect((await api.regenerateOutputKey(production.id)).status).toBe(200);
    await waitUntil('output participant removed', async () => !(await livekitAdmin.listParticipants(production.id)).some((participant) => participant.identity === outputToken.identity), { timeoutMs: 6000, intervalMs: 100 });
    test.info().annotations.push({ type: 'measurement', description: `T-KEY (LiveKit participant gone): ${Date.now() - rotatedAt} ms` });
    expect(Date.now() - rotatedAt).toBeLessThanOrEqual(THRESHOLD.keyHardMs + 300);
    await output.waitForEvent('disconnected', 5000);
    const after = (await livekitAdmin.listParticipants(production.id)).map((participant) => participant.identity);
    expect(after, 'the sender and the studio stay').toEqual(expect.arrayContaining([phone.id, studioToken.identity]));
    expect(after.filter((identity) => identity.startsWith('output_'))).toEqual([]);
    // The old output token cannot be requested any more; the new key issues a fresh identity.
    await production.refreshOutput();
    expect((await production.output().getOutputLiveKitToken()).status).toBe(200);
  });
});
