import fs from 'node:fs';
import path from 'node:path';
import { DeviceApi, HttpApi, OutputApi, PublicApi, parseOutputUrl } from '../../support/api';
import { ERROR } from '../../support/constants';
import { REPO_ROOT, stackConfig } from '../../support/env';
import { expect, expectProblem, knownBug, skipUnsupported, test, uniqueIp } from '../../support/fixtures';
import { multipart, rawRequest, send } from '../../support/http';
import { negotiate } from '../../support/hubs';
import { pairPhone } from '../../support/production';
import { t } from '../../support/tags';

/**
 * AUTH - who may call what (route policy matrix of docs/testing.md 2.1, [GAP-04]). Everything runs against the real
 * stack: through Caddy unless a test needs the direct API port.
 */

interface Operation {
  method: string;
  path: string;
  operationId: string;
}

function operations(): Operation[] {
  const document = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'apps/api/openapi/studioflow.json'), 'utf8')) as {
    paths: Record<string, Record<string, { operationId: string }>>;
  };
  const result: Operation[] = [];
  for (const [route, verbs] of Object.entries(document.paths)) {
    for (const [method, operation] of Object.entries(verbs)) result.push({ method: method.toUpperCase(), path: route, operationId: operation.operationId });
  }
  return result;
}

type Policy = 'anonymous' | 'admin' | 'device' | 'output' | 'webhook' | 'asset-content';

/** The pinned route policy matrix: operation id -> policy. A route missing here fails the test. */
const POLICY: Record<string, Policy> = {
  login: 'anonymous',
  createPairingRequest: 'anonymous',
  getPairingRequestStatus: 'anonymous',
  cancelPairingRequest: 'anonymous',
  redeemInvite: 'anonymous',
  receiveLiveKitWebhook: 'webhook',
  getAssetContent: 'asset-content',
  getDeviceSelf: 'device',
  getDeviceSession: 'device',
  getDeviceLiveKitToken: 'device',
  allocateSlot: 'device',
  releaseSlot: 'device',
  reportDeviceStatus: 'device',
  bandwidthTest: 'device',
  unpairDevice: 'device',
  getOutputSnapshot: 'output',
  getOutputChanges: 'output',
  getOutputLiveKitToken: 'output',
  reportOutputStatus: 'output',
};

function policyOf(operation: Operation): Policy {
  return POLICY[operation.operationId] ?? 'admin';
}

const CRLF = String.fromCharCode(13, 10);

test.describe('AUTH routes', () => {
  test('INT-AUTH-09 [stack] every operation of the API surface is classified by the policy matrix', t.p0, async () => {
    const all = operations();
    expect(all.length, 'operations in openapi/studioflow.json').toBeGreaterThan(50);
    for (const operation of all) {
      if (policyOf(operation) === 'admin') {
        // The admin group is everything under /api/productions plus the three session routes.
        expect(operation.path, `${operation.operationId} would be classified as admin`).toMatch(/^\/api\/(productions|auth\/(logout|me)|system\/info)/);
      }
    }
    for (const id of Object.keys(POLICY)) expect(all.map((operation) => operation.operationId), `policy entry ${id} exists`).toContain(id);
  });

  test('E2E-AUTH-06 unauthenticated access to every protected route of the API surface', t.smoke, async ({ config, production, stack }) => {
    const base = config.baseURL;
    const failures: string[] = [];
    const substitutions: Record<string, string> = {
      '{productionId}': production.id,
      '{sceneId}': 'scn_aaaaaaaaaaaaaaaa',
      '{itemId}': 'itm_aaaaaaaaaaaaaaaa',
      '{deviceId}': 'dev_aaaaaaaaaaaaaaaa',
      '{inviteId}': 'inv_aaaaaaaaaaaaaaaa',
      '{requestId}': 'prq_aaaaaaaaaaaaaaaa',
      '{assetId}': 'ast_aaaaaaaaaaaaaaaa',
      '{incidentId}': 'inc_aaaaaaaaaaaaaaaa',
      '{slug}': production.slug,
      '{slot}': 'camera',
      '{token}': 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    };
    for (const operation of operations()) {
      let route = operation.path;
      for (const [placeholder, value] of Object.entries(substitutions)) route = route.replaceAll(placeholder, value);
      const policy = policyOf(operation);
      const hasBody = ['POST', 'PUT', 'PATCH'].includes(operation.method);
      // The declared body type matters: a wrong one is refused with 415 before authentication is looked at.
      const isUpload = operation.operationId === 'uploadAsset';
      const isBandwidth = operation.operationId === 'bandwidthTest';
      // An anonymous client: no cookie, no bearer, no key. Public pairing routes get their own client IP.
      const headers: Record<string, string> = policy === 'anonymous' && stack.forwardedForWorks ? { 'X-Forwarded-For': uniqueIp() } : {};
      const form = isUpload ? multipart([{ name: 'file', fileName: 'a.png', contentType: 'image/png', data: Buffer.from('x') }]) : undefined;
      const response = await send({
        method: operation.method,
        url: `${policy === 'anonymous' && stack.forwardedForWorks ? stack.direct : base}${route}${operation.operationId === 'getChanges' || operation.operationId === 'getOutputChanges' ? '?since=1' : ''}`,
        headers: { ...headers, ...(form ? { 'Content-Type': form.contentType } : {}), ...(isBandwidth ? { 'Content-Type': 'application/octet-stream' } : {}) },
        ...(form ? { body: form.body } : isBandwidth ? { body: Buffer.from('x') } : { json: hasBody ? {} : undefined }),
      });
      const label = `${operation.method} ${operation.path} (${operation.operationId}) -> ${response.status}`;
      const body = response.text();
      if (response.status >= 500) failures.push(`${label}: server error`);
      if (/\bat [A-Z][\w.]+\(|\.cs:line|Npgsql/.test(body)) failures.push(`${label}: stack trace in body`);
      switch (policy) {
        case 'admin':
          if (response.status !== 401) failures.push(`${label}: expected 401`);
          break;
        case 'device':
          if (response.status !== 401) failures.push(`${label}: expected 401`);
          break;
        case 'output':
          if (response.status !== 403) failures.push(`${label}: expected 403`);
          break;
        case 'webhook':
          if (response.status !== 401) failures.push(`${label}: expected 401 (Caddy answers 404 for /api/livekit from outside)`);
          break;
        case 'asset-content':
          if (response.status !== 401) failures.push(`${label}: expected 401`);
          break;
        case 'anonymous':
          if (operation.operationId !== 'login' && (response.status === 401 || response.status === 403)) failures.push(`${label}: public route must not demand credentials`);
          break;
      }
      // No route answers 200 with data to an anonymous caller, except the public ones.
      if (policy !== 'anonymous' && response.status === 200 && body.length > 0) failures.push(`${label}: answered 200 with data`);
      if (policy === 'anonymous' && operation.operationId === 'createPairingRequest' && response.status === 201) {
        const created = response.json();
        production.pendingRequests.push({ requestId: created.requestId, pollToken: created.pollToken });
      }
    }
    // The webhook is not reachable from outside at all (Caddy answers 404), see E2E-LK-04.
    expect(failures.filter((failure) => !failure.includes('receiveLiveKitWebhook')), failures.join('\n')).toEqual([]);
  });

  test('E2E-AUTH-06 [system info] GET /api/system/info needs the admin cookie (GAP-04a)', t.p1, async ({ config }) => {
    knownBug('BUG-02', 'GET /api/system/info is anonymous (200) although the pinned route policy makes it an Admin route');
    expectProblem(await new HttpApi(config.baseURL).call('GET', '/api/system/info'), 401, ERROR.unauthorized);
  });

  test('E2E-AUTH-06 [logout] anonymous POST /api/auth/logout is answered 401 (GAP-04a)', t.p2, async ({ config }) => {
    knownBug('BUG-02', 'POST /api/auth/logout without a session answers 204 instead of 401 (route policy matrix)');
    const response = await send({ method: 'POST', url: `${config.baseURL}/api/auth/logout` });
    expect(response.status).toBe(401);
  });

  test('INT-AUTH-10 [stack] credentials of one role do not work for another', t.p0, async ({ config, api, production, pairContext }) => {
    const phone = await pairPhone(pairContext, { name: 'Cross Test' });
    const device = phone.api;
    const output = new OutputApi(config.baseURL, production.slug, production.outputKey);
    const snapshotRoute = `/api/productions/${production.id}/snapshot`;

    // Device bearer and output key on admin routes and on the studio hub.
    for (const headers of [{ Authorization: `Bearer ${phone.bearer}` }, { 'X-Output-Key': production.outputKey }, { Authorization: `Bearer ${production.outputKey}` }]) {
      const response = await send({ method: 'GET', url: `${config.baseURL}${snapshotRoute}`, headers });
      expect(response.status, JSON.stringify(headers).slice(0, 40)).toBe(401);
    }
    expect((await send({ method: 'GET', url: `${config.baseURL}${snapshotRoute}?k=${production.outputKey}&access_token=${phone.bearer}` })).status, 'query credentials').toBe(401);
    expect((await negotiate(config.baseURL, 'studio', { bearer: phone.bearer })).status, 'device bearer on /hubs/studio').toBe(401);
    expect((await negotiate(config.baseURL, 'studio', { accessTokenQuery: phone.bearer })).status, 'device token in the query on /hubs/studio').toBe(401);

    // The admin cookie on device routes and the device hub.
    expectProblem(await send({ method: 'GET', url: `${config.baseURL}/api/device/me`, headers: { Cookie: api.cookie } }).then(wrapRaw), 401, ERROR.unauthorized);
    expect((await negotiate(config.baseURL, 'device', { cookie: api.cookie })).status, 'admin cookie on /hubs/device').toBe(401);

    // Output key on device routes; device bearer on output routes.
    expect((await send({ method: 'GET', url: `${config.baseURL}/api/device/me`, headers: { 'X-Output-Key': production.outputKey, Authorization: `Bearer ${production.outputKey}` } })).status).toBe(401);
    const asDevice = new OutputApi(config.baseURL, production.slug, undefined);
    const bearerOnOutput = await send({ method: 'GET', url: `${config.baseURL}/api/output/${production.slug}/snapshot`, headers: { Authorization: `Bearer ${phone.bearer}`, 'X-Output-Key': phone.bearer } });
    expect(bearerOnOutput.status).toBe(403);
    expect(asDevice.slug).toBe(production.slug);
    expect((await output.getOutputSnapshot()).status, 'the right key still works').toBe(200);

    // Production scoping: the device of production A on a route addressed to production B.
    const other = await api.createProduction({ name: `e2e other ${Date.now()}` });
    expect(other.status).toBe(201);
    expectProblem(await api.blockDevice(other.body.id, phone.id), 404, ERROR.notFound);
    expectProblem(await api.renameDevice(other.body.id, phone.id, 'Hijack'), 404, ERROR.notFound);
    expect((await api.getSnapshot(other.body.id)).body.devices, 'no cross-production data').toHaveLength(0);
    expect((await device.getDeviceSelf()).body.productionId).toBe(production.id);
  });

  test('INT-AUTH-11 [stack] device bearer variants', t.p0, async ({ config, pairContext }) => {
    const phone = await pairPhone(pairContext, { name: 'Bearer Test' });
    const other = await pairPhone(pairContext, { name: 'Bearer Other' });
    const { deviceId, deviceSecret } = phone.credentials;
    const url = `${config.baseURL}/api/device/me`;
    const variants: Array<{ name: string; headers: Record<string, string | string[]>; url?: string; expect: number[] }> = [
      { name: 'right credentials', headers: { Authorization: `Bearer ${deviceId}.${deviceSecret}` }, expect: [200] },
      { name: 'wrong secret', headers: { Authorization: `Bearer ${deviceId}.${deviceSecret.split('').reverse().join('')}` }, expect: [401] },
      { name: 'secret truncated by one character', headers: { Authorization: `Bearer ${deviceId}.${deviceSecret.slice(0, -1)}` }, expect: [401] },
      { name: 'secret of another device', headers: { Authorization: `Bearer ${deviceId}.${other.credentials.deviceSecret}` }, expect: [401] },
      { name: 'id of another device, own secret', headers: { Authorization: `Bearer ${other.credentials.deviceId}.${deviceSecret}` }, expect: [401] },
      { name: 'unknown id', headers: { Authorization: `Bearer dev_zzzzzzzzzzzzzzzz.${deviceSecret}` }, expect: [401] },
      { name: 'missing dot', headers: { Authorization: `Bearer ${deviceId}${deviceSecret}` }, expect: [401] },
      { name: 'empty secret', headers: { Authorization: `Bearer ${deviceId}.` }, expect: [401] },
      { name: 'Basic scheme', headers: { Authorization: `Basic ${Buffer.from(`${deviceId}:${deviceSecret}`).toString('base64')}` }, expect: [401] },
      { name: 'token in ?access_token= on a REST route', headers: {}, url: `${url}?access_token=${deviceId}.${deviceSecret}`, expect: [401] },
      { name: 'two Authorization headers', headers: { Authorization: [`Bearer ${deviceId}.${deviceSecret}`, `Bearer ${deviceId}.${deviceSecret}`] }, expect: [401] },
      { name: 'oversize token', headers: { Authorization: `Bearer ${deviceId}.${'a'.repeat(5000)}` }, expect: [401, 400, 431] },
      // RFC 7235: the scheme is case-insensitive, so the lower-case form is legitimately accepted.
      { name: 'lower-case scheme (RFC 7235: accepted)', headers: { Authorization: `bearer ${deviceId}.${deviceSecret}` }, expect: [200, 401] },
    ];
    const bodies = new Set<string>();
    for (const variant of variants) {
      const response = await send({ method: 'GET', url: variant.url ?? url, headers: variant.headers });
      expect(variant.expect, `${variant.name}: got ${response.status}`).toContain(response.status);
      if (response.status === 401 && variant.name !== 'oversize token') {
        const body = response.json();
        delete body.traceId;
        bodies.add(JSON.stringify(body));
      }
    }
    expect([...bodies], 'every 401 has the same body (no oracle for ids or secrets)').toHaveLength(1);
  });

  test('INT-AUTH-12 [stack] a blocked device is refused everywhere with device_blocked and works again after unblock', t.p0, async ({ config, api, production, pairContext }) => {
    const phone = await pairPhone(pairContext, { name: 'Block Test' });
    expect((await phone.api.getDeviceSelf()).status).toBe(200);
    expect((await api.blockDevice(production.id, phone.id)).status).toBe(200);

    const calls = [
      await phone.api.getDeviceSelf(),
      await phone.api.getDeviceLiveKitToken(),
      await phone.api.reportDeviceStatus({ rtc: 'connected', slots: [] }),
      await phone.api.getDeviceSession(),
    ];
    for (const call of calls) expectProblem(call, 403, ERROR.deviceBlocked);
    const hub = await negotiate(config.baseURL, 'device', { accessTokenQuery: phone.bearer });
    expect(hub.status, 'hub negotiate of a blocked device').toBe(403);

    expect((await api.unblockDevice(production.id, phone.id)).status).toBe(200);
    expect((await phone.api.getDeviceSelf()).status).toBe(200);
    expect((await phone.api.getDeviceLiveKitToken()).status).toBe(200);
    expect((await negotiate(config.baseURL, 'device', { accessTokenQuery: phone.bearer })).status).toBe(200);
  });

  test('INT-AUTH-14 [stack] hub negotiate authentication matrix', t.p0, async ({ config, api, production, pairContext }) => {
    const phone = await pairPhone(pairContext, { name: 'Hub Auth' });
    const base = config.baseURL;
    // studio: admin cookie
    expect((await negotiate(base, 'studio')).status).toBe(401);
    expect((await negotiate(base, 'studio', { cookie: 'sf_session=garbage' })).status).toBe(401);
    expect((await negotiate(base, 'studio', { accessTokenQuery: phone.bearer })).status).toBe(401);
    expect((await negotiate(base, 'studio', { cookie: api.cookie })).status).toBe(200);
    // device: bearer in access_token
    expect((await negotiate(base, 'device')).status).toBe(401);
    expect((await negotiate(base, 'device', { accessTokenQuery: `${phone.credentials.deviceId}.wrong` })).status).toBe(401);
    expect((await negotiate(base, 'device', { accessTokenQuery: production.outputKey })).status).toBe(401);
    expect((await negotiate(base, 'device', { accessTokenQuery: phone.bearer })).status).toBe(200);
    // output: key in access_token
    expect((await negotiate(base, 'output')).status).toBe(403);
    expect((await negotiate(base, 'output', { accessTokenQuery: 'wrong-key' })).status).toBe(403);
    expect((await negotiate(base, 'output', { accessTokenQuery: phone.bearer })).status).toBe(403);
    expect((await negotiate(base, 'output', { cookie: api.cookie })).status).toBe(403);
    expect((await negotiate(base, 'output', { accessTokenQuery: production.outputKey })).status).toBe(200);
  });

  test('INT-AUTH-15 [stack] output key checks answer a byte-identical 403 (GAP-06)', t.p0, async ({ config, api, production }) => {
    const other = await api.createProduction({ name: `e2e foreign ${Date.now()}` });
    const foreignKey = parseOutputUrl((await api.getOutputSettings(other.body.id)).body.url).key;
    const ok = await production.output().getOutputSnapshot();
    expect(ok.status).toBe(200);
    expect(ok.body.production.id).toBe(production.id);
    expect(JSON.stringify(ok.body)).not.toMatch(/"devices"|"incidents"|"pairingRequests"|"invites"/);

    const strip = (text: string) => text.replace(/"traceId":"[^"]*",?/, '');
    const denied = [
      { name: 'wrong key', result: await new OutputApi(config.baseURL, production.slug, 'wrong-key-wrong-key-wrong-key-wrong-key-1').getOutputSnapshot() },
      { name: 'key of another production', result: await new OutputApi(config.baseURL, production.slug, foreignKey).getOutputSnapshot() },
      { name: 'unknown slug', result: await new OutputApi(config.baseURL, 'no-such-slug-xyz', production.outputKey).getOutputSnapshot() },
      { name: 'slug of another production', result: await new OutputApi(config.baseURL, other.body.slug, production.outputKey).getOutputSnapshot() },
      { name: 'invalid slug characters', result: await new OutputApi(config.baseURL, 'UPPER_case!', production.outputKey).getOutputSnapshot() },
    ];
    const reference = denied.find((entry) => entry.name === 'wrong key')!.result;
    expectProblem(reference, 403, ERROR.forbidden);
    for (const entry of denied) {
      expect(entry.result.status, `${entry.name}: ${entry.result.raw.text().slice(0, 200)}`).toBe(403);
      expect(strip(entry.result.raw.text()), `${entry.name} is indistinguishable from a wrong key`).toBe(strip(reference.raw.text()));
    }
    // The same for the other output routes.
    const wrong = new OutputApi(config.baseURL, production.slug, 'wrong');
    expectProblem(await wrong.getOutputLiveKitToken(), 403, ERROR.forbidden);
    expectProblem(await wrong.reportOutputStatus({ rendering: true, latencyMs: 10, fps: 30, programSceneId: null }), 403, ERROR.forbidden);
    const good = production.output();
    expect((await good.getOutputLiveKitToken()).status).toBe(200);
    expect((await good.reportOutputStatus({ rendering: true, latencyMs: 10, fps: 30, programSceneId: null })).status).toBe(204);
  });

  test('INT-AUTH-15 [stack, missing key] a request without X-Output-Key is a 403 as well (GAP-06)', t.p0, async ({ config, production }) => {
    knownBug('BUG-03', 'GET /api/output/{slug}/snapshot without the X-Output-Key header answers 400 validation_failed instead of the uniform 403');
    const wrong = await new OutputApi(config.baseURL, production.slug, 'wrong-key-wrong-key-wrong-key-wrong-key-1').getOutputSnapshot();
    const strip = (text: string) => text.replace(/"traceId":"[^"]*",?/, '');
    for (const result of [
      await new OutputApi(config.baseURL, production.slug, undefined).getOutputSnapshot(),
      await new OutputApi(config.baseURL, production.slug, undefined).call('GET', `/api/output/${production.slug}/snapshot`, { query: { k: production.outputKey } }),
      await new OutputApi(config.baseURL, 'no-such-slug-xyz', undefined).getOutputLiveKitToken(),
    ]) {
      expect(result.status, result.raw.text().slice(0, 200)).toBe(403);
      expect(strip(result.raw.text())).toBe(strip(wrong.raw.text()));
    }
  });

  test('INT-AUTH-19 [stack] path traversal and hostile ids never reach the file system or cause a 500', t.p0, async ({ config, api, production }) => {
    const hostile = [
      '..%2f..%2fetc%2fpasswd',
      '%2e%2e%2f%2e%2e%2fx',
      '%252e%252e%252fx',
      '..%5c..%5cx',
      '%2fetc%2fpasswd',
      'C%3A%5Cwindows%5Cwin.ini',
      'x%00',
      'a'.repeat(10_000),
      'ast_AAAAAAAAAAAAAAAA',
      'ast_%EF%BC%A1%EF%BC%A1%EF%BC%A1%EF%BC%A1',
      '%E2%80%AEgnp.exe',
    ];
    const routes = (id: string) => [
      ['GET', `/api/productions/${id}/snapshot`],
      ['GET', `/api/productions/${production.id}/assets/${id}/content`],
      ['DELETE', `/api/productions/${production.id}/assets/${id}`],
      ['PATCH', `/api/productions/${production.id}/scenes/${id}`],
      ['DELETE', `/api/productions/${production.id}/scenes/${id}/items/${id}`],
      ['POST', `/api/productions/${production.id}/devices/${id}/block`],
      ['POST', `/api/productions/${production.id}/incidents/${id}/ack`],
      ['DELETE', `/api/productions/${production.id}/pairing/invites/${id}`],
      ['POST', `/api/productions/${production.id}/pairing/requests/${id}/approve`],
    ] as const;
    for (const id of hostile) {
      for (const [method, route] of routes(id)) {
        const response = await api.call(method, route, { json: method === 'GET' || method === 'DELETE' ? undefined : {} });
        const label = `${method} ${route.slice(0, 80)} -> ${response.status}`;
        // Caddy decodes %2f and normalises the path: a request that leaves /api/ lands on the SPA shell (200 html).
        const spaShell = response.status === 200 && /html/.test(response.headers['content-type'] ?? '') && /<sf-root|<title>StudioFlow/.test(response.raw.text());
        if (!spaShell) expect([400, 404, 414, 431, 405], label).toContain(response.status);
        expect(response.raw.text(), label).not.toMatch(/root:|\[boot loader\]|\bat [A-Z][\w.]+\(|\.cs:line/);
      }
    }
    // Public routes with hostile tokens and ids.
    const publicApi = new PublicApi(config.baseURL);
    for (const id of hostile.slice(0, 8)) {
      const redeem = await send({ method: 'POST', url: `${config.baseURL}/api/pairing/invites/${id}/redeem`, json: { clientId: 'x', kind: 'phone', platform: 'x' } });
      expect([404, 410, 400, 429, 414], `redeem ${id.slice(0, 20)}`).toContain(redeem.status);
      expect(redeem.status).not.toBe(500);
      const poll = await publicApi.getPairingRequestStatus(id, 'x');
      expect(poll.status).toBeLessThan(500);
    }
    expect((await api.getSnapshot(production.id)).status, 'the stack still serves').toBe(200);
  });

  test('INT-AUTH-21 [stack] hardening headers on API responses', t.p1, async ({ config, api, production, pairContext }) => {
    const samples = [
      await send({ method: 'GET', url: `${config.baseURL}/api/auth/me`, headers: { Cookie: api.cookie } }),
      await send({ method: 'GET', url: `${config.baseURL}/api/auth/me` }),
      await send({ method: 'GET', url: `${config.baseURL}/api/productions/${production.id}/snapshot`, headers: { Cookie: api.cookie } }),
      await send({ method: 'POST', url: `${config.baseURL}/api/pairing/requests`, json: {} }),
    ];
    for (const sample of samples) {
      expect(sample.headers['x-content-type-options'], `${sample.status}`).toMatch(/^nosniff/);
      expect(sample.headers['server'], 'no server banner').toBeUndefined();
      expect(sample.headers['access-control-allow-origin'], 'no CORS').toBeUndefined();
      expect(sample.headers['content-security-policy'], 'API CSP').toContain("default-src 'none'");
    }
  });

  test('INT-AUTH-21 [stack, duplicates] no security header is sent twice', t.p2, async ({ config, api }) => {
    knownBug('BUG-18', 'API responses carry X-Content-Type-Options twice (the API adds it and Caddy adds it again: "nosniff, nosniff")');
    const response = await send({ method: 'GET', url: `${config.baseURL}/api/auth/me`, headers: { Cookie: api.cookie } });
    for (const name of ['x-content-type-options', 'strict-transport-security', 'referrer-policy', 'content-security-policy', 'x-robots-tag']) {
      expect(response.headerAll(name), `${name} appears once`).toHaveLength(1);
    }
  });

  test('INT-AUTH-21 [stack, no-store] credential-bearing responses are not cacheable', t.p1, async ({ config, api, production, pairContext }) => {
    knownBug('BUG-04', 'livekit-token, redeem and pairing-poll responses carry secrets but send no Cache-Control: no-store');
    const phone = await pairPhone(pairContext, { name: 'Hardening' });
    const missing: string[] = [];
    const check = (name: string, response: { headers: Record<string, string> }) => {
      if (!/no-store/.test(response.headers['cache-control'] ?? '')) missing.push(name);
    };
    check('device livekit-token', await phone.api.getDeviceLiveKitToken());
    check('studio livekit-token', await api.getStudioLiveKitToken(production.id));
    check('output livekit-token', await production.output().getOutputLiveKitToken());
    const invite = await api.getPhoneInvite(production.id);
    const redeem = await send({ method: 'POST', url: `${pairContext.stack.anonymousBase}/api/pairing/invites/${invite.body.url.split('/').pop()}/redeem`, headers: pairContext.stack.forwardedForWorks ? { 'X-Forwarded-For': uniqueIp() } : {}, json: { clientId: 'cache-test', kind: 'phone', platform: 'x' } });
    expect(redeem.status).toBe(200);
    check('redeem', wrapRaw(redeem));
    const publicApi = new PublicApi(pairContext.stack.anonymousBase, pairContext.stack.forwardedForWorks ? uniqueIp() : undefined);
    const knock = await publicApi.createPairingRequest({ name: 'No Store', kind: 'laptop', platform: 'Windows · Edge' });
    production.pendingRequests.push({ requestId: knock.body.requestId, pollToken: knock.body.pollToken });
    expect((await api.approvePairingRequest(production.id, knock.body.requestId)).status).toBe(200);
    const poll = await publicApi.getPairingRequestStatus(knock.body.requestId, knock.body.pollToken);
    expect(poll.body.status).toBe('approved');
    check('pairing poll with credentials', poll);
    expect(config.baseURL).toContain('https');
    expect(missing, `responses without no-store: ${missing.join(', ')}`).toEqual([]);
  });

  test('INT-AUTH-22 [stack] request size limits: 256 KB JSON on the API, 10 MB on Caddy, 4 MB bandwidth test', t.p1, async ({ config, api, production, pairContext, stack }) => {
    const filler = (bytes: number) => ({ name: 'x'.repeat(Math.max(0, bytes - 12)) });
    const direct = api.withBase(stack.direct);
    const direct5 = await direct.call('POST', `/api/productions/`, { body: Buffer.alloc(5 * 1024 * 1024, 0x61), headers: { 'Content-Type': 'application/json' } });
    expectProblem(direct5, 413, ERROR.unsupportedMedia);
    // At the limit the request is parsed (and fails validation); above it the API answers 413 without running the handler.
    const atLimit = await direct.call('POST', `/api/productions/`, { body: JSON.stringify(filler(256 * 1024)), headers: { 'Content-Type': 'application/json' } });
    expect([400, 201, 413], `at limit ${atLimit.status}`).toContain(atLimit.status);
    expect(atLimit.status === 413, 'a body of exactly 256 KB is not too large').toBe(false);
    const above = await direct.call('POST', `/api/productions/`, { body: JSON.stringify(filler(256 * 1024 + 200)), headers: { 'Content-Type': 'application/json' } });
    expectProblem(above, 413, ERROR.unsupportedMedia);
    // Through Caddy the announced size decides, before any body byte is sent (a client that streams megabytes into an
    // early answer gets its response reset on Docker Desktop for Windows, which is no property of the product):
    // 5 MB passes Caddy's 10 MB limit and is refused by the API (problem+json); 11 MB is refused as well.
    const announce = (bytes: number) =>
      rawRequest({
        host: 'localhost',
        port: stackConfig().httpsPort,
        tls: true,
        servername: 'localhost',
        bytes: ['POST /api/productions/ HTTP/1.1', 'Host: localhost', 'Content-Type: application/json', `Content-Length: ${bytes}`, 'X-StudioFlow: 1', `Cookie: ${api.cookie}`, 'Connection: close', '', ''].join(CRLF),
        readMs: 2500,
      });
    const caddy5 = await announce(5 * 1024 * 1024);
    expect(caddy5.status, caddy5.statusLine).toBe(413);
    expect(caddy5.data.toString('latin1'), 'the 5 MB refusal comes from the API').toContain('"code":"unsupported_media"');
    const caddy11 = await announce(11 * 1000 * 1000);
    expect(caddy11.status, caddy11.statusLine).toBe(413);
    // (Caddy's own 10 MB limit is checked on the upload route in MEDIA-07, where the API would accept the size.)
    // Bandwidth test: 4 MB passes, 4 MB + 1 byte does not.
    const phone = await pairPhone(pairContext, { name: 'Bandwidth' });
    const ok = await phone.api.bandwidthTest(Buffer.alloc(4 * 1024 * 1024, 1));
    expect(ok.status).toBe(200);
    expect(ok.body.bytes).toBe(4 * 1024 * 1024);
    expect(ok.body.serverMs).toBeGreaterThan(0);
    const direct413 = await new DeviceApi(stack.direct, phone.credentials, stack.forwardedForWorks ? uniqueIp() : undefined).bandwidthTest(Buffer.alloc(4 * 1024 * 1024 + 1, 1));
    expectProblem(direct413, 413, ERROR.unsupportedMedia);
    // The stack is fine afterwards.
    expect((await api.getSnapshot(production.id)).status).toBe(200);
    expect(config.baseURL).toContain('https');
  });

  test('INT-AUTH-24 [stack] no CORS headers anywhere', t.p2, async ({ config, api }) => {
    for (const request of [
      { method: 'OPTIONS', url: `${config.baseURL}/api/auth/login`, headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,x-studioflow' } },
      { method: 'GET', url: `${config.baseURL}/api/auth/me`, headers: { Origin: 'https://evil.example', Cookie: api.cookie } },
      { method: 'GET', url: `${config.baseURL}/api/system/info`, headers: { Origin: 'https://evil.example' } },
    ]) {
      const response = await send(request);
      const cors = Object.keys(response.headers).filter((name) => name.startsWith('access-control-'));
      expect(cors, `${request.method} ${request.url}: ${response.status}`).toEqual([]);
    }
  });

  test('E2E-AUTH-27 the server surface is not exposed through Caddy or the API', t.p1, async ({ config, stack }) => {
    for (const route of ['/openapi/v1.json', '/swagger', '/swagger/index.html', '/metrics', '/health/live', '/health/ready', '/appsettings.json', '/.env', '/Opten.StudioFlow.Web.dll', '/appsettings.Production.json', '/web.config']) {
      const response = await send({ method: 'GET', url: `${config.baseURL}${route}` });
      const body = response.text();
      // Either 404 or the SPA shell; never the content of the file/endpoint.
      expect([200, 404], `${route} -> ${response.status}`).toContain(response.status);
      if (response.status === 200) expect(response.headers['content-type'] ?? '', `${route} is the SPA shell`).toMatch(/html/);
      expect(body, route).not.toMatch(/ConnectionStrings|"openapi"|ASPNETCORE|PasswordHash|Healthy|MZ\x90|POSTGRES_PASSWORD|LIVEKIT_API_SECRET|process_cpu/);
    }
    // The API itself (direct port): no OpenAPI document in Production (GAP-04c), health answers only a status word.
    const openapi = await send({ method: 'GET', url: `${stack.direct}/openapi/v1.json` });
    expect(openapi.status, 'OpenAPI document in Production').toBe(404);
    for (const route of ['/health/live', '/health/ready']) {
      const health = await send({ method: 'GET', url: `${stack.direct}${route}` });
      expect(health.status).toBe(200);
      expect(health.text().trim()).toBe('Healthy');
    }
    expect((await send({ method: 'GET', url: `${stack.direct}/swagger` })).status).toBe(404);
  });
});

function wrapRaw(raw: Awaited<ReturnType<typeof send>>) {
  let body: unknown;
  try {
    body = raw.json();
  } catch {
    body = undefined;
  }
  return { status: raw.status, body, headers: raw.headers, raw };
}
