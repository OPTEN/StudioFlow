import { PublicApi, inviteToken } from '../../support/api';
import { ERROR } from '../../support/constants';
import { expect, expectProblem, test, uniqueIp } from '../../support/fixtures';
import { openStudio } from '../../support/helpers';
import { sleep } from '../../support/shell';
import { t } from '../../support/tags';
import { probeTtlSupport, useDefaultTtl, useShortTtl, type TtlSupport } from '../../support/ttl';

/**
 * PAIR with the short-TTL profile (invite 20 s, request 20 s, credentials window 15 s, redeem idempotency 10 s,
 * pending cap 3): E2E-PAIR-05, -06, -07, -16 and the invite expiry of UNIT-PAIR-01 at stack level.
 * Depends on the options of [GAP-01]; whatever the running API does not read yet is reported as skipped with the
 * missing key named, never as a pass.
 */

let support: TtlSupport;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  test.setTimeout(300_000);
  await useShortTtl();
  support = await probeTtlSupport();
  test.info().annotations.push({ type: 'ttl-support', description: JSON.stringify(support) });
});

test.afterAll(async () => {
  test.setTimeout(300_000);
  await useDefaultTtl();
});

test.describe('PAIR short-TTL', () => {
  test('E2E-PAIR-05 [api] an unanswered request expires after its TTL; the knock card disappears without a reload; a new request gets a new code', t.shortTtl(), async ({ config, api, production, stack, onCleanup }) => {
    test.skip(!support.request, `GAP-01: Pairing:RequestTtl is not read by the API (a request lives ${support.observed.request} s, expected about 20 s)`);
    const { hub } = await openStudio(config.baseURL, api, production, onCleanup);
    const publicApi = new PublicApi(stack.anonymousBase, stack.forwardedForWorks ? uniqueIp() : undefined);
    const knock = await publicApi.createPairingRequest({ name: 'Laptop Anna', kind: 'laptop', platform: 'Windows · Edge' });
    production.pendingRequests.push({ requestId: knock.body.requestId, pollToken: knock.body.pollToken });
    expect(new Date(knock.body.expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(21_000);
    await hub.waitForEvent('pairingRequestUpserted', (event) => event.request.id === knock.body.requestId);
    expect((await publicApi.getPairingRequestStatus(knock.body.requestId, knock.body.pollToken)).body.status).toBe('pending');

    // 25 s without an answer: the card is removed by the server (outcome expired), the poll says expired.
    const removed = await hub.waitForEvent('pairingRequestRemoved', (event) => event.requestId === knock.body.requestId, { timeoutMs: 30_000 });
    expect(removed.outcome).toBe('expired');
    expect((await publicApi.getPairingRequestStatus(knock.body.requestId, knock.body.pollToken)).body).toEqual({ status: 'expired', credentials: null });
    expect((await production.snapshot()).pairingRequests).toHaveLength(0);
    const again = await publicApi.createPairingRequest({ name: 'Laptop Anna', kind: 'laptop', platform: 'Windows · Edge' });
    production.pendingRequests.push({ requestId: again.body.requestId, pollToken: again.body.pollToken });
    expect(again.body.requestId).not.toBe(knock.body.requestId);
  });

  test('E2E-PAIR-06 [api] approving a request after it expired creates no device', t.shortTtl(), async ({ api, production, stack }) => {
    test.skip(!support.request, `GAP-01: Pairing:RequestTtl is not read by the API (a request lives ${support.observed.request} s)`);
    const publicApi = new PublicApi(stack.anonymousBase, stack.forwardedForWorks ? uniqueIp() : undefined);
    const knock = await publicApi.createPairingRequest({ name: 'Laptop Late', kind: 'laptop', platform: 'Windows · Edge' });
    production.pendingRequests.push({ requestId: knock.body.requestId, pollToken: knock.body.pollToken });
    const wait = new Date(knock.body.expiresAt).getTime() - Date.now() + 1500;
    await sleep(wait);
    const approve = await api.approvePairingRequest(production.id, knock.body.requestId);
    // The card may already be removed by the maintenance tick (404) or recognised as expired (410) - never a device.
    expect([404, 410], approve.raw.text()).toContain(approve.status);
    expect((await production.snapshot()).devices).toHaveLength(0);
    expect((await publicApi.getPairingRequestStatus(knock.body.requestId, knock.body.pollToken)).body.status).toBe('expired');
  });

  test('E2E-PAIR-07 [api] credentials are available inside the window and gone after it', t.shortTtl(), async ({ api, production, stack }) => {
    test.skip(!support.request, `GAP-01: the short profile is not read by the API (Pairing:RequestTtl observed ${support.observed.request} s); the credentials window 15 s cannot be told apart from 5 min without waiting 5 min`);
    const publicApi = new PublicApi(stack.anonymousBase, stack.forwardedForWorks ? uniqueIp() : undefined);
    const knock = await publicApi.createPairingRequest({ name: 'Laptop Offline', kind: 'laptop', platform: 'Windows · Edge' });
    production.pendingRequests.push({ requestId: knock.body.requestId, pollToken: knock.body.pollToken });
    const approved = await api.approvePairingRequest(production.id, knock.body.requestId);
    expect(approved.status).toBe(200);
    // The laptop was offline for 5 s: it still gets the credentials when it polls again.
    await sleep(5000);
    const inside = await publicApi.getPairingRequestStatus(knock.body.requestId, knock.body.pollToken);
    expect(inside.body.status).toBe('approved');
    expect(inside.body.credentials!.deviceId).toBe(approved.body.id);
    // Beyond the credentials window (15 s) the request is expired and the credentials are gone.
    await sleep(12_000);
    const late = await publicApi.getPairingRequestStatus(knock.body.requestId, knock.body.pollToken);
    expect(late.body).toEqual({ status: 'expired', credentials: null });
    // The device exists nevertheless; it is simply not reachable by this laptop any more.
    expect((await production.snapshot()).devices.map((device) => device.id)).toContain(approved.body.id);
  });

  test('E2E-PAIR-16 [api] the pending cap answers 429 and works again after a slot frees up', t.shortTtl(), async ({ production, stack }) => {
    test.skip(!support.pendingTotal, 'GAP-01: Pairing:Limits:PendingTotal is not read by the API (the cap stays 20)');
    const knocks = [];
    for (let index = 0; index < 3; index++) {
      const knock = await new PublicApi(stack.anonymousBase, stack.forwardedForWorks ? uniqueIp() : undefined).createPairingRequest({ name: `Cap ${index}`, kind: 'laptop', platform: 'x' });
      expect(knock.status, knock.raw.text()).toBe(201);
      production.pendingRequests.push({ requestId: knock.body.requestId, pollToken: knock.body.pollToken });
      knocks.push(knock.body);
    }
    const fourth = new PublicApi(stack.anonymousBase, stack.forwardedForWorks ? uniqueIp() : undefined);
    const refused = await fourth.createPairingRequest({ name: 'Cap 4', kind: 'laptop', platform: 'x' });
    expectProblem(refused, 429, ERROR.rateLimited);
    expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0);
    // A slot frees up (deny) and the next request passes.
    expect((await production.api.denyPairingRequest(production.id, knocks[0]!.requestId)).status).toBe(204);
    const next = await fourth.createPairingRequest({ name: 'Cap 5', kind: 'laptop', platform: 'x' });
    expect(next.status, next.raw.text()).toBe(201);
    production.pendingRequests.push({ requestId: next.body.requestId, pollToken: next.body.pollToken });
  });

  test('UNIT-PAIR-01 [stack, short-ttl] an unused invite expires, a used one replays only inside the idempotency window', t.shortTtl(), async ({ api, production, stack }) => {
    test.skip(!support.invite, `GAP-01: Pairing:InviteTtl is not read by the API (an invite lives ${support.observed.invite} s, expected about 20 s)`);
    const publicApi = new PublicApi(stack.anonymousBase, stack.forwardedForWorks ? uniqueIp() : undefined);
    // Unused link: expires.
    const link = (await api.createInvite(production.id, { kind: 'laptopLink' })).body;
    // Used link: the same client may repeat inside the window (10 s), not after it.
    const used = (await api.createInvite(production.id, { kind: 'laptopLink' })).body;
    const first = await publicApi.redeemInvite(inviteToken(used.url), { clientId: 'idem', kind: 'laptop', platform: 'x' });
    expect(first.status).toBe(200);
    await sleep(4000);
    const inside = await publicApi.redeemInvite(inviteToken(used.url), { clientId: 'idem', kind: 'laptop', platform: 'x' });
    expect(inside.status, 'inside the idempotency window').toBe(200);
    expect(inside.body.deviceId).toBe(first.body.deviceId);
    await sleep(Math.max(0, new Date(link.expiresAt).getTime() - Date.now()) + 1500);
    expectProblem(await publicApi.redeemInvite(inviteToken(link.url), { clientId: 'late', kind: 'laptop', platform: 'x' }), 410, ERROR.pairingExpired);
    expectProblem(await publicApi.redeemInvite(inviteToken(used.url), { clientId: 'idem', kind: 'laptop', platform: 'x' }), 410, ERROR.pairingExpired);
    // The phone QR is always renewed: a valid phone invite exists.
    const phone = (await api.getPhoneInvite(production.id)).body;
    expect(new Date(phone.expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect((await production.snapshot()).invites.filter((invite) => invite.kind === 'phoneQr')).toHaveLength(1);
  });
});
