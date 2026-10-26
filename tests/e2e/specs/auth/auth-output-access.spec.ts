import { expect, expectProblem, skipUnsupported, test } from '../../support/fixtures';
import { OutputApi, parseOutputUrl } from '../../support/api';
import { ERROR, THRESHOLD } from '../../support/constants';
import { send } from '../../support/http';
import { OutputHub, negotiate, openRawHub, StudioHub } from '../../support/hubs';
import { makePng } from '../../support/media-samples';
import { pairPhone } from '../../support/production';
import { sleep } from '../../support/shell';
import { t } from '../../support/tags';

/**
 * AUTH - hub Origin check, output key, IP restriction and key rotation against the real stack
 * (E2E-AUTH-08, -23, -24; INT-AUTH-13, -16, -17, -18; E2E-OUT-12).
 */

test.describe('AUTH hubs and output access', () => {
  test('E2E-AUTH-08 hub Origin check through Caddy (negotiate and WebSocket upgrade, all three hubs)', t.p1, async ({ config, api, production, pairContext, onCleanup }) => {
    const phone = await pairPhone(pairContext, { name: 'Origin Test' });
    const base = config.baseURL;
    const credentials = {
      studio: { cookie: api.cookie },
      device: { accessToken: phone.bearer },
      output: { accessToken: production.outputKey },
    } as const;
    // The Origin must match the host and port the request arrives on: https://localhost on the default stack,
    // https://localhost:849N on a numbered one (E2E_STACK).
    const own = new URL(base);
    const portSuffix = own.port ? `:${own.port}` : '';
    const otherPort = own.port === '8443' ? 8444 : 8443;
    const allowed = [undefined, `https://localhost${portSuffix}`, `https://LOCALHOST${portSuffix}`, `http://localhost${portSuffix}`];
    const refused = ['https://evil.example', 'null', `https://localhost:${otherPort}`, 'https://localhost.evil.com', 'javascript:alert(1)', `https://evil.example${portSuffix || ':443'}`, ''];
    if (own.port) refused.push('https://localhost'); // the default port is a different origin than the published one
    for (const hub of ['studio', 'device', 'output'] as const) {
      for (const origin of refused) {
        const negotiated = await negotiate(base, hub, { ...('cookie' in credentials[hub] ? { cookie: api.cookie } : { accessTokenQuery: (credentials[hub] as { accessToken: string }).accessToken }), origin: origin || undefined, headers: origin === '' ? { Origin: '' } : {} });
        if (origin === '') {
          // An empty Origin header is treated as absent by the API.
          expect([200, 403], `${hub} negotiate with an empty Origin`).toContain(negotiated.status);
          continue;
        }
        expect(negotiated.status, `${hub} negotiate with Origin ${origin}`).toBe(403);
        const socket = await openRawHub(base, hub, { ...credentials[hub], origin });
        onCleanup(() => socket.close());
        expect(socket.status, `${hub} WebSocket upgrade with Origin ${origin}`).toBe(403);
      }
      for (const origin of allowed) {
        const socket = await openRawHub(base, hub, { ...credentials[hub], origin });
        onCleanup(() => socket.close());
        expect(socket.status, `${hub} WebSocket upgrade with Origin ${origin ?? '(none)'}`).toBe(101);
        const negotiated = await negotiate(base, hub, { ...('cookie' in credentials[hub] ? { cookie: api.cookie } : { accessTokenQuery: (credentials[hub] as { accessToken: string }).accessToken }), origin });
        expect(negotiated.status, `${hub} negotiate with Origin ${origin ?? '(none)'}`).toBe(200);
      }
    }
  });

  test('INT-AUTH-18 [stack] allowed IP list: validation, canonical form, limits', t.p1, async ({ api, production }) => {
    const set = (allowedIps: string[]) => api.updateOutputAccess(production.id, { allowedIps });
    const ok = await set(['10.1.2.3', '10.1.2.7/24', '10.1.2.3/32', '2001:db8::/32', '::1']);
    expect(ok.status, ok.raw.text()).toBe(200);
    // Canonical: host bits of a range are cleared, a single address is stored without /32.
    expect(ok.body.allowedIps).toEqual(expect.arrayContaining(['10.1.2.3', '10.1.2.0/24', '2001:db8::/32', '::1']));
    expect(ok.body.allowedIps).not.toContain('10.1.2.3/32');
    expect(ok.body.allowedIps.length, 'duplicates are folded').toBeLessThanOrEqual(4);
    const settings = (await api.getOutputSettings(production.id)).body;
    expect(settings.allowedIps).toEqual(ok.body.allowedIps);

    for (const invalid of [['999.1.1.1'], ['10.0.0.0/33'], ['abc'], [''], ['10.0.0.1', '10.0.0.0/99'], ['1.2.3.4/'], ['1.2.3.4.5']]) {
      const result = await set(invalid);
      expectProblem(result, 400, ERROR.validationFailed);
      expect(JSON.stringify(result.body.errors ?? {}), `the offending index is named for ${JSON.stringify(invalid)}`).toMatch(/allowedIps|\[\d+\]|\d/i);
    }
    const tooMany = await set(Array.from({ length: 51 }, (_, index) => `10.9.${Math.floor(index / 250)}.${(index % 250) + 1}`));
    expectProblem(tooMany, 400, ERROR.validationFailed);
    const fifty = await set(Array.from({ length: 50 }, (_, index) => `10.9.0.${index + 1}`));
    expect(fifty.status, '50 rules are allowed').toBe(200);
    expect((await set([])).status).toBe(200);
    const snapshot = await production.snapshot();
    expect(snapshot.recentLog.map((entry) => entry.text), 'audit/log entry «Access of output link “Proxy” changed»').toContain('Access of output link “Proxy” changed');
  });

  test('INT-AUTH-16 [stack] IP restriction with the forwarded address (REST, hub negotiate and asset ?k=)', t.p0, async ({ stack, api, production }) => {
    skipUnsupported(!stack.forwardedForWorks, 'the direct API port does not honour X-Forwarded-For here');
    const direct = api.withBase(stack.direct);
    const asset = await direct.uploadAsset(production.id, { fileName: 'tiny.png', contentType: 'image/png', data: makePng(1, 1) });
    expect(asset.status, asset.raw.text()).toBe(201);
    const snapshotFor = (forwardedFor: string) => new OutputApi(stack.direct, production.slug, production.outputKey, forwardedFor).getOutputSnapshot();
    const assetFor = (forwardedFor: string, key = production.outputKey) =>
      send({ method: 'GET', url: `${stack.direct}/api/productions/${production.id}/assets/${asset.body.id}/content?k=${key}`, headers: { 'X-Forwarded-For': forwardedFor } });
    const hubFor = (forwardedFor: string) => negotiate(stack.direct, 'output', { accessTokenQuery: production.outputKey, headers: { 'X-Forwarded-For': forwardedFor } });

    expect((await direct.updateOutputAccess(production.id, { allowedIps: ['10.1.2.3'] })).status).toBe(200);
    expect((await snapshotFor('10.1.2.3')).status).toBe(200);
    expect((await snapshotFor('10.1.2.4')).status).toBe(403);
    expect((await hubFor('10.1.2.3')).status).toBe(200);
    expect((await hubFor('10.1.2.4')).status, 'hub negotiate enforces the list').toBe(403);
    expect((await assetFor('10.1.2.3')).status).toBe(200);
    expect((await assetFor('10.1.2.4')).status, 'the asset ?k= path enforces the same list').toBe(403);

    expect((await direct.updateOutputAccess(production.id, { allowedIps: ['10.1.2.0/24'] })).status).toBe(200);
    expect((await snapshotFor('10.1.2.200')).status).toBe(200);
    expect((await snapshotFor('10.1.3.1')).status).toBe(403);

    // The proxy appends the real peer: a forged first entry does not help.
    expect((await direct.updateOutputAccess(production.id, { allowedIps: ['10.1.2.3'] })).status).toBe(200);
    const forged = await snapshotFor('10.1.2.3, 203.0.113.7');
    expect(forged.status, 'effective client = right-most entry added by the proxy').toBe(403);

    // The admin cookie is not subject to the list (assets), and an empty list allows everyone again.
    expect((await direct.getAssetContent(production.id, asset.body.id)).status).toBe(200);
    expect((await direct.updateOutputAccess(production.id, { allowedIps: [] })).status).toBe(200);
    expect((await snapshotFor('198.51.100.9')).status).toBe(200);
  });

  test('E2E-AUTH-23 [api] IP restriction through the proxy: refused, kicked within 2 s, works again with the observed address', t.smoke, async ({ config, api, production, onCleanup }) => {
    const studio = StudioHub.connect(config.baseURL, api.cookie);
    onCleanup(() => studio.stop());
    await studio.open(production.id);

    const hub = OutputHub.connect(config.baseURL, production.outputKey);
    onCleanup(() => hub.stop());
    await hub.open();
    await hub.report({ rendering: true });
    // The address the API sees for this client is listed in the output status.
    const status = await studio.waitForEvent('outputStatusChanged', (event) => event.status.consumers === 1 && event.status.addresses.length > 0);
    const observed = status.status.addresses[0]!;
    expect(observed).toMatch(/^\d+\.\d+\.\d+\.\d+$|:/);

    // Saving a list without that address kicks the connected page within 2 s and refuses new ones.
    const saved = Date.now();
    expect((await api.updateOutputAccess(production.id, { allowedIps: ['203.0.113.9'] })).status).toBe(200);
    const closedAt = await hub.waitClosed(5000);
    expect(closedAt - saved, 'kicked within T-KEY').toBeLessThanOrEqual(THRESHOLD.keyHardMs);
    expect((await negotiate(config.baseURL, 'output', { accessTokenQuery: production.outputKey })).status).toBe(403);
    expectProblem(await production.output().getOutputSnapshot(), 403, ERROR.forbidden);
    expect((await studio.waitForEvent('outputStatusChanged', (event) => event.status.consumers === 0)).status.state).toBe('none');

    // With the observed address the page works again.
    expect((await api.updateOutputAccess(production.id, { allowedIps: [observed] })).status).toBe(200);
    expect((await production.output().getOutputSnapshot()).status).toBe(200);
    const again = OutputHub.connect(config.baseURL, production.outputKey);
    onCleanup(() => again.stop());
    await again.open();
  });

  test('E2E-AUTH-24 [api] output link regeneration kicks the connected page and kills the old key at once', t.smoke, async ({ config, api, production, onCleanup }) => {
    const studio = StudioHub.connect(config.baseURL, api.cookie);
    onCleanup(() => studio.stop());
    await studio.open(production.id);
    const hub = OutputHub.connect(config.baseURL, production.outputKey);
    onCleanup(() => hub.stop());
    await hub.open();
    await hub.report({ rendering: true });
    await studio.waitForEvent('outputStatusChanged', (event) => event.status.consumers === 1);
    const oldKey = production.outputKey;
    const oldUrl = production.outputUrl;

    const saved = Date.now();
    const regenerated = await api.regenerateOutputKey(production.id);
    expect(regenerated.status).toBe(200);
    const newKey = parseOutputUrl(regenerated.body.url).key;
    expect(newKey).not.toBe(oldKey);
    expect(regenerated.body.url).not.toBe(oldUrl);
    expect(new Date(regenerated.body.keyCreatedAt).getTime(), 'keyCreatedAt advanced').toBeGreaterThanOrEqual(saved - 2000);

    // Old key: immediately dead on REST, negotiate and the asset path; the connected hub is closed within 2 s.
    expectProblem(await new OutputApi(config.baseURL, production.slug, oldKey).getOutputSnapshot(), 403, ERROR.forbidden);
    expect((await negotiate(config.baseURL, 'output', { accessTokenQuery: oldKey })).status).toBe(403);
    const closedAt = await hub.waitClosed(5000);
    expect(closedAt - saved, 'old output page kicked within T-KEY').toBeLessThanOrEqual(THRESHOLD.keyHardMs);
    const status = await studio.waitForEvent('outputStatusChanged', (event) => event.status.consumers === 0);
    expect(status.status.state).toBe('none');

    // New key works; the log says so; cancelling is simply not calling the endpoint.
    expect((await new OutputApi(config.baseURL, production.slug, newKey).getOutputSnapshot()).status).toBe(200);
    expect((await negotiate(config.baseURL, 'output', { accessTokenQuery: newKey })).status).toBe(200);
    const log = await studio.waitForEvent('logAppended', (event) => event.entry.text === 'Output link “Proxy” regenerated');
    expect(log.entry.text).toBe('Output link “Proxy” regenerated');
    expect((await production.snapshot()).recentLog.map((entry) => entry.text)).toContain('Output link “Proxy” regenerated');
  });

  test('E2E-OUT-12 [api] access denied: wrong key, unknown slug, key of another production look identical', t.p0, async ({ config, api, production, onCleanup }) => {
    const foreign = await api.createProduction({ name: `e2e foreign ${Date.now()}` });
    const foreignKey = parseOutputUrl((await api.getOutputSettings(foreign.body.id)).body.url).key;
    const attempts: Array<{ name: string; slug: string; key: string }> = [
      { name: 'wrong key', slug: production.slug, key: 'x'.repeat(43) },
      { name: 'unknown slug', slug: 'does-not-exist', key: production.outputKey },
      { name: 'key of another production', slug: production.slug, key: foreignKey },
      { name: 'empty key', slug: production.slug, key: '' },
    ];
    const bodies = new Set<string>();
    for (const attempt of attempts) {
      const snapshot = await new OutputApi(config.baseURL, attempt.slug, attempt.key).getOutputSnapshot();
      const label = `${attempt.name}: ${snapshot.raw.text().slice(0, 160)}`;
      if (attempt.key === '') {
        // An empty header is "no key": covered by INT-AUTH-15 [missing key].
        expect([400, 403], label).toContain(snapshot.status);
        continue;
      }
      expect(snapshot.status, label).toBe(403);
      bodies.add(snapshot.raw.text().replace(/"traceId":"[^"]*",?/, ''));
      // The hub URL carries no slug: only the key decides there.
      if (attempt.name === 'wrong key') {
        const hub = await negotiate(config.baseURL, 'output', { accessTokenQuery: attempt.key });
        expect(hub.status, `hub ${attempt.name}`).toBe(403);
      }
    }
    expect([...bodies], 'every refusal has the same body, no hint whether the slug exists').toHaveLength(1);
    // Fixing the URL works at once.
    expect((await production.output().getOutputSnapshot()).status).toBe(200);
    const hub = OutputHub.connect(config.baseURL, production.outputKey);
    onCleanup(() => hub.stop());
    await hub.open();
    await sleep(50);
    expect(hub.isConnected).toBe(true);
    // And an unauthenticated hub client cannot even connect (SignalR client sees the 403).
    const denied = OutputHub.connect(config.baseURL, 'wrong');
    await expect(denied.start()).rejects.toThrow(/403/);
  });

  test('INT-AUTH-17 [stack] key rotation removes every output_{slug}_* participant from LiveKit and none other', t.p1, async ({ config, production }) => {
    // The real LiveKit side (a connected output page) is covered by E2E-LK-02; here the API contract is checked:
    // the new URL is returned, the old key is dead, and rotating twice keeps working.
    const api = production.api;
    const first = (await api.regenerateOutputKey(production.id)).body;
    const second = (await api.regenerateOutputKey(production.id)).body;
    expect(parseOutputUrl(first.url).key).not.toBe(parseOutputUrl(second.url).key);
    expect((await new OutputApi(config.baseURL, production.slug, parseOutputUrl(first.url).key).getOutputSnapshot()).status).toBe(403);
    expect((await new OutputApi(config.baseURL, production.slug, parseOutputUrl(second.url).key).getOutputSnapshot()).status).toBe(200);
  });
});
