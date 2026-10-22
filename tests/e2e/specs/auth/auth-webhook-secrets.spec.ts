import crypto from 'node:crypto';
import { SignJWT } from 'jose';
import { OutputApi, PublicApi } from '../../support/api';
import { ERROR, LIMITS } from '../../support/constants';
import { expect, knownBug, test, uniqueIp } from '../../support/fixtures';
import { send } from '../../support/http';
import { OutputHub, DeviceHub, openRawHub } from '../../support/hubs';
import { makePng } from '../../support/media-samples';
import { pairPhone } from '../../support/production';
import { compose } from '../../support/stack';
import { t } from '../../support/tags';

/**
 * AUTH - LiveKit webhook authentication, secrets at rest, and secrets in logs
 * (INT-AUTH-25, INT-AUTH-26, INT-AUTH-20 at stack level, E2E-AUTH-22, E2E-OPS-14).
 */

const WEBHOOK = '/api/livekit/webhook';

async function signWebhook(body: Buffer, options: { secret?: string; apiKey?: string; alg?: 'HS256' | 'HS512'; expiresIn?: string; sha256?: string | null; notBefore?: string } = {}): Promise<string> {
  const { stackConfig } = await import('../../support/env');
  const config = stackConfig();
  const claims: Record<string, unknown> = {};
  if (options.sha256 !== null) claims['sha256'] = options.sha256 ?? crypto.createHash('sha256').update(body).digest('base64');
  const jwt = new SignJWT(claims)
    .setProtectedHeader({ alg: options.alg ?? 'HS256' })
    .setIssuer(options.apiKey ?? config.livekit.apiKey)
    .setIssuedAt()
    .setExpirationTime(options.expiresIn ?? '5m');
  if (options.notBefore) jwt.setNotBefore(options.notBefore);
  return jwt.sign(new TextEncoder().encode(options.secret ?? config.livekit.apiSecret));
}

test.describe('AUTH webhook', () => {
  test('INT-AUTH-25 [stack] only a correctly signed LiveKit webhook is accepted; failures change no state', t.p1, async ({ config, stack, api, production }) => {
    const base = stack.direct;
    const event = (extra: Record<string, unknown> = {}) =>
      Buffer.from(JSON.stringify({ event: 'participant_joined', room: { name: production.id, sid: 'RM_x' }, participant: { identity: 'dev_nonexistentdevice0', sid: 'PA_x' }, id: 'EV_x', createdAt: String(Math.floor(Date.now() / 1000)), ...extra }));
    const post = (body: Buffer, authorization: string | undefined, contentType = 'application/webhook+json') =>
      send({ method: 'POST', url: `${base}${WEBHOOK}`, headers: { 'Content-Type': contentType, ...(authorization ? { Authorization: authorization } : {}) }, body });
    const body = event();
    const revision = (await api.getSnapshot(production.id)).body.revision;

    // valid
    expect((await post(body, await signWebhook(body))).status, 'application/webhook+json').toBe(200);

    // invalid: all answer 401 without looking at the body
    const tampered = Buffer.from(body.toString().replace('participant_joined', 'participant_leftxx'));
    const rejected: Array<[string, Promise<string | undefined> | string | undefined, Buffer?]> = [
      ['missing header', undefined],
      ['not a JWT', 'garbage'],
      ['wrong secret', signWebhook(body, { secret: 'sk' + 'f'.repeat(40) })],
      ['wrong issuer', signWebhook(body, { apiKey: 'someone-else' })],
      ['expired', signWebhook(body, { expiresIn: '-10m' })],
      ['not yet valid', signWebhook(body, { notBefore: '2h' })],
      ['body hash of another body', signWebhook(body), tampered],
      ['missing sha256 claim', signWebhook(body, { sha256: null })],
      ['sha256 of the empty string', signWebhook(body, { sha256: crypto.createHash('sha256').update('').digest('base64') })],
      ['HS512 instead of HS256', signWebhook(body, { alg: 'HS512' })],
      ['alg none', Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url') + '.' + Buffer.from(JSON.stringify({ iss: config.livekit.apiKey, sha256: crypto.createHash('sha256').update(body).digest('base64'), exp: Math.floor(Date.now() / 1000) + 300 })).toString('base64url') + '.'],
    ];
    for (const [name, token, otherBody] of rejected) {
      const response = await post(otherBody ?? body, await token);
      expect(response.status, name).toBe(401);
      expect(response.json().code, name).toBe(ERROR.unauthorized);
    }

    // valid signature, odd content
    const malformed = Buffer.from('{"event": nope');
    expect((await post(malformed, await signWebhook(malformed))).status, 'malformed JSON').toBe(400);
    const unknownEvent = event({ event: 'something_new' });
    expect((await post(unknownEvent, await signWebhook(unknownEvent))).status, 'unknown event').toBe(200);
    const otherRoom = event({ room: { name: 'prd_aaaaaaaaaaaaaaaa' } });
    expect((await post(otherRoom, await signWebhook(otherRoom))).status, 'unknown room').toBe(200);
    const notARoom = event({ room: { name: 'studio_x' } });
    expect((await post(notARoom, await signWebhook(notARoom))).status, 'foreign room name').toBe(200);

    // oversize: refused before parsing (the API limit is 64 KB)
    const huge = Buffer.alloc(LIMITS.webhookBodyBytes + 1024, 0x20); // plan: bodies above 1 MB are refused with 413
    const oversize = await post(huge, await signWebhook(huge));
    expect(oversize.status).toBe(413);

    // No state change, nothing leaked to the studio.
    expect((await api.getSnapshot(production.id)).body.revision, 'failed webhooks change no state').toBe(revision);
  });

  test('INT-AUTH-25 [stack, content type] a correctly signed webhook with Content-Type application/json is accepted too', t.p2, async ({ stack, production }) => {
    knownBug('BUG-05', 'POST /api/livekit/webhook answers 415 for application/json (the plan expects 200; LiveKit itself sends application/webhook+json, so the running system is not affected)');
    const body = Buffer.from(JSON.stringify({ event: 'participant_joined', room: { name: production.id }, participant: { identity: 'dev_nonexistentdevice0' } }));
    const response = await send({ method: 'POST', url: `${stack.direct}${WEBHOOK}`, headers: { 'Content-Type': 'application/json', Authorization: await signWebhook(body) }, body });
    expect(response.status).toBe(200);
  });

  test('INT-AUTH-25 [stack, via Caddy] the webhook and Twirp paths are not reachable from outside', t.p0, async ({ config }) => {
    const body = Buffer.from('{}');
    const webhook = await send({ method: 'POST', url: `${config.baseURL}${WEBHOOK}`, headers: { 'Content-Type': 'application/webhook+json', Authorization: await signWebhook(body) }, body });
    expect(webhook.status, 'even a correctly signed webhook is answered by Caddy').toBe(404);
    for (const route of ['/twirp/livekit.RoomService/ListRooms', '/twirp/livekit.RoomService/RemoveParticipant', '/twirp', '/twirp/']) {
      for (const method of ['POST', 'GET']) {
        const response = await send({ method, url: `${config.baseURL}${route}`, headers: { 'Content-Type': 'application/json' }, json: method === 'POST' ? {} : undefined });
        expect(response.status, `${method} ${route}`).toBe(404);
      }
    }
    const lkApi = await send({ method: 'GET', url: `${config.baseURL}/api/livekit/anything` });
    expect(lkApi.status).toBe(404);
  });

  test('INT-AUTH-26 [stack] secrets at rest: device secrets and poll tokens are stored only as hashes', t.p1, async ({ config, production, pairContext, stack }) => {
    const phone = await pairPhone(pairContext, { name: 'At Rest' });
    const publicApi = new PublicApi(stack.anonymousBase, stack.forwardedForWorks ? uniqueIp() : undefined);
    const knock = await publicApi.createPairingRequest({ name: 'Poll Token', kind: 'laptop', platform: 'Windows · Edge' });
    production.pendingRequests.push({ requestId: knock.body.requestId, pollToken: knock.body.pollToken });
    const invite = (await production.api.createInvite(production.id, { kind: 'laptopLink' })).body;
    await production.api.regenerateOutputKey(production.id);
    await production.refreshOutput();

    const dump = await compose(['exec', '-T', 'postgres', 'pg_dump', '-U', 'flowstudio', '-d', 'flowstudio', '--data-only', '--inserts'], { timeoutMs: 120_000 });
    expect(dump.code, dump.stderr.slice(0, 300)).toBe(0);
    const text = dump.stdout;
    expect(text, 'the dump contains the data of this test').toContain(phone.id);
    expect(text, 'plaintext device secret').not.toContain(phone.credentials.deviceSecret);
    expect(text, 'plaintext device bearer').not.toContain(phone.bearer);
    expect(text, 'plaintext poll token (pending requests are memory only)').not.toContain(knock.body.pollToken);
    const hash = crypto.createHash('sha256').update(phone.credentials.deviceSecret).digest('hex');
    expect(text.toLowerCase(), 'the lower-case hex SHA-256 of the secret is stored').toContain(hash);
    expect(text, 'admin password').not.toContain(config.admin.password);
    expect(text, 'LiveKit secret').not.toContain(config.livekit.apiSecret);
    // Documented exception: invite tokens and the output key are stored in clear (the Regie must show their URLs).
    expect(text).toContain(production.outputKey);
    expect(text).toContain(invite.url.split('/').pop()!);
    const media = await compose(['exec', '-T', 'api', 'sh', '-c', 'ls -la /data/keys | head -20; echo ---; stat -c "%a %u" /data/keys']);
    expect(media.code).toBe(0);
    expect(media.stdout).toMatch(/\.xml/);
  });
});

test.describe('AUTH logs', () => {
  test('E2E-AUTH-22 the Caddy access log never contains secrets (tokens in queries, headers and paths are redacted)', t.p1, async ({ config, api, production, pairContext, stack }) => {
    const since = new Date(Date.now() - 1000).toISOString();
    const phone = await pairPhone(pairContext, { name: 'Log Redaction' });
    const asset = await api.uploadAsset(production.id, { fileName: 'tiny.png', contentType: 'image/png', data: makePng(1, 1) });
    expect(asset.status).toBe(201);

    // Flows that put secrets into URLs and headers, all through Caddy.
    const deviceHub = DeviceHub.connect(config.baseURL, phone.credentials);
    await deviceHub.open();
    await deviceHub.report({ rtc: 'connected', slots: [] });
    const outputHub = OutputHub.connect(config.baseURL, production.outputKey);
    await outputHub.open();
    await openRawHub(config.baseURL, 'device', { accessToken: phone.bearer }).then((socket) => socket.close());
    await send({ method: 'GET', url: `${config.baseURL}/o/${production.slug}?k=${production.outputKey}` });
    await send({ method: 'GET', url: `${config.baseURL}/api/productions/${production.id}/assets/${asset.body.id}/content?k=${production.outputKey}` });
    await new OutputApi(config.baseURL, production.slug, production.outputKey).getOutputSnapshot();
    const publicApi = new PublicApi(stack.anonymousBase, stack.forwardedForWorks ? uniqueIp() : undefined);
    const knock = await publicApi.createPairingRequest({ name: 'Log Poll', kind: 'laptop', platform: 'Windows · Edge' });
    production.pendingRequests.push({ requestId: knock.body.requestId, pollToken: knock.body.pollToken });
    await publicApi.getPairingRequestStatus(knock.body.requestId, knock.body.pollToken);
    // LiveKit signalling with a token in the query (refused, but the request line is logged by Caddy).
    const lkToken = (await phone.api.getDeviceLiveKitToken()).body.token;
    await send({ method: 'GET', url: `${config.baseURL}/rtc/v1/validate?access_token=${lkToken}` });
    await send({ method: 'GET', url: `${config.baseURL}/rtc?access_token=${lkToken}&protocol=15`, headersOnly: true });
    await deviceHub.stop();
    await outputHub.stop();

    const secrets: Record<string, string> = {
      'device secret': phone.credentials.deviceSecret,
      'output key': production.outputKey,
      'admin cookie value': api.cookie.split('=')[1]!,
      'poll token': knock.body.pollToken,
      'LiveKit JWT': lkToken,
      'LiveKit JWT payload': lkToken.split('.')[1]!,
      'admin password': config.admin.password,
      'LiveKit API secret': config.livekit.apiSecret,
    };
    const logs = (await compose(['logs', '--no-color', '--no-log-prefix', '--since', since, 'caddy'])).output;
    expect(logs.length, 'the access log has entries').toBeGreaterThan(500);
    for (const [name, value] of Object.entries(secrets)) expect(logs, `Caddy log contains the ${name}`).not.toContain(value);
    expect(logs, 'access_token and k values are replaced').toMatch(/REDACTED/);
    expect(logs).not.toMatch(/access_token=[^R&"\s]/);
    expect(logs).not.toMatch(/[?&]k=[^R&"\s]/);
    // Which of them reached the other containers' logs?
    const apiLogs = (await compose(['logs', '--no-color', '--no-log-prefix', '--since', since, 'api', 'livekit', 'postgres'])).output;
    for (const [name, value] of Object.entries(secrets)) expect(apiLogs, `api/livekit/postgres logs contain the ${name}`).not.toContain(value);
  });
});
