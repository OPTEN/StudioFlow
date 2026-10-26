import { AdminApi } from '../../support/api';
import { CSRF_HEADER, ERROR, SESSION_COOKIE } from '../../support/constants';
import { expect, expectProblem, knownBug, skipUnsupported, test, uniqueIp } from '../../support/fixtures';
import { StudioHub } from '../../support/hubs';
import { send } from '../../support/http';
import { parseSetCookie } from '../../support/parse';
import { t } from '../../support/tags';

/**
 * AUTH - session, cookie, CSRF, logout (docs/testing.md 2.1). Failed logins count towards the lockout of the client IP
 * and of the user name, so every test that fails a login does it from its own fake client address on the direct API
 * port and with an unknown user name; the lockout itself is covered by auth-lockout.disruptive.spec.ts.
 */

test.describe('AUTH session', () => {
  test('E2E-AUTH-01 [api] login returns a secure, opaque session cookie', t.smoke, async ({ config, stack }) => {
    for (const base of [config.baseURL, stack.direct]) {
      const raw = await send({
        method: 'POST',
        url: `${base}/api/auth/login`,
        json: { username: config.admin.username, password: config.admin.password },
      });
      expect(raw.status, `login via ${base}`).toBe(200);
      expect(raw.json()).toEqual({ username: config.admin.username });
      expect(raw.setCookies, 'exactly one Set-Cookie').toHaveLength(1);
      const cookie = parseSetCookie(raw.setCookies[0]!);
      expect(cookie.name).toBe(SESSION_COOKIE);
      expect(cookie.attributes['httponly'], 'HttpOnly').toBe(true);
      expect(cookie.attributes['secure'], 'Secure').toBe(true);
      expect(String(cookie.attributes['samesite']).toLowerCase(), 'SameSite').toBe('strict');
      expect(cookie.attributes['path'], 'Path').toBe('/');
      expect(cookie.attributes['domain'], 'no Domain attribute').toBeUndefined();
      expect(cookie.value.length, 'cookie value is a long opaque ticket').toBeGreaterThan(60);
      expect(cookie.value.toLowerCase()).not.toContain(config.admin.username.toLowerCase());
      expect(cookie.value).not.toContain(config.admin.password);
    }
  });

  test('E2E-AUTH-01 [api, no-store] the login response must not be cached', t.p1, async ({ config }) => {
    // INT-AUTH-01 / INT-AUTH-21: credentials-bearing responses send Cache-Control: no-store.
    const raw = await send({ method: 'POST', url: `${config.baseURL}/api/auth/login`, json: { username: config.admin.username, password: config.admin.password } });
    expect(raw.status).toBe(200);
    expect(raw.headers['cache-control'] ?? '').toContain('no-store');
  });

  test('E2E-AUTH-02 [api] wrong password and unknown user are indistinguishable', t.p1, async ({ config, stack }) => {
    skipUnsupported(!stack.forwardedForWorks, 'direct API port does not honour X-Forwarded-For; failing logins would lock the shared IP');
    const base = stack.direct;
    const ip = uniqueIp();
    const wrongPassword = await send({ method: 'POST', url: `${base}/api/auth/login`, headers: { 'X-Forwarded-For': ip }, json: { username: config.admin.username, password: 'definitely-wrong-1' } });
    const unknownUser = await send({ method: 'POST', url: `${base}/api/auth/login`, headers: { 'X-Forwarded-For': ip }, json: { username: `nobody-${Date.now()}`, password: 'definitely-wrong-1' } });
    expect(wrongPassword.status).toBe(401);
    expect(unknownUser.status).toBe(401);
    expect(wrongPassword.setCookies).toHaveLength(0);
    expect(unknownUser.setCookies).toHaveLength(0);
    const strip = (value: Record<string, unknown>) => {
      const { traceId: _ignored, ...rest } = value;
      return rest;
    };
    expect(strip(unknownUser.json())).toEqual(strip(wrongPassword.json()));
    expect(wrongPassword.json()).toMatchObject({ code: ERROR.unauthorized });
    // The wording does not say which field is wrong.
    expect(wrongPassword.json().detail).toBe(unknownUser.json().detail);
  });

  test('E2E-AUTH-02 [api] malformed login input yields validation errors, never a 500', t.p1, async ({ stack }) => {
    skipUnsupported(!stack.forwardedForWorks, 'needs the direct API port with X-Forwarded-For');
    const url = `${stack.direct}/api/auth/login`;
    const headers = { 'X-Forwarded-For': uniqueIp() };
    const cases: Array<{ name: string; options: Parameters<typeof send>[0]; accept: number[] }> = [
      { name: 'empty body', options: { method: 'POST', url, headers: { ...headers, 'Content-Type': 'application/json' }, body: '' }, accept: [400] },
      { name: 'malformed JSON', options: { method: 'POST', url, headers: { ...headers, 'Content-Type': 'application/json' }, body: '{"username":' }, accept: [400] },
      { name: 'text/plain', options: { method: 'POST', url, headers: { ...headers, 'Content-Type': 'text/plain' }, body: 'username=a&password=b' }, accept: [415] },
      { name: 'missing fields', options: { method: 'POST', url, headers, json: {} }, accept: [400, 401] },
      { name: 'null fields', options: { method: 'POST', url, headers, json: { username: null, password: null } }, accept: [400, 401] },
      { name: '10 kB user name', options: { method: 'POST', url, headers, json: { username: 'u'.repeat(10_000), password: 'x' } }, accept: [400, 401] },
    ];
    for (const entry of cases) {
      const response = await send(entry.options);
      expect(entry.accept, `${entry.name}: got ${response.status} ${response.text().slice(0, 200)}`).toContain(response.status);
      expect(response.status, entry.name).toBeLessThan(500);
      expect(response.setCookies, entry.name).toHaveLength(0);
    }
  });

  test('E2E-AUTH-04 [api] logout clears the cookie and needs the CSRF header', t.p1, async ({ config }) => {
    const session = await AdminApi.login(config.baseURL, config.admin);
    expect((await session.getSession()).status).toBe(200);
    expect((await session.getSession()).body.username).toBe(config.admin.username);

    const withoutHeader = await session.call('POST', '/api/auth/logout', { noCsrf: true });
    expectProblem(withoutHeader, 403, ERROR.forbidden);
    expect((await session.getSession()).status, 'session survives a rejected logout').toBe(200);

    const logout = await session.logout();
    expect(logout.status).toBe(204);
    const cleared = logout.raw.setCookies.map(parseSetCookie).find((cookie) => cookie.name === SESSION_COOKIE);
    expect(cleared, 'logout expires the cookie').toBeDefined();
    expect(cleared!.value).toBe('');
    expect(new Date(String(cleared!.attributes['expires'])).getTime()).toBeLessThan(Date.now());
  });

  test('E2E-AUTH-04 [api, server-side revocation] the cookie is dead after logout (GAP-04b)', t.p1, async ({ config }) => {
    knownBug('BUG-01', 'logout only clears the browser cookie; the ticket stays valid (GAP-04b pins server-side invalidation)');
    const session = await AdminApi.login(config.baseURL, config.admin);
    const stolen = session.cookie;
    expect((await session.logout()).status).toBe(204);
    const replay = new AdminApi(config.baseURL, stolen);
    // A stateless ticket stays valid until it expires; the pinned behaviour is server-side invalidation.
    expectProblem(await replay.getSession(), 401, ERROR.unauthorized);
  });

  test('E2E-AUTH-04 [api, hub] logout closes the studio hub of that session (GAP-04b)', t.p1, async ({ config, production, onCleanup }) => {
    knownBug('BUG-01', 'logout does not close the hub connections of the revoked session (GAP-04b)');
    const session = await AdminApi.login(config.baseURL, config.admin);
    const hub = StudioHub.connect(config.baseURL, session.cookie, { reconnect: false });
    onCleanup(() => hub.stop());
    await hub.open(production.id);
    expect(hub.isConnected).toBe(true);
    expect((await session.logout()).status).toBe(204);
    await hub.waitClosed(10_000);
  });

  test('E2E-AUTH-07 CSRF header is forwarded by Caddy and enforced by the API', t.smoke, async ({ api, production }) => {
    const before = (await api.getSnapshot(production.id)).body.revision;
    const without = await api.call('POST', `/api/productions/${production.id}/take`, { json: { transition: { kind: 'cut', durationMs: 0 } }, noCsrf: true });
    expectProblem(without, 403, ERROR.forbidden);
    const withHeader = await api.take(production.id);
    // Proves the custom header reaches the API through Caddy: past the CSRF filter the take fails on state (no preview).
    expectProblem(withHeader, 409, ERROR.conflict);
    expect((await api.getSnapshot(production.id)).body.revision, 'no side effect').toBe(before);
  });

  test('INT-AUTH-08 [stack] CSRF header matrix on unsafe routes', t.p0, async ({ api, production }) => {
    const route = `/api/productions/${production.id}/take`;
    const body = { transition: { kind: 'cut', durationMs: 0 } };
    const revision = (await api.getSnapshot(production.id)).body.revision;
    const rejected: Array<Record<string, string>> = [{}, { [CSRF_HEADER]: '0' }, { [CSRF_HEADER]: 'true' }, { [CSRF_HEADER]: '' }, { [CSRF_HEADER]: 'yes' }, { [CSRF_HEADER]: '11' }];
    for (const headers of rejected) {
      const result = await api.call('POST', route, { json: body, noCsrf: true, headers });
      expectProblem(result, 403, ERROR.forbidden);
    }
    // Accepted: value 1 (case-insensitive header name); the handler then answers 409 (no preview).
    for (const headers of [{ [CSRF_HEADER]: '1' }, { 'x-studioflow': '1' }]) {
      expectProblem(await api.call('POST', route, { json: body, noCsrf: true, headers }), 409, ERROR.conflict);
    }
    // All unsafe verbs are covered by the same filter.
    for (const [method, path] of [
      ['PUT', `/api/productions/${production.id}/preview`],
      ['PATCH', `/api/productions/${production.id}`],
      ['DELETE', `/api/productions/${production.id}/scenes/scn_doesnotexist`],
      ['POST', `/api/productions/${production.id}/pairing/phone-invite/renew`],
      ['POST', `/api/productions/${production.id}/output/links/olk_doesnotexist/regenerate-key`],
    ] as const) {
      expectProblem(await api.call(method, path, { json: {}, noCsrf: true }), 403, ERROR.forbidden);
    }
    // GET never needs the header.
    expect((await api.call('GET', `/api/productions/${production.id}/snapshot`, { noCsrf: true })).status).toBe(200);
    // Nothing above changed the production.
    expect((await api.getSnapshot(production.id)).body.revision).toBe(revision);
  });

  test('INT-AUTH-08 [stack] the CSRF exemptions: login, device bearer, output key, anonymous pairing, upload still needs it', t.p0, async ({ config, api, production, stack }) => {
    const login = await send({ method: 'POST', url: `${config.baseURL}/api/auth/login`, json: { username: config.admin.username, password: config.admin.password } });
    expect(login.status, 'login needs no CSRF header').toBe(200);
    const knock = await send({ method: 'POST', url: `${stack.anonymousBase}/api/pairing/requests`, headers: stack.forwardedForWorks ? { 'X-Forwarded-For': uniqueIp() } : {}, json: { name: 'Csrf Test', kind: 'laptop', platform: 'Windows · Edge' } });
    expect(knock.status, 'anonymous pairing needs no CSRF header').toBe(201);
    production.pendingRequests.push({ requestId: knock.json().requestId, pollToken: knock.json().pollToken });
    // Upload: DisableAntiforgery is not a CSRF waiver for the cookie.
    const upload = await api.uploadAsset(production.id, { fileName: 'tiny.png', contentType: 'image/png', data: Buffer.from('x') }, { noCsrf: true });
    expectProblem(upload, 403, ERROR.forbidden);
  });
});
