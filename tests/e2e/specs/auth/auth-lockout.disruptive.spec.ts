import { AdminApi, PublicApi } from '../../support/api';
import { ERROR, LIMITS } from '../../support/constants';
import { dockerCtl } from '../../support/docker-ctl';
import { expect, expectProblem, skipUnsupported, test, uniqueIp } from '../../support/fixtures';
import { send } from '../../support/http';
import { compose, ensureHealthy } from '../../support/stack';
import { t } from '../../support/tags';

/**
 * AUTH - lockout and rate limits (E2E-AUTH-03, -18; INT-AUTH-03, -04, -05; INT-PAIR-08 pending cap).
 * These change process-wide counters, so they run in the disruptive project and end with `restart api`
 * (the counters live in memory, [GAP-03]). Each test uses its own fake client address on the direct API port, so
 * the shared address of the host (seen by Caddy) is never locked.
 */

test.describe.configure({ mode: 'serial' });

test.afterEach(async () => {
  test.setTimeout(240_000);
  await dockerCtl.restart('api');
  await ensureHealthy();
});

test.describe('AUTH lockout', () => {
  test('E2E-AUTH-03 [api] the fifth failed login locks the client address for 15 minutes; a restart clears the counters', t.disruptive('@p1'), async ({ config, stack }) => {
    skipUnsupported(!stack.forwardedForWorks, 'needs the direct API port with X-Forwarded-For');
    const attacker = uniqueIp();
    const bystander = uniqueIp();
    const login = (password: string, ip: string, user = config.admin.username) =>
      send({ method: 'POST', url: `${stack.direct}/api/auth/login`, headers: { 'X-Forwarded-For': ip }, json: { username: user, password } });

    for (let attempt = 1; attempt <= 4; attempt++) expect((await login('wrong-password', attacker)).status, `failure ${attempt}`).toBe(401);
    const fifth = await login('wrong-password', attacker);
    expect(fifth.status, 'the fifth failure itself starts the lock').toBe(429);
    expect(fifth.json().code).toBe(ERROR.rateLimited);
    const retryAfter = Number(fifth.headers['retry-after']);
    expect(retryAfter, 'Retry-After in seconds').toBeGreaterThanOrEqual(LIMITS.loginLockoutSeconds - 2);
    expect(retryAfter).toBeLessThanOrEqual(LIMITS.loginLockoutSeconds);
    expect(fifth.json().detail, 'English message with the remaining minutes').toMatch(/\d+ minutes?/);

    // Even the right password is refused during the lock, and no cookie is issued.
    const correct = await login(config.admin.password, attacker);
    expect(correct.status).toBe(429);
    expect(correct.setCookies).toHaveLength(0);
    // Another address is unaffected.
    expect((await login(config.admin.password, bystander)).status).toBe(200);

    // Counters live in memory: after a restart the address may log in again.
    await dockerCtl.restart('api');
    await ensureHealthy();
    expect((await login(config.admin.password, attacker)).status).toBe(200);
  });

  test('INT-AUTH-04 [stack] 20 failures for one user name from 20 addresses lock the user name for everyone', t.disruptive('@p1'), async ({ config, stack }) => {
    skipUnsupported(!stack.forwardedForWorks, 'needs the direct API port with X-Forwarded-For');
    const login = (password: string, ip: string) => send({ method: 'POST', url: `${stack.direct}/api/auth/login`, headers: { 'X-Forwarded-For': ip }, json: { username: config.admin.username, password } });
    for (let index = 0; index < LIMITS.loginFailuresPerUser - 1; index++) expect((await login('nope', uniqueIp())).status, `failure ${index + 1}`).toBe(401);
    const twentieth = await login('nope', uniqueIp());
    expect(twentieth.status, 'the 20th failure locks the user name').toBe(429);
    // The correct password from a brand new address is refused too.
    const refused = await login(config.admin.password, uniqueIp());
    expectProblem({ status: refused.status, body: refused.json(), headers: refused.headers, raw: refused }, 429, ERROR.rateLimited);
    // The sessions that exist keep working (the cookie is not affected by the lock).
    const session = await AdminApi.login(config.baseURL, config.admin).catch(() => undefined);
    expect(session, 'a new login through Caddy is refused as well').toBeUndefined();
  });

  test('INT-AUTH-05 [stack] login attempts are written to the audit log without passwords', t.disruptive('@p1'), async ({ config, stack }) => {
    skipUnsupported(!stack.forwardedForWorks, 'needs the direct API port with X-Forwarded-For');
    const ip = uniqueIp();
    const secret = 'Audit-Probe-Passw0rd-xyz';
    const login = (password: string) => send({ method: 'POST', url: `${stack.direct}/api/auth/login`, headers: { 'X-Forwarded-For': ip }, json: { username: config.admin.username, password } });
    expect((await login(config.admin.password)).status).toBe(200);
    for (let index = 0; index < 5; index++) await login(secret);
    const rows = await compose(['exec', '-T', 'postgres', 'psql', '-U', 'studioflow', '-d', 'studioflow', '-Atc', `select action || '|' || actor || '|' || details::text from audit_entries where action like 'login.%' and details::text like '%${ip}%' order by id`]);
    expect(rows.code, rows.stderr).toBe(0);
    const lines = rows.stdout.trim().split(/\r?\n/);
    const actions = lines.map((line) => line.split('|')[0]);
    expect(actions).toEqual(expect.arrayContaining(['login.succeeded', 'login.failed', 'login.locked']));
    for (const line of lines) {
      expect(line, 'audit rows never contain a password').not.toContain(secret);
      expect(line).not.toContain(config.admin.password);
      expect(line).not.toMatch(/AQAAAA/);
      expect(line, 'details carry the address and the user name').toContain(config.admin.username);
    }
    expect(lines.filter((line) => line.startsWith('login.failed')).length).toBeGreaterThanOrEqual(4);
  });
});

test.describe('AUTH rate limits', () => {
  test('E2E-AUTH-18 [api] 10 knocks and 20 redeem attempts per address and 10 minutes; the next one is 429 with Retry-After', t.disruptive('@p1'), async ({ stack, production }) => {
    skipUnsupported(!stack.forwardedForWorks, 'needs the direct API port with X-Forwarded-For');
    const ip = uniqueIp();
    const publicApi = new PublicApi(stack.direct, ip);
    for (let index = 1; index <= LIMITS.pairingRequestsPerIpPer10Min; index++) {
      const response = await publicApi.createPairingRequest({ name: `Flood ${index}`, kind: 'laptop', platform: 'x' });
      expect(response.status, `request ${index}: ${response.raw.text().slice(0, 200)}`).toBe(201);
      production.pendingRequests.push({ requestId: response.body.requestId, pollToken: response.body.pollToken });
    }
    const eleventh = await publicApi.createPairingRequest({ name: 'Flood 11', kind: 'laptop', platform: 'x' });
    expectProblem(eleventh, 429, ERROR.rateLimited);
    expect(Number(eleventh.headers['retry-after']), 'Retry-After').toBeGreaterThan(0);
    // The limit is per address: another address is not affected.
    const other = await new PublicApi(stack.direct, uniqueIp()).createPairingRequest({ name: 'Other', kind: 'laptop', platform: 'x' });
    expect(other.status).toBe(201);
    production.pendingRequests.push({ requestId: other.body.requestId, pollToken: other.body.pollToken });

    // Redeem attempts count when they fail, too.
    const redeemIp = uniqueIp();
    const redeemApi = new PublicApi(stack.direct, redeemIp);
    for (let index = 1; index <= LIMITS.pairingRedeemPerIpPer10Min; index++) {
      const response = await redeemApi.redeemInvite(`${'r'.repeat(40)}${index}`, { clientId: 'c', kind: 'phone', platform: 'x' });
      expect(response.status, `redeem ${index}`).toBe(410);
    }
    const twentyFirst = await redeemApi.redeemInvite('s'.repeat(43), { clientId: 'c', kind: 'phone', platform: 'x' });
    expectProblem(twentyFirst, 429, ERROR.rateLimited);
    expect(Number(twentyFirst.headers['retry-after'])).toBeGreaterThan(0);
  });

  test('INT-PAIR-08 [stack, pending cap] the 21st pending request is refused with 429 even from a fresh address', t.disruptive('@p1'), async ({ stack, production }) => {
    skipUnsupported(!stack.forwardedForWorks, 'needs the direct API port with X-Forwarded-For');
    // 20 pending requests from 3 addresses (8 + 8 + 4, all below the per-address limit of 10).
    const addresses = [uniqueIp(), uniqueIp(), uniqueIp()];
    for (let index = 0; index < LIMITS.pairingPendingTotal; index++) {
      const response = await new PublicApi(stack.direct, addresses[index % 3]).createPairingRequest({ name: `Pending ${index}`, kind: 'laptop', platform: 'x' });
      expect(response.status, `pending ${index + 1}: ${response.raw.text().slice(0, 160)}`).toBe(201);
      production.pendingRequests.push({ requestId: response.body.requestId, pollToken: response.body.pollToken });
    }
    const refused = await new PublicApi(stack.direct, uniqueIp()).createPairingRequest({ name: 'Pending 21', kind: 'laptop', platform: 'x' });
    expectProblem(refused, 429, ERROR.rateLimited);
    // A slot frees up when a request leaves the pending state.
    expect((await production.api.denyPairingRequest(production.id, production.pendingRequests[0]!.requestId)).status).toBe(204);
    const accepted = await new PublicApi(stack.direct, uniqueIp()).createPairingRequest({ name: 'Pending 21', kind: 'laptop', platform: 'x' });
    expect(accepted.status, accepted.raw.text()).toBe(201);
    production.pendingRequests.push({ requestId: accepted.body.requestId, pollToken: accepted.body.pollToken });
  });
});
