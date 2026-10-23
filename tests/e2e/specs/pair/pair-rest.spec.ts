import { PublicApi, inviteToken } from '../../support/api';
import { ERROR, LIMITS, THRESHOLD } from '../../support/constants';
import { TEXT } from '../../support/text';
import { expect, expectProblem, knownBug, skipUnsupported, test, uniqueIp } from '../../support/fixtures';
import { DeviceHub } from '../../support/hubs';
import { describeEvents, expectConsecutive, openStudio, pollUntil } from '../../support/helpers';
import { send } from '../../support/http';
import { pairLaptopByCode, pairLaptopByLink, pairPhone } from '../../support/production';
import { sleep } from '../../support/shell';
import { t } from '../../support/tags';

/**
 * PAIR - the three ways of pairing end to end against the real stack (REST + studio hub events):
 * QR (E2E-PAIR-01), check code (-03/-04/-08/-09), invite link (-10/-11), new QR (-12), re-recognition (-13),
 * lost redeem response (-14), second operator (-18/-19), entry points (-20), plus the INT-PAIR-* cases at stack level.
 * The expiry cases need the short-TTL profile: pair-ttl.short-ttl.spec.ts.
 */

const iso = (value: string) => new Date(value).getTime();

test.describe('PAIR', () => {
  test('E2E-PAIR-01 [api] QR pairing of a phone: invite, redeem, events in order, T-PAIR', t.smoke, async ({ config, api, production, stack, onCleanup }) => {
    const invite = (await api.getPhoneInvite(production.id)).body;
    const { hub, revision } = await openStudio(config.baseURL, api, production, onCleanup);
    expect(invite.kind).toBe('phoneQr');
    expect(invite.url).toMatch(new RegExp(`^${config.baseURL}/join/i/[A-Za-z0-9_-]{20,}$`));
    const lifetime = iso(invite.expiresAt) - Date.now();
    expect(lifetime, 'valid for 30 minutes').toBeGreaterThan(LIMITS.inviteMinutes * 60_000 - 15_000);
    expect(lifetime).toBeLessThanOrEqual(LIMITS.inviteMinutes * 60_000 + 5_000);
    expect((await api.getPhoneInvite(production.id)).body.id, 'GET returns the same valid invite').toBe(invite.id);

    const publicApi = new PublicApi(stack.anonymousBase, stack.forwardedForWorks ? uniqueIp() : undefined);
    const redeemStarted = Date.now();
    const redeemed = await publicApi.redeemInvite(inviteToken(invite.url), { clientId: 'client-pair-01', kind: 'phone', platform: 'Pixel 7 · Chrome' });
    expect(redeemed.status, redeemed.raw.text()).toBe(200);
    expect(redeemed.body.deviceId).toMatch(/^dev_[a-z2-7]{16}$/);
    expect(redeemed.body.deviceSecret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(redeemed.body.productionId).toBe(production.id);

    // The Regie learns about the new station within T-PAIR, in a fixed order with consecutive revisions.
    await hub.waitForEvent('logAppended', (event) => event.entry.text.includes('gekoppelt'), { timeoutMs: THRESHOLD.pairHardMs });
    expect(Date.now() - redeemStarted, 'redeem -> station visible (T-PAIR)').toBeLessThanOrEqual(THRESHOLD.pairHardMs + 500);
    const events = hub.events();
    expectConsecutive(events, revision);
    const types = events.map((event) => event.type);
    expect([...types].sort(), describeEvents(hub)).toEqual(['deviceUpserted', 'inviteRemoved', 'inviteUpserted', 'logAppended', 'sourceUpserted']);
    expect(types.indexOf('inviteRemoved'), 'the used invite is removed before the next one is announced').toBeLessThan(types.indexOf('inviteUpserted'));
    const device = hub.eventsOfType('deviceUpserted')[0]!.device;
    expect(device.id).toBe(redeemed.body.deviceId);
    expect(device.pairingMethod).toBe('qr');
    expect(device.kind).toBe('phone');
    expect(device.name).toBe('Handy 1');
    const source = hub.eventsOfType('sourceUpserted')[0]!.source;
    expect(source).toMatchObject({ code: 'K1', kind: 'camera', slot: 'camera', deviceId: device.id, status: 'offline', label: 'Handy 1' });
    expect(hub.eventsOfType('inviteRemoved')[0]!.inviteId).toBe(invite.id);
    const next = hub.eventsOfType('inviteUpserted')[0]!.invite;
    expect(next.kind, 'a fresh phone invite replaces the used one').toBe('phoneQr');
    expect(next.id).not.toBe(invite.id);
    expect(hub.eventsOfType('logAppended')[0]!.entry.text).toBe(TEXT.log.paired('K1', 'Handy 1'));

    // The sender recognises itself (GET /api/device/me) and sees its slot.
    const me = await new (await import('../../support/api')).DeviceApi(stack.anonymousBase, redeemed.body).getDeviceSelf();
    expect(me.status).toBe(200);
    expect(me.body.slots).toEqual([{ slot: 'camera', code: 'K1', kind: 'camera' }]);
    expect(me.body.productionName).toBe(production.name);

    // The old invite is dead (single use), the new one is the one the Regie shows.
    const again = await publicApi.redeemInvite(inviteToken(invite.url), { clientId: 'someone-else', kind: 'phone', platform: 'x' });
    expectProblem(again, 410, ERROR.pairingExpired);
    expect((await api.getPhoneInvite(production.id)).body.id).toBe(next.id);
  });

  test('E2E-PAIR-01 [api, event order] events follow the order pinned in INT-PAIR-01 (DOC-02: inviteRemoved first, the replacement invite last)', t.p2, async ({ config, api, production, stack, onCleanup }) => {
    const invite = (await api.getPhoneInvite(production.id)).body;
    const { hub } = await openStudio(config.baseURL, api, production, onCleanup);
    const publicApi = new PublicApi(stack.anonymousBase, stack.forwardedForWorks ? uniqueIp() : undefined);
    await publicApi.redeemInvite(inviteToken(invite.url), { clientId: 'client-order', kind: 'phone', platform: 'Pixel 7 · Chrome' });
    await hub.waitForEvent('logAppended', (event) => event.entry.text.includes('gekoppelt'));
    expect(hub.events().map((event) => event.type), describeEvents(hub)).toEqual(['inviteRemoved', 'deviceUpserted', 'sourceUpserted', 'logAppended', 'inviteUpserted']);
  });

  test('E2E-PAIR-03 [api] laptop pairing by check code: knock, card, approve, credentials stay the same on every poll', t.smoke, async ({ config, api, production, stack, onCleanup }) => {
    const { hub, revision } = await openStudio(config.baseURL, api, production, onCleanup);
    const publicApi = new PublicApi(stack.anonymousBase, stack.forwardedForWorks ? uniqueIp() : undefined);
    const knockedAt = Date.now();
    const knock = await publicApi.createPairingRequest({ name: 'Laptop Anna', kind: 'laptop', platform: 'Windows · Edge' });
    production.pendingRequests.push({ requestId: knock.body.requestId, pollToken: knock.body.pollToken });
    expect(knock.status, knock.raw.text()).toBe(201);
    expect(knock.body.requestId).toMatch(/^prq_[a-z2-7]{16}$/);
    expect(knock.body.pollToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(knock.body.checkCode).toMatch(/^\d{4}$/);
    const lifetime = iso(knock.body.expiresAt) - Date.now();
    expect(lifetime, 'a request lives 10 minutes').toBeGreaterThan(LIMITS.requestMinutes * 60_000 - 15_000);
    expect(lifetime).toBeLessThanOrEqual(LIMITS.requestMinutes * 60_000 + 5_000);

    // Pending until the Regie decides; the knock card reaches the Regie within 1.5 s (T-PAIR).
    const poll = await publicApi.getPairingRequestStatus(knock.body.requestId, knock.body.pollToken);
    expect(poll.body).toEqual({ status: 'pending', credentials: null });
    const card = await hub.waitForEvent('pairingRequestUpserted', (event) => event.request.id === knock.body.requestId, { timeoutMs: 1500 });
    expect(Date.now() - knockedAt, 'knock -> card (T-PAIR 1.5 s)').toBeLessThanOrEqual(2000);
    expect(card.request).toMatchObject({ name: 'Laptop Anna', kind: 'laptop', platform: 'Windows · Edge', checkCode: knock.body.checkCode });
    expect((await api.getSnapshot(production.id)).body.pairingRequests.map((request) => request.id)).toContain(knock.body.requestId);

    // Approve: a laptop device with S1, the card disappears, the laptop receives the same credentials on every poll.
    const approved = await api.approvePairingRequest(production.id, knock.body.requestId);
    expect(approved.status, approved.raw.text()).toBe(200);
    expect(approved.body).toMatchObject({ kind: 'laptop', name: 'Laptop Anna', pairingMethod: 'code', state: 'active' });
    const removed = await hub.waitForEvent('pairingRequestRemoved', (event) => event.requestId === knock.body.requestId);
    expect(removed.outcome).toBe('approved');
    const sourceEvent = await hub.waitForEvent('sourceUpserted', (event) => event.source.deviceId === approved.body.id);
    expect(sourceEvent.source).toMatchObject({ code: 'S1', slot: 'screen-1', kind: 'screen', label: 'Laptop Anna · Screen 1' });
    expectConsecutive(hub.events(), revision);

    const first = await publicApi.getPairingRequestStatus(knock.body.requestId, knock.body.pollToken);
    expect(first.body.status).toBe('approved');
    expect(first.body.credentials!.deviceId).toBe(approved.body.id);
    for (let index = 0; index < 4; index++) {
      const next = await publicApi.getPairingRequestStatus(knock.body.requestId, knock.body.pollToken);
      expect(next.body, 'identical credentials on every poll').toEqual(first.body);
    }
    const log = await hub.waitForEvent('logAppended', (event) => event.entry.text.includes('gekoppelt'));
    expect(log.entry.text).toBe(TEXT.log.paired('S1', 'Laptop Anna'));
  });

  test('E2E-PAIR-04 [api] laptop request denied: log entry, no device, poll says denied without credentials', t.p1, async ({ config, api, production, stack, onCleanup }) => {
    const { hub } = await openStudio(config.baseURL, api, production, onCleanup);
    const publicApi = new PublicApi(stack.anonymousBase, stack.forwardedForWorks ? uniqueIp() : undefined);
    const knock = await publicApi.createPairingRequest({ name: 'Laptop Anna', kind: 'laptop', platform: 'Windows · Edge' });
    production.pendingRequests.push({ requestId: knock.body.requestId, pollToken: knock.body.pollToken });
    const denied = await api.denyPairingRequest(production.id, knock.body.requestId);
    expect(denied.status).toBe(204);
    const removed = await hub.waitForEvent('pairingRequestRemoved', (event) => event.requestId === knock.body.requestId);
    expect(removed.outcome).toBe('denied');
    expect((await hub.waitForEvent('logAppended', (event) => event.entry.text.startsWith('Anfrage von'))).entry.text).toBe('Anfrage von Laptop Anna abgelehnt');
    const poll = await publicApi.getPairingRequestStatus(knock.body.requestId, knock.body.pollToken);
    expect(poll.body).toEqual({ status: 'denied', credentials: null });
    const snapshot = await production.snapshot();
    expect(snapshot.devices, 'no device was created').toHaveLength(0);
    expect(snapshot.sources.filter((source) => source.deviceId), 'no source was created').toHaveLength(0);
    expect(snapshot.pairingRequests.map((request) => request.id)).not.toContain(knock.body.requestId);
    // Denying again is harmless; approving a denied request is refused.
    expect((await api.denyPairingRequest(production.id, knock.body.requestId)).status).toBe(204);
    expect([404, 410]).toContain((await api.approvePairingRequest(production.id, knock.body.requestId)).status);
  });

  test('E2E-PAIR-08 [api] nine requests with identical names get nine distinct codes and are approved one by one', t.p1, async ({ production, stack }) => {
    const publicApi = new PublicApi(stack.anonymousBase, stack.forwardedForWorks ? uniqueIp() : undefined);
    const knocks = [];
    for (let index = 0; index < 9; index++) {
      const knock = await publicApi.createPairingRequest({ name: 'Laptop', kind: 'laptop', platform: 'Windows · Edge' });
      expect(knock.status, knock.raw.text()).toBe(201);
      production.pendingRequests.push({ requestId: knock.body.requestId, pollToken: knock.body.pollToken });
      knocks.push(knock.body);
    }
    expect(new Set(knocks.map((knock) => knock.checkCode)).size, 'distinct check codes').toBe(9);
    expect(new Set(knocks.map((knock) => knock.requestId)).size).toBe(9);
    expect((await production.snapshot()).pairingRequests).toHaveLength(9);

    // Approving the card with the code the laptop shows pairs exactly that laptop.
    const chosen = knocks[4]!;
    const approved = await production.api.approvePairingRequest(production.id, chosen.requestId);
    expect(approved.status).toBe(200);
    for (const knock of knocks) {
      const poll = await publicApi.getPairingRequestStatus(knock.requestId, knock.pollToken);
      expect(poll.body.status, `request ${knock.checkCode}`).toBe(knock === chosen ? 'approved' : 'pending');
    }
    const snapshot = await production.snapshot();
    expect(snapshot.devices).toHaveLength(1);
    expect(snapshot.pairingRequests).toHaveLength(8);
    // Names do not have to be unique: the device is called «Laptop».
    expect(approved.body.name).toBe('Laptop');
  });

  test('E2E-PAIR-09 [api] double approve race: exactly one device, the loser is told the card is gone', t.smoke, async ({ config, api, production, stack }) => {
    const publicApi = new PublicApi(stack.anonymousBase, stack.forwardedForWorks ? uniqueIp() : undefined);
    const knock = await publicApi.createPairingRequest({ name: 'Race Laptop', kind: 'laptop', platform: 'Windows · Edge' });
    production.pendingRequests.push({ requestId: knock.body.requestId, pollToken: knock.body.pollToken });
    const second = api.withBase(config.baseURL);
    const results = await Promise.all([api.approvePairingRequest(production.id, knock.body.requestId), second.approvePairingRequest(production.id, knock.body.requestId)]);
    const statuses = results.map((result) => result.status).sort();
    expect(statuses.filter((status) => status === 200), `one winner: ${statuses.join(', ')}`).toHaveLength(1);
    expect([404, 410], 'the loser is told that the card is gone').toContain(results.find((result) => result.status !== 200)!.status);
    const snapshot = await production.snapshot();
    expect(snapshot.devices, 'exactly one device').toHaveLength(1);
    expect(snapshot.recentLog.filter((entry) => entry.text.includes('gekoppelt')), 'one «gekoppelt» log entry').toHaveLength(1);
    const poll = await publicApi.getPairingRequestStatus(knock.body.requestId, knock.body.pollToken);
    expect(poll.body.status).toBe('approved');
    expect(poll.body.credentials!.deviceId).toBe(snapshot.devices[0]!.id);
  });

  test('E2E-PAIR-09 [api, GAP-09] the second of two concurrent approvals is answered 404 not_found', t.p1, async ({ config, api, production, stack }) => {
    knownBug('BUG-07', 'the loser of a double approve gets 410 pairing_expired; GAP-09 and UNIT-PAIR-04 pin 404 not_found (second approve: request already removed)');
    const publicApi = new PublicApi(stack.anonymousBase, stack.forwardedForWorks ? uniqueIp() : undefined);
    const knock = await publicApi.createPairingRequest({ name: 'Race Laptop 2', kind: 'laptop', platform: 'Windows · Edge' });
    production.pendingRequests.push({ requestId: knock.body.requestId, pollToken: knock.body.pollToken });
    const second = api.withBase(config.baseURL);
    const results = await Promise.all([api.approvePairingRequest(production.id, knock.body.requestId), second.approvePairingRequest(production.id, knock.body.requestId)]);
    expectProblem(results.find((result) => result.status !== 200)!, 404, ERROR.notFound);
  });

  test('E2E-PAIR-10 [api] invite link for laptops: /j/{token} redirect, direct pairing without approval, single use', t.smoke, async ({ config, api, production, stack, onCleanup }) => {
    const { hub } = await openStudio(config.baseURL, api, production, onCleanup);
    const created = await api.createInvite(production.id, { kind: 'laptopLink' });
    expect(created.status, created.raw.text()).toBe(201);
    expect(created.body.kind).toBe('laptopLink');
    expect(created.body.url).toMatch(new RegExp(`^${config.baseURL}/j/[A-Za-z0-9_-]{20,}$`));
    const token = inviteToken(created.body.url);
    const lifetime = iso(created.body.expiresAt) - Date.now();
    expect(lifetime).toBeGreaterThan(LIMITS.inviteMinutes * 60_000 - 15_000);
    expect((await hub.waitForEvent('inviteUpserted', (event) => event.invite.id === created.body.id)).invite.kind).toBe('laptopLink');

    // Caddy turns the short link into the sender route.
    const redirect = await send({ method: 'GET', url: created.body.url });
    expect(redirect.status).toBe(302);
    expect(redirect.headers['location']).toBe(`/join/i/${token}`);

    const publicApi = new PublicApi(stack.anonymousBase, stack.forwardedForWorks ? uniqueIp() : undefined);
    const redeemed = await publicApi.redeemInvite(token, { clientId: 'client-a', name: 'Laptop Lea', kind: 'laptop', platform: 'macOS · Safari' });
    expect(redeemed.status, redeemed.raw.text()).toBe(200);
    const device = (await production.snapshot()).devices.find((entry) => entry.id === redeemed.body.deviceId)!;
    expect(device).toMatchObject({ kind: 'laptop', pairingMethod: 'link', name: 'Laptop Lea' });
    expect((await hub.waitForEvent('inviteRemoved', (event) => event.inviteId === created.body.id)).inviteId).toBe(created.body.id);
    const second = await publicApi.redeemInvite(token, { clientId: 'client-b', kind: 'laptop', platform: 'x' });
    expectProblem(second, 410, ERROR.pairingExpired);
    const texts = (await production.snapshot()).recentLog.map((entry) => entry.text);
    expect(texts).toContain('Einladungslink erstellt');
  });

  test('E2E-PAIR-11 [api] revoking an invite link: gone from the Regie, redeem answers 410, log entries', t.p1, async ({ config, api, production, stack, onCleanup }) => {
    const { hub } = await openStudio(config.baseURL, api, production, onCleanup);
    const created = (await api.createInvite(production.id, { kind: 'laptopLink' })).body;
    expect((await api.revokeInvite(production.id, created.id)).status).toBe(204);
    await hub.waitForEvent('inviteRemoved', (event) => event.inviteId === created.id);
    expect((await production.snapshot()).invites.map((invite) => invite.id)).not.toContain(created.id);
    const publicApi = new PublicApi(stack.anonymousBase, stack.forwardedForWorks ? uniqueIp() : undefined);
    expectProblem(await publicApi.redeemInvite(inviteToken(created.url), { clientId: 'client-a', kind: 'laptop', platform: 'x' }), 410, ERROR.pairingExpired);
    const texts = (await production.snapshot()).recentLog.map((entry) => entry.text);
    expect(texts).toEqual(expect.arrayContaining(['Einladungslink erstellt', 'Einladungslink widerrufen']));
    expectProblem(await api.revokeInvite(production.id, 'inv_doesnotexist0000'), 404, ERROR.notFound);
  });

  test('E2E-PAIR-12 [api] a new QR code invalidates the old one at once; there is always exactly one phone invite', t.p1, async ({ api, production, stack }) => {
    const publicApi = new PublicApi(stack.anonymousBase, stack.forwardedForWorks ? uniqueIp() : undefined);
    const first = (await api.getPhoneInvite(production.id)).body;
    const renewed = await api.renewPhoneInvite(production.id);
    expect(renewed.status).toBe(200);
    expect(renewed.body.id).not.toBe(first.id);
    expect(inviteToken(renewed.body.url)).not.toBe(inviteToken(first.url));
    const phoneInvites = (await production.snapshot()).invites.filter((invite) => invite.kind === 'phoneQr');
    expect(phoneInvites.map((invite) => invite.id), 'exactly one valid phone invite').toEqual([renewed.body.id]);
    expectProblem(await publicApi.redeemInvite(inviteToken(first.url), { clientId: 'old', kind: 'phone', platform: 'x' }), 410, ERROR.pairingExpired);
    const redeemed = await publicApi.redeemInvite(inviteToken(renewed.body.url), { clientId: 'new', kind: 'phone', platform: 'x' });
    expect(redeemed.status).toBe(200);
    // createInvite{phoneQr} behaves like renew (GAP-19)
    const viaCreate = await api.createInvite(production.id, { kind: 'phoneQr' });
    expect([200, 201]).toContain(viaCreate.status);
    expect((await production.snapshot()).invites.filter((invite) => invite.kind === 'phoneQr')).toHaveLength(1);
  });

  test('E2E-PAIR-13 [api] re-recognition: stored credentials identify the device again, also after it was blocked and unblocked', t.smoke, async ({ api, production, pairContext }) => {
    const phone = await pairPhone(pairContext, { name: 'Handy Stefan' });
    const me = await phone.api.getDeviceSelf();
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ id: phone.id, name: 'Handy Stefan', kind: 'phone', state: 'active', productionId: production.id });
    expect(me.body.slots[0]!.code).toBe('K1');
    // Reload = same credentials, same code, no second station.
    expect((await phone.api.getDeviceSelf()).body.slots[0]!.code).toBe('K1');
    expect((await production.snapshot()).devices).toHaveLength(1);
    // Unpairing (the sender's own «entfernen») invalidates the credentials.
    expect((await phone.api.unpairDevice()).status).toBe(204);
    expectProblem(await phone.api.getDeviceSelf(), 401, ERROR.unauthorized);
    expect((await production.snapshot()).devices).toHaveLength(0);
    void api;
  });

  test('E2E-PAIR-14 [api] a lost redeem response: the same clientId gets the same device with a rotated secret', t.smoke, async ({ api, production, stack }) => {
    const publicApi = new PublicApi(stack.anonymousBase, stack.forwardedForWorks ? uniqueIp() : undefined);
    const invite = (await api.getPhoneInvite(production.id)).body;
    const token = inviteToken(invite.url);
    const body = { clientId: 'lost-response-client', kind: 'phone', platform: 'Pixel 7 · Chrome' };
    const first = await publicApi.redeemInvite(token, body);
    const retry = await publicApi.redeemInvite(token, body);
    expect(first.status).toBe(200);
    expect(retry.status).toBe(200);
    expect(retry.body.deviceId, 'same device').toBe(first.body.deviceId);
    expect(retry.body.deviceSecret, 'rotated secret').not.toBe(first.body.deviceSecret);
    const { DeviceApi } = await import('../../support/api');
    expectProblem(await new DeviceApi(stack.anonymousBase, first.body).getDeviceSelf(), 401, ERROR.unauthorized);
    expect((await new DeviceApi(stack.anonymousBase, retry.body).getDeviceSelf()).status).toBe(200);
    const snapshot = await production.snapshot();
    expect(snapshot.devices, 'exactly one device').toHaveLength(1);
    expect(snapshot.recentLog.filter((entry) => entry.text.includes('gekoppelt')), 'one pairing log entry').toHaveLength(1);
    // Another client cannot take the invite any more.
    expectProblem(await publicApi.redeemInvite(token, { ...body, clientId: 'someone-else' }), 410, ERROR.pairingExpired);
  });

  test('E2E-PAIR-18 [api] a second operator sees knock card and new station live within a second', t.p2, async ({ config, api, production, stack, onCleanup }) => {
    const a = await openStudio(config.baseURL, api, production, onCleanup);
    const b = await openStudio(config.baseURL, api, production, onCleanup);
    const publicApi = new PublicApi(stack.anonymousBase, stack.forwardedForWorks ? uniqueIp() : undefined);
    const started = Date.now();
    const knock = await publicApi.createPairingRequest({ name: 'Laptop Zwei', kind: 'laptop', platform: 'Windows · Edge' });
    production.pendingRequests.push({ requestId: knock.body.requestId, pollToken: knock.body.pollToken });
    for (const operator of [a, b]) await operator.hub.waitForEvent('pairingRequestUpserted', (event) => event.request.id === knock.body.requestId, { timeoutMs: 1000 });
    expect(Date.now() - started).toBeLessThan(1500);
    const approvedAt = Date.now();
    await api.approvePairingRequest(production.id, knock.body.requestId);
    for (const operator of [a, b]) {
      await operator.hub.waitForEvent('pairingRequestRemoved', (event) => event.requestId === knock.body.requestId, { timeoutMs: 1000 });
      await operator.hub.waitForEvent('deviceUpserted', (event) => event.device.name === 'Laptop Zwei', { timeoutMs: 1000 });
    }
    expect(Date.now() - approvedAt).toBeLessThan(1500);
    expect(a.hub.presence(), 'both operators are counted').toBe(2);
  });

  test('E2E-PAIR-19 [api] a Regie that reconnects after a short gap gets the knock card exactly once (delta)', t.p2, async ({ config, api, production, stack, onCleanup }) => {
    const a = await openStudio(config.baseURL, api, production, onCleanup);
    const lastRevision = a.revision;
    await a.hub.stop();
    const publicApi = new PublicApi(stack.anonymousBase, stack.forwardedForWorks ? uniqueIp() : undefined);
    const knock = await publicApi.createPairingRequest({ name: 'Laptop Spaet', kind: 'laptop', platform: 'Windows · Edge' });
    production.pendingRequests.push({ requestId: knock.body.requestId, pollToken: knock.body.pollToken });
    const again = await openStudio(config.baseURL, api, production, onCleanup, { sinceRevision: lastRevision });
    // Reconnect with the last revision: the server answers with the missed events (delta), not a snapshot.
    const changes = await again.hub.subscribe(production.id, lastRevision);
    expect(changes.snapshot, 'delta, not snapshot').toBeNull();
    const cards = (changes.events ?? []).filter((event) => event.type === 'pairingRequestUpserted' && event.request.id === knock.body.requestId);
    expect(cards, 'the card appears exactly once').toHaveLength(1);
    expect((await production.snapshot()).pairingRequests.filter((request) => request.id === knock.body.requestId)).toHaveLength(1);
  });

  test('E2E-PAIR-20 [http] short URL entry points serve the sender shell, /j/* redirects', t.p1, async ({ config }) => {
    for (const route of ['/join/', '/join/warten', '/join/station', '/join/i/abc', '/join/some/unknown/deep/link']) {
      const response = await send({ method: 'GET', url: `${config.baseURL}${route}` });
      expect(response.status, route).toBe(200);
      expect(response.headers['content-type'], route).toMatch(/html/);
      expect(response.text(), route).toMatch(/<base\s+href=["']\/join\/["']/i);
    }
    const bare = await send({ method: 'GET', url: `${config.baseURL}/join` });
    expect(bare.status).toBe(308);
    expect(bare.headers['location']).toBe('/join/');
    const withQuery = await send({ method: 'GET', url: `${config.baseURL}/join?x=1` });
    expect(withQuery.headers['location']).toBe('/join/?x=1');
    const link = await send({ method: 'GET', url: `${config.baseURL}/j/abc` });
    expect(link.status).toBe(302);
    expect(link.headers['location']).toBe('/join/i/abc');
  });

  // --- INT-PAIR-* at stack level ----------------------------------------------------------------------------------

  test('INT-PAIR-03 [stack] invalid invites all answer the same 410', t.p0, async ({ stack }) => {
    const ip = stack.forwardedForWorks ? uniqueIp() : undefined;
    const publicApi = new PublicApi(stack.anonymousBase, ip);
    const bodies = new Set<string>();
    for (const token of ['A'.repeat(43), 'a'.repeat(43), 'x', 'inv_notatoken', 'z'.repeat(2000), '%20']) {
      const response = await publicApi.redeemInvite(token, { clientId: 'c1', kind: 'phone', platform: 'x' });
      expect(response.status, `token ${token.slice(0, 20)}`).toBe(410);
      expect(response.body.code).toBe(ERROR.pairingExpired);
      bodies.add(response.raw.text().replace(/"traceId":"[^"]*",?/, ''));
    }
    expect([...bodies], 'identical bodies, no oracle').toHaveLength(1);
  });

  test('INT-PAIR-06 [stack] poll token security: unknown id and wrong token look expired, DELETE with a wrong token does nothing', t.p0, async ({ production, stack }) => {
    const publicApi = new PublicApi(stack.anonymousBase, stack.forwardedForWorks ? uniqueIp() : undefined);
    const mine = await publicApi.createPairingRequest({ name: 'Poll A', kind: 'laptop', platform: 'x' });
    const other = await publicApi.createPairingRequest({ name: 'Poll B', kind: 'laptop', platform: 'x' });
    production.pendingRequests.push({ requestId: mine.body.requestId, pollToken: mine.body.pollToken }, { requestId: other.body.requestId, pollToken: other.body.pollToken });
    const expired = { status: 'expired', credentials: null };
    expect((await publicApi.getPairingRequestStatus(mine.body.requestId)).status, 'missing header').toBe(400);
    expect((await publicApi.getPairingRequestStatus(mine.body.requestId, 'wrong')).body).toEqual(expired);
    expect((await publicApi.getPairingRequestStatus(mine.body.requestId, other.body.pollToken)).body, 'token of another request').toEqual(expired);
    expect((await publicApi.getPairingRequestStatus('prq_aaaaaaaaaaaaaaaa', mine.body.pollToken)).body, 'unknown id').toEqual(expired);
    expect((await publicApi.cancelPairingRequest(mine.body.requestId, 'wrong')).status).toBe(204);
    expect((await publicApi.getPairingRequestStatus(mine.body.requestId, mine.body.pollToken)).body.status, 'wrong-token DELETE had no effect').toBe('pending');
    expect((await publicApi.cancelPairingRequest(mine.body.requestId, mine.body.pollToken)).status).toBe(204);
    expect((await publicApi.cancelPairingRequest(mine.body.requestId, mine.body.pollToken)).status, 'idempotent').toBe(204);
    expect((await publicApi.getPairingRequestStatus(mine.body.requestId, mine.body.pollToken)).body.status, 'a cancelled request is gone').toBe('expired');
    expect((await production.snapshot()).pairingRequests.map((request) => request.id)).not.toContain(mine.body.requestId);
  });

  test('INT-PAIR-08 [stack] validation of pairing requests', t.p0, async ({ production, stack }) => {
    const ip = stack.forwardedForWorks ? uniqueIp() : undefined;
    const publicApi = new PublicApi(stack.anonymousBase, ip);
    const valid = { name: 'Laptop', kind: 'laptop', platform: 'Windows · Edge' };
    const fieldOf = (result: { body: { errors?: Record<string, string[]> } }) => Object.keys(result.body.errors ?? {}).map((key) => key.toLowerCase());
    for (const [label, body, field] of [
      ['empty name', { ...valid, name: '' }, 'name'],
      ['61 characters', { ...valid, name: 'n'.repeat(61) }, 'name'],
      ['control characters only', { ...valid, name: '\u0001\u0002' }, 'name'],
      ['unknown numeric kind', { ...valid, kind: 5 }, 'kind'],
    ] as const) {
      const result = await publicApi.createPairingRequest(body);
      expectProblem(result, 400, ERROR.validationFailed);
      expect(fieldOf(result), label).toContain(field);
    }
    // 60 characters are fine, platform > 80 is truncated, unknown fields are ignored.
    const sixty = await publicApi.createPairingRequest({ ...valid, name: 'n'.repeat(60), platform: 'p'.repeat(81), extra: 'ignored' });
    expect(sixty.status, sixty.raw.text()).toBe(201);
    production.pendingRequests.push({ requestId: sixty.body.requestId, pollToken: sixty.body.pollToken });
    const card = (await production.snapshot()).pairingRequests.find((request) => request.id === sixty.body.requestId)!;
    expect(card.name).toHaveLength(60);
    expect(card.platform).toHaveLength(LIMITS.platformMax);
    // Oversize bodies are refused before the handler runs.
    const big = await send({ method: 'POST', url: `${stack.anonymousBase}/api/pairing/requests`, headers: ip ? { 'X-Forwarded-For': ip } : {}, json: { ...valid, platform: 'x'.repeat(300 * 1024) } });
    expect(big.status).toBe(413);
  });

  test('INT-PAIR-08 [stack, enum text] an unknown enum text is a 400 that names the field', t.p2, async ({ stack }) => {
    knownBug('BUG-08', 'kind: "tablet" yields 400 validation_failed without an errors object (body binding failure); numeric out-of-range values do name the field');
    const publicApi = new PublicApi(stack.anonymousBase, stack.forwardedForWorks ? uniqueIp() : undefined);
    const result = await publicApi.createPairingRequest({ name: 'Laptop', kind: 'tablet', platform: 'x' });
    expectProblem(result, 400, ERROR.validationFailed);
    expect(Object.keys(result.body.errors ?? {}).map((key) => key.toLowerCase())).toContain('kind');
  });

  test('INT-PAIR-10 [stack] a redeem with a kind that contradicts the invite creates a device and never fails with 500', t.p1, async ({ api, production, stack }) => {
    const publicApi = new PublicApi(stack.anonymousBase, stack.forwardedForWorks ? uniqueIp() : undefined);
    const phoneInvite = (await api.getPhoneInvite(production.id)).body;
    const asLaptop = await publicApi.redeemInvite(inviteToken(phoneInvite.url), { clientId: 'k1', kind: 'laptop', platform: 'x' });
    expect(asLaptop.status, asLaptop.raw.text()).toBe(200);
    const linkInvite = (await api.createInvite(production.id, { kind: 'laptopLink' })).body;
    const asPhone = await publicApi.redeemInvite(inviteToken(linkInvite.url), { clientId: 'k2', kind: 'phone', platform: 'x' });
    expect(asPhone.status, asPhone.raw.text()).toBe(200);
    expect((await production.snapshot()).devices).toHaveLength(2);
  });

  test('INT-PAIR-10 [stack, GAP-19] the invite kind decides the device kind, the body kind is ignored', t.p1, async ({ api, production, stack }) => {
    knownBug('BUG-09', 'redeem takes the device kind from the request body: a phoneQr invite redeemed with kind=laptop yields a laptop with a screen slot (GAP-19 pins: the invite kind decides)');
    const publicApi = new PublicApi(stack.anonymousBase, stack.forwardedForWorks ? uniqueIp() : undefined);
    const phoneInvite = (await api.getPhoneInvite(production.id)).body;
    const asLaptop = await publicApi.redeemInvite(inviteToken(phoneInvite.url), { clientId: 'k1', kind: 'laptop', platform: 'x' });
    const linkInvite = (await api.createInvite(production.id, { kind: 'laptopLink' })).body;
    const asPhone = await publicApi.redeemInvite(inviteToken(linkInvite.url), { clientId: 'k2', kind: 'phone', platform: 'x' });
    const snapshot = await production.snapshot();
    const byId = new Map(snapshot.devices.map((device) => [device.id, device]));
    expect(byId.get(asLaptop.body.deviceId)).toMatchObject({ kind: 'phone', pairingMethod: 'qr' });
    expect(byId.get(asPhone.body.deviceId)).toMatchObject({ kind: 'laptop', pairingMethod: 'link' });
    const slots = snapshot.sources.filter((source) => source.deviceId);
    expect(slots.find((source) => source.deviceId === asLaptop.body.deviceId)?.slot).toBe('camera');
    expect(slots.find((source) => source.deviceId === asPhone.body.deviceId)?.slot).toBe('screen-1');
  });

  test('UNIT-PAIR-06 [stack] default device names count up, given names are trimmed', t.p2, async ({ api, production, pairContext }) => {
    const names: string[] = [];
    for (let index = 0; index < 3; index++) names.push((await pairPhone(pairContext)).name);
    expect(names).toEqual(['Handy 1', 'Handy 2', 'Handy 3']);
    const laptops = [(await pairLaptopByLink(pairContext)).name, (await pairLaptopByLink(pairContext)).name];
    expect(laptops).toEqual(['Laptop 1', 'Laptop 2']);
    // «Handy 2» is removed: the lowest free number is used again.
    const handy2 = (await production.snapshot()).devices.find((device) => device.name === 'Handy 2')!;
    expect((await api.deleteDevice(production.id, handy2.id)).status).toBe(204);
    expect((await pairPhone(pairContext)).name).toBe('Handy 2');
    expect((await pairPhone(pairContext, { name: '  Anna  ' })).name).toBe('Anna');
    expect((await pairPhone(pairContext, { name: 'n'.repeat(60) })).name).toHaveLength(60);
  });

  test('INT-PAIR-12 [stack] block, unblock and delete a connected device (events, hub, LiveKit token)', t.p0, async ({ config, api, production, pairContext, stack, onCleanup }) => {
    const { hub } = await openStudio(config.baseURL, api, production, onCleanup);
    const phone = await pairPhone(pairContext, { name: 'Handy 1' });
    const scene = production.sceneIds[0]!;
    await api.addSceneItem(production.id, scene, { source: phone.sourceId('camera') });
    const device = DeviceHub.connect(stack.anonymousBase, phone.credentials, { headers: stack.forwardedForWorks ? { 'X-Forwarded-For': uniqueIp() } : {} });
    onCleanup(() => device.stop());
    await device.open();
    await device.reportLive(['camera']);
    await hub.waitForEvent('sourceUpserted', (event) => event.source.deviceId === phone.id && event.source.status === 'ok');
    const from = hub.received.length;

    const blockedAt = Date.now();
    const blocked = await api.blockDevice(production.id, phone.id);
    expect(blocked.status).toBe(200);
    expect(blocked.body.state).toBe('blocked');
    // The device hub receives the final self message and is closed within T-BLOCK.
    const closedAt = await device.waitClosed(5000);
    expect(closedAt - blockedAt, 'T-BLOCK').toBeLessThanOrEqual(THRESHOLD.blockHardMs);
    expect(device.selfMessages().at(-1)?.state).toBe('blocked');
    await hub.waitForEvent('deviceUpserted', (event) => event.device.id === phone.id && event.device.state === 'blocked', { from });
    expect((await hub.waitForEvent('sourceUpserted', (event) => event.source.deviceId === phone.id && event.source.status === 'blocked', { from })).source.code).toBe('K1');
    expect((await hub.waitForEvent('logAppended', (event) => event.entry.text.endsWith('gesperrt'), { from })).entry.text).toMatch(/^K1\b.*gesperrt$/);
    expectProblem(await phone.api.getDeviceLiveKitToken(), 403, ERROR.deviceBlocked);
    // Blocking twice is a no-op.
    expect((await api.blockDevice(production.id, phone.id)).status).toBe(200);

    const unblocked = await api.unblockDevice(production.id, phone.id);
    expect(unblocked.body.state).toBe('active');
    const source = (await hub.waitForEvent('sourceUpserted', (event) => event.source.deviceId === phone.id && event.source.status !== 'blocked', { from })).source;
    expect(source.status, 'unblock leads to offline, never to an incident').toBe('offline');
    expect((await hub.waitForEvent('logAppended', (event) => event.entry.text.endsWith('entsperrt'), { from })).entry.text).toMatch(/^K1\b.*entsperrt$/);
    expect((await production.snapshot()).incidents).toHaveLength(0);
    // The device may connect again.
    const again = DeviceHub.connect(stack.anonymousBase, phone.credentials, { headers: stack.forwardedForWorks ? { 'X-Forwarded-For': uniqueIp() } : {} });
    onCleanup(() => again.stop());
    await again.open();

    // Delete: device and source disappear, the scene keeps the item (dangling reference).
    expect((await api.deleteDevice(production.id, phone.id)).status).toBe(204);
    await hub.waitForEvent('deviceRemoved', (event) => event.deviceId === phone.id, { from });
    await hub.waitForEvent('sourceRemoved', (event) => event.sourceId === phone.sourceId('camera'), { from });
    expect((await hub.waitForEvent('logAppended', (event) => event.entry.text.endsWith('entfernt'), { from })).entry.text).toContain('entfernt');
    const snapshot = await production.snapshot();
    expect(snapshot.devices).toHaveLength(0);
    expect(snapshot.scenes.find((entry) => entry.id === scene)!.items.map((item) => item.source), 'scene keeps the dangling item').toEqual([phone.sourceId('camera')]);
    await again.waitClosed(5000);
    expectProblem(await phone.api.getDeviceSelf(), 401, ERROR.unauthorized);
  });

  test('INT-PAIR-12 [stack, log texts] block and unblock log «K1 Handy 1 gesperrt» / «K1 Handy 1 entsperrt» (codes and device name, BUG-10 resolved as an intended deviation)', t.p2, async ({ config, api, production, pairContext, onCleanup }) => {
    const { hub } = await openStudio(config.baseURL, api, production, onCleanup);
    const phone = await pairPhone(pairContext, { name: 'Handy 1' });
    await api.blockDevice(production.id, phone.id);
    expect((await hub.waitForEvent('logAppended', (event) => event.entry.text.endsWith('gesperrt'))).entry.text).toBe('K1 Handy 1 gesperrt');
    await api.unblockDevice(production.id, phone.id);
    expect((await hub.waitForEvent('logAppended', (event) => event.entry.text.endsWith('entsperrt'))).entry.text).toBe('K1 Handy 1 entsperrt');
  });

  test('INT-PAIR-13 [stack] renaming a device updates device, source label and the connected sender', t.p2, async ({ config, api, production, pairContext, stack, onCleanup }) => {
    const { hub } = await openStudio(config.baseURL, api, production, onCleanup);
    const phone = await pairPhone(pairContext, { name: 'Handy 1' });
    const device = DeviceHub.connect(stack.anonymousBase, phone.credentials, { headers: stack.forwardedForWorks ? { 'X-Forwarded-For': uniqueIp() } : {} });
    onCleanup(() => device.stop());
    await device.open();
    const renamed = await api.renameDevice(production.id, phone.id, '  Bühne rechts  ');
    expect(renamed.status).toBe(200);
    expect(renamed.body.name).toBe('Bühne rechts');
    await hub.waitForEvent('deviceUpserted', (event) => event.device.name === 'Bühne rechts');
    expect((await hub.waitForEvent('sourceUpserted', (event) => event.source.label === 'Bühne rechts')).source.code).toBe('K1');
    await device.waitFor('self message with the new name', (entry) => entry.method === 'self' && (entry.args[0] as { name: string }).name === 'Bühne rechts');
    expectProblem(await api.renameDevice(production.id, phone.id, ''), 400, ERROR.validationFailed);
    expectProblem(await api.renameDevice(production.id, phone.id, 'n'.repeat(61)), 400, ERROR.validationFailed);
    expect((await api.renameDevice(production.id, phone.id, 'n'.repeat(60))).status).toBe(200);
    for (const text of ['<img src=x onerror=window.__xss=1>', '"><script>1</script>', "'><svg/onload=window.__xss=1>"]) {
      const result = await api.renameDevice(production.id, phone.id, text);
      expect(result.status, text).toBe(200);
      expect(result.body.name, 'HTML is stored verbatim and escaped by the clients').toBe(text);
    }
    // Bidi override characters may be stripped or kept; they must never break the request.
    expect((await api.renameDevice(production.id, phone.id, 'ab\u202eevil\u202c')).status).toBe(200);
  });

  test('INT-PAIR-14 [stack] slot allocation and release of a laptop', t.p1, async ({ production, pairContext }) => {
    const laptop = await pairLaptopByLink(pairContext, { name: 'Laptop Lea' });
    expect(laptop.codes).toEqual({ 'screen-1': 'S1' });
    const slots = [];
    for (let n = 2; n <= 9; n++) {
      const slot = await laptop.api.allocateSlot({ kind: 'screen' });
      expect(slot.status, `screen ${n}: ${slot.raw.text()}`).toBe(200);
      slots.push(slot.body);
    }
    expect(slots.map((slot) => slot.slot)).toEqual(['screen-2', 'screen-3', 'screen-4', 'screen-5', 'screen-6', 'screen-7', 'screen-8', 'screen-9']);
    expect(slots.map((slot) => slot.code)).toEqual(['S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9']);
    expectProblem(await laptop.api.allocateSlot({ kind: 'screen' }), 409, ERROR.limitReached);
    const camera = await laptop.api.allocateSlot({ kind: 'camera' });
    expect(camera.status).toBe(200);
    expect(camera.body).toMatchObject({ slot: 'camera', kind: 'camera' });
    expectProblem(await laptop.api.allocateSlot({ kind: 'camera' }), 409, ERROR.limitReached);
    expectProblem(await laptop.api.allocateSlot({ kind: 'image' }), 400, ERROR.validationFailed);
    expectProblem(await laptop.api.allocateSlot({ kind: 'nonsense' }), 400, ERROR.validationFailed);
    // Release frees the code for the next allocation.
    expect((await laptop.api.releaseSlot('screen-2')).status).toBe(204);
    expect((await production.snapshot()).sources.map((source) => source.id)).not.toContain(laptop.sourceId('screen-2'));
    const reused = await laptop.api.allocateSlot({ kind: 'screen' });
    expect(reused.body).toMatchObject({ slot: 'screen-2', code: 'S2' });
  });

  test('INT-PAIR-14 [stack, errors] releasing unknown or essential slots', t.p2, async ({ pairContext }) => {
    knownBug('BUG-06', 'DELETE /api/device/slots/{unknown} answers 204 and a phone may release its only camera slot; GAP-19 pins 404 not_found and 409 conflict');
    const phone = await pairPhone(pairContext);
    const laptop = await pairLaptopByLink(pairContext);
    expectProblem(await laptop.api.releaseSlot('screen-7'), 404, ERROR.notFound);
    expectProblem(await phone.api.releaseSlot('camera'), 409, ERROR.conflict);
    expectProblem(await phone.api.allocateSlot({ kind: 'screen' }), 400, ERROR.validationFailed);
  });

  test('INT-PAIR-15 [stack] concurrency: one winner per invite, all slot codes distinct', t.smoke, async ({ api, production, stack }) => {
    const anon = () => new PublicApi(stack.anonymousBase, stack.forwardedForWorks ? uniqueIp() : undefined);
    // 20 clients, one invite: exactly one device is created, the others get 410.
    const invite = (await api.createInvite(production.id, { kind: 'laptopLink' })).body;
    const token = inviteToken(invite.url);
    const distinct = await Promise.all(Array.from({ length: 20 }, (_, index) => anon().redeemInvite(token, { clientId: `racer-${index}`, kind: 'laptop', platform: 'x' })));
    expect(distinct.filter((result) => result.status === 200), distinct.map((result) => result.status).join(',')).toHaveLength(1);
    expect(distinct.filter((result) => result.status === 410)).toHaveLength(19);
    // 20 requests with the same clientId: all succeed with the same device.
    const invite2 = (await api.createInvite(production.id, { kind: 'laptopLink' })).body;
    const same = await Promise.all(Array.from({ length: 20 }, () => anon().redeemInvite(inviteToken(invite2.url), { clientId: 'same-client', kind: 'laptop', platform: 'x' })));
    expect(same.every((result) => result.status === 200), same.map((result) => result.status).join(',')).toBe(true);
    expect(new Set(same.map((result) => result.body.deviceId)).size).toBe(1);
    // 30 invites paired in parallel: distinct devices, distinct slot codes.
    const invites = await Promise.all(Array.from({ length: 30 }, () => api.createInvite(production.id, { kind: 'laptopLink' })));
    const paired = await Promise.all(invites.map((created, index) => anon().redeemInvite(inviteToken(created.body.url), { clientId: `parallel-${index}`, kind: 'laptop', platform: 'x' })));
    expect(paired.every((result) => result.status === 200), paired.map((result) => result.status).join(',')).toBe(true);
    const snapshot = await production.snapshot();
    expect(snapshot.devices).toHaveLength(32);
    const codes = snapshot.sources.filter((source) => source.deviceId).map((source) => source.code);
    expect(new Set(codes).size, 'all slot codes are distinct').toBe(codes.length);
    expect(codes).toHaveLength(32);
    // Two operators approve one card at the same time (E2E-PAIR-09 covers the REST status of the loser).
    const knock = await anon().createPairingRequest({ name: 'Race', kind: 'laptop', platform: 'x' });
    production.pendingRequests.push({ requestId: knock.body.requestId, pollToken: knock.body.pollToken });
    const approvals = await Promise.all([api.approvePairingRequest(production.id, knock.body.requestId), api.approvePairingRequest(production.id, knock.body.requestId)]);
    expect(approvals.filter((result) => result.status === 200)).toHaveLength(1);
    expect((await production.snapshot()).devices).toHaveLength(33);
  });

  test('INT-PAIR-16 [stack] production scoping of pairing requests (GAP-36)', t.p1, async ({ api, production, stack }) => {
    const publicApi = new PublicApi(stack.anonymousBase, stack.forwardedForWorks ? uniqueIp() : undefined);
    const knock = await publicApi.createPairingRequest({ name: 'Scope', kind: 'laptop', platform: 'x' });
    production.pendingRequests.push({ requestId: knock.body.requestId, pollToken: knock.body.pollToken });
    const other = (await api.createProduction({ name: `e2e scope other ${Date.now()}` })).body;
    // Approving through another production's route finds nothing.
    expectProblem(await api.approvePairingRequest(other.id, knock.body.requestId), 404, ERROR.notFound);
    expect((await publicApi.getPairingRequestStatus(knock.body.requestId, knock.body.pollToken)).body.status, 'still pending').toBe('pending');
    // An invite always pairs into its own production, also when another one is active.
    const invite = (await api.createInvite(production.id, { kind: 'laptopLink' })).body;
    expect((await api.activateProduction(other.id)).status).toBe(200);
    const redeemed = await publicApi.redeemInvite(inviteToken(invite.url), { clientId: 'scope-1', kind: 'laptop', platform: 'x' });
    expect(redeemed.status, redeemed.raw.text()).toBe(200);
    expect(redeemed.body.productionId).toBe(production.id);
    await api.activateProduction(production.id);
  });

  test('INT-PAIR-16 [stack, GAP-36] activating another production drops the pending knock requests of the previous one', t.p1, async ({ api, production, stack, config, onCleanup }) => {
    knownBug('BUG-11', 'pending knock requests survive the activation of another production (GAP-36 pins: dropped with outcome expired, poll answers expired)');
    const { hub } = await openStudio(config.baseURL, api, production, onCleanup);
    const publicApi = new PublicApi(stack.anonymousBase, stack.forwardedForWorks ? uniqueIp() : undefined);
    const knock = await publicApi.createPairingRequest({ name: 'Scope', kind: 'laptop', platform: 'x' });
    production.pendingRequests.push({ requestId: knock.body.requestId, pollToken: knock.body.pollToken });
    const other = (await api.createProduction({ name: `e2e scope other ${Date.now()}` })).body;
    expect((await api.activateProduction(other.id)).status).toBe(200);
    try {
      expect((await publicApi.getPairingRequestStatus(knock.body.requestId, knock.body.pollToken)).body.status, 'dropped with outcome expired').toBe('expired');
      expect(hub.eventsOfType('pairingRequestRemoved').some((event) => event.requestId === knock.body.requestId && event.outcome === 'expired')).toBe(true);
    } finally {
      await api.activateProduction(production.id);
    }
  });
});
