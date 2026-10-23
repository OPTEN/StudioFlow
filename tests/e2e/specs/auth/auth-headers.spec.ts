import tls from 'node:tls';
import { expect, test } from '../../support/fixtures';
import { rawRequest, send } from '../../support/http';
import { parseCsp } from '../../support/parse';
import { stackConfig } from '../../support/env';
import { t } from '../../support/tags';

/**
 * AUTH - security headers of every entry point, framing, HTTP->HTTPS, TLS versions, redirects and header injection
 * (E2E-AUTH-09, -10, -19, -20, -21; docs/testing.md 2.1, invariants I-CSP).
 */

const CRLF = String.fromCharCode(13, 10);

interface Target {
  name: string;
  path: string;
  area: 'studio' | 'join' | 'output' | 'api' | 'redirect';
  authenticated?: boolean;
  /** The response is a document/script served with the page CSP. */
  page?: boolean;
}

const TARGETS: Target[] = [
  { name: 'Regie /', path: '/', area: 'studio', page: true },
  { name: 'Regie /login (SPA route)', path: '/login', area: 'studio', page: true },
  { name: 'sender /join/', path: '/join/', area: 'join', page: true },
  { name: 'sender /join/i/x', path: '/join/i/x', area: 'join', page: true },
  { name: 'output /o/webinar', path: '/o/webinar?k=x', area: 'output', page: true },
  { name: 'API /api/system/info', path: '/api/system/info', area: 'api', authenticated: true },
  { name: 'Regie index.html', path: '/index.html', area: 'studio', page: true },
  { name: 'sender ngsw.json', path: '/join/ngsw.json', area: 'join', page: true },
  { name: 'short invite link /j/x', path: '/j/x', area: 'redirect' },
];

test.describe('AUTH headers', () => {
  test('E2E-AUTH-09 security headers on every entry point', t.smoke, async ({ config, api }) => {
    const host = config.host;
    for (const target of TARGETS) {
      const response = await send({ method: 'GET', url: `${config.baseURL}${target.path}`, headers: target.authenticated ? { Cookie: api.cookie } : {} });
      const label = `${target.name} (${response.status})`;
      expect(response.status, label).toBeLessThan(400);

      // Transport and content-type hardening on every response.
      expect(response.headers['strict-transport-security'], label).toMatch(/^max-age=\d+; includeSubDomains$/);
      expect(Number(/max-age=(\d+)/.exec(response.headers['strict-transport-security']!)![1]), `${label} HSTS max-age (default 1 year)`).toBeGreaterThanOrEqual(31_536_000);
      expect(response.headers['x-content-type-options'], label).toMatch(/^nosniff/);
      expect(response.headers['referrer-policy'], label).toBe('no-referrer');
      expect(response.headers['server'], `${label} no Server header`).toBeUndefined();
      expect(response.headers['x-robots-tag'], label).toBe('noindex, nofollow');
      if (target.area === 'redirect') continue; // a redirect renders nothing and carries no page policy
      expect(response.headerAll('content-security-policy'), `${label} exactly one CSP`).toHaveLength(1);

      const csp = parseCsp(response.headers['content-security-policy']!);
      if (target.area === 'api') {
        expect(csp['default-src'], label).toEqual(["'none'"]);
        expect(csp['frame-ancestors'], label).toEqual(["'none'"]);
        continue;
      }
      // I-CSP
      const allText = response.headers['content-security-policy']!;
      expect(allText, `${label} no unsafe-eval`).not.toContain('unsafe-eval');
      expect(csp['script-src'], `${label} script-src`).toBeDefined();
      for (const bad of ["'unsafe-inline'", '*', 'data:', 'http:']) expect(csp['script-src'], `${label} script-src must not contain ${bad}`).not.toContain(bad);
      expect(csp['object-src'], label).toEqual(["'none'"]);
      expect(['\'self\'', '\'none\''], `${label} base-uri`).toContain(csp['base-uri']?.[0]);
      expect(csp['form-action'], label).toEqual(["'self'"]);
      expect(["'self'", "'none'"], `${label} default-src`).toContain(csp['default-src']?.[0]);
      expect(csp['connect-src'], `${label} connect-src`).toContain("'self'");
      expect(csp['connect-src'], `${label} connect-src names the websocket origin (Safari)`).toContain(`wss://${new URL(config.baseURL).host}`);
      expect(csp['img-src'], label).toEqual(expect.arrayContaining(['data:', 'blob:']));
      expect(csp['media-src'], label).toContain('blob:');
      for (const [directive, sources] of Object.entries(csp)) {
        if (directive === 'frame-ancestors') continue;
        for (const source of sources) {
          if (/^(https?|wss?):\/\//.test(source)) expect(source, `${label}: ${directive} must name no external host`).toMatch(new RegExp(`^(https|wss)://${host}(:\\d+)?$`));
        }
      }

      // Framing: only the output may be embedded, and only by self + STUDIOFLOW_FRAME_ANCESTORS.
      if (target.area === 'output') {
        expect(csp['frame-ancestors'], label).toEqual(["'self'", ...config.frameAncestors.split(/\s+/)]);
        expect(response.headers['x-frame-options'], `${label} /o/* sends no X-Frame-Options`).toBeUndefined();
      } else {
        expect(csp['frame-ancestors'], label).toEqual(["'none'"]);
      }

      // Permissions-Policy
      const permissions = response.headers['permissions-policy'] ?? '';
      if (target.area === 'join') {
        expect(permissions, label).toContain('camera=(self)');
        expect(permissions, label).toContain('display-capture=(self)');
      } else {
        expect(permissions, label).toContain('camera=()');
        expect(permissions, label).toContain('display-capture=()');
        expect(permissions, label).toContain('microphone=()');
      }
      if (target.area === 'output') {
        expect(permissions, `${label} must not disable autoplay`).not.toMatch(/autoplay=\(\)/);
        expect(permissions, `${label} must not disable fullscreen`).not.toMatch(/fullscreen=\(\)/);
      }
    }
  });

  test('E2E-AUTH-09 [sender microphone] /join/* allows the microphone for itself (microphone=(self), spec section 10, DOC-01)', t.p1, async ({ config }) => {
    const response = await send({ method: 'GET', url: `${config.baseURL}/join/` });
    expect(response.headers['permissions-policy']).toContain('microphone=(self)');
  });

  test('E2E-AUTH-09 [caching] hashed files are immutable, index.html and ngsw.json are revalidated, errors are not cached', t.p1, async ({ config }) => {
    const index = await send({ method: 'GET', url: `${config.baseURL}/` });
    expect(index.headers['cache-control']).toBe('no-cache');
    const script = /(?:src|href)="([^"]*-[A-Z0-9]{8}\.(?:js|css))"/.exec(index.text())?.[1];
    expect(script, 'a content-hashed file is referenced by the Regie index.html').toBeDefined();
    const hashed = await send({ method: 'GET', url: `${config.baseURL}/${script!.replace(/^\//, '')}`, headers: { 'Accept-Encoding': 'gzip' } });
    expect(hashed.status).toBe(200);
    expect(hashed.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(hashed.headers['content-security-policy']).toBeDefined();
    for (const route of ['/join/ngsw.json', '/join/ngsw-worker.js', '/join/index.html']) {
      const response = await send({ method: 'GET', url: `${config.baseURL}${route}` });
      expect(response.headers['cache-control'], route).toBe('no-cache');
    }
    const missing = await send({ method: 'GET', url: `${config.baseURL}/main-ZZZZZZZZ.js` });
    expect(missing.status).toBe(404);
    expect(missing.headers['cache-control']).toBe('no-store');
    expect(missing.headers['strict-transport-security'], 'error responses keep the base headers').toBeDefined();
  });

  test('E2E-AUTH-10 [headers] only the output may be framed, and only by the configured origins', t.p0, async ({ config, production }) => {
    const out = await send({ method: 'GET', url: `${config.baseURL}/o/${production.slug}?k=${production.outputKey}` });
    expect(parseCsp(out.headers['content-security-policy']!)['frame-ancestors']).toEqual(["'self'", 'https://embed.e2e.test', 'https://embed.test']);
    for (const route of ['/', '/join/', '/login', '/monitoring']) {
      const response = await send({ method: 'GET', url: `${config.baseURL}${route}` });
      expect(parseCsp(response.headers['content-security-policy']!)['frame-ancestors'], route).toEqual(["'none'"]);
    }
  });

  test('E2E-AUTH-10 embedding from an allowed and from a foreign origin in a real browser', t.p0, async ({ page, config, production }) => {
    const embedded = `${config.baseURL}/o/${production.slug}?k=${production.outputKey}`;
    for (const origin of ['https://embed.e2e.test', 'https://other.e2e.test']) {
      await page.route(`${origin}/**`, (route) =>
        route.fulfill({
          status: 200,
          contentType: 'text/html',
          body: `<!doctype html><title>host</title><iframe id="out" src="${embedded}" allow="autoplay; fullscreen" style="width:640px;height:360px"></iframe><iframe id="reg" src="${config.baseURL}/" style="width:300px;height:200px"></iframe><iframe id="join" src="${config.baseURL}/join/" style="width:300px;height:200px"></iframe>`,
        }),
      );
    }
    const violations: string[] = [];
    page.on('console', (message) => {
      if (/frame-ancestors|Refused to frame/i.test(message.text())) violations.push(message.text());
    });

    const urls = () => page.frames().map((frame) => frame.url());
    const isOutput = (url: string) => url.startsWith(`${config.baseURL}/o/`);
    const isBlocked = (url: string) => url.startsWith('chrome-error://');

    await page.goto('https://embed.e2e.test/');
    // Allowed origin: the output loads; Regie and sender frames are blocked (frame-ancestors 'none').
    await expect.poll(() => urls().some(isOutput), { timeout: 15_000, message: `output frame loads for the allowed origin: ${urls().join(' | ')}` }).toBe(true);
    await expect.poll(() => urls().filter(isBlocked).length, { timeout: 15_000, message: `Regie and sender frames are refused: ${urls().join(' | ')}` }).toBeGreaterThanOrEqual(2);
    expect(urls().some((url) => url === `${config.baseURL}/` || url === `${config.baseURL}/join/`), 'Regie and sender are never framed').toBe(false);

    // Foreign origin: nothing of ours loads in any frame.
    await page.goto('https://other.e2e.test/');
    await expect.poll(() => urls().filter(isBlocked).length, { timeout: 15_000, message: `all three frames are refused: ${urls().join(' | ')}` }).toBeGreaterThanOrEqual(3);
    expect(urls().some(isOutput), `output frame must be blocked for a foreign origin: ${urls().join(' | ')}`).toBe(false);
    expect(violations.length, 'the browser reported refused frames').toBeGreaterThan(0);
  });

  test('E2E-AUTH-19 HTTP is redirected to HTTPS and no cookie is ever set over HTTP', t.p2, async ({ config }) => {
    const base = `http://${config.host}${config.httpPort === 80 ? '' : `:${config.httpPort}`}`;
    const root = await send({ method: 'GET', url: `${base}/`, headersOnly: true });
    expect([301, 308, 302, 307]).toContain(root.status);
    expect(root.headers['location']).toMatch(/^https:\/\/localhost(:\d+)?\//);
    const login = await send({ method: 'POST', url: `${base}/api/auth/login`, json: config.admin, headersOnly: true });
    expect([301, 308, 302, 307]).toContain(login.status);
    expect(login.setCookies, 'no cookie over HTTP').toHaveLength(0);
    const https = await send({ method: 'GET', url: `${config.baseURL}/` });
    expect(https.headers['strict-transport-security']).toContain('max-age=');
  });

  test('E2E-AUTH-20 TLS 1.0 and 1.1 are refused, TLS 1.3 is negotiated by default', t.p2, async ({ config }) => {
    const connect = (options: tls.ConnectionOptions) =>
      new Promise<{ ok: boolean; version?: string; error?: string }>((resolve) => {
        const socket = tls.connect({ host: 'localhost', port: config.httpsPort, servername: 'localhost', rejectUnauthorized: false, ...options }, () => {
          const version = socket.getProtocol() ?? undefined;
          socket.destroy();
          resolve({ ok: true, version });
        });
        socket.on('error', (error) => resolve({ ok: false, error: error.message }));
        socket.setTimeout(8000, () => {
          socket.destroy();
          resolve({ ok: false, error: 'timeout' });
        });
      });
    expect((await connect({ maxVersion: 'TLSv1.1' })).ok, 'TLS <= 1.1').toBe(false);
    const tls12 = await connect({ minVersion: 'TLSv1.2', maxVersion: 'TLSv1.2' });
    expect(tls12.ok, `TLS 1.2: ${tls12.error}`).toBe(true);
    const normal = await connect({});
    expect(normal.version).toBe('TLSv1.3');
  });

  test('E2E-AUTH-21 header injection and redirects: /j/* only redirects to /join/i/<token>', t.p1, async ({ config }) => {
    const ok = await send({ method: 'GET', url: `${config.baseURL}/j/abc_DEF-123` });
    expect(ok.status).toBe(302);
    expect(ok.headers['location']).toBe('/join/i/abc_DEF-123');
    for (const route of ['/j/abc%0d%0aSet-Cookie:x=1', '/j/..%2f..%2fapi', '/j/abc/def', '/join/i/%00', '/j/%0d%0aLocation:%20https://evil.example', '//evil.example/', '/\\evil.example']) {
      const response = await send({ method: 'GET', url: `${config.baseURL}${route}` });
      const label = `${route} -> ${response.status}`;
      expect(response.setCookies, `${label} no injected cookie`).toHaveLength(0);
      for (let index = 0; index < response.rawHeaders.length; index += 2) {
        expect(response.rawHeaders[index]! + response.rawHeaders[index + 1]!, label).not.toMatch(/[\r\n]/);
      }
      const location = response.headers['location'];
      if (location) {
        expect(location, `${label} stays on the own origin`).toMatch(/^\/(?!\/)|^https:\/\/localhost/);
        expect(location, label).not.toMatch(/evil\.example/);
      }
      expect(response.status, label).toBeLessThan(500);
    }
    // Raw request line with an encoded CRLF inside the token.
    const raw = await rawRequest({ host: 'localhost', port: config.httpsPort, tls: true, bytes: `GET /j/abc%0d%0aX-Injected:%201 HTTP/1.1${CRLF}Host: localhost${CRLF}Connection: close${CRLF}${CRLF}`, readMs: 2000 });
    expect(raw.headersText.toLowerCase()).not.toContain('x-injected');
    expect(stackConfig().host).toBe('localhost');
  });
});
