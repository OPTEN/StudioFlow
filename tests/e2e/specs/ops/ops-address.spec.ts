import type { ConsoleMessage } from '@playwright/test';
import { AdminApi, OutputApi } from '../../support/api';
import { expect, test } from '../../support/fixtures';
import { parseCsp } from '../../support/parse';
import { send } from '../../support/http';
import { RegiePage } from '../../support/ui/regie';
import { t } from '../../support/tags';

/**
 * OPS - the server is reached by more than one name (docs/testing.md 2.11, issue 44): the domain of the settings, the IP
 * address of the machine, 127.0.0.1. Everything the page needs to connect to must be on the address it was opened with: the
 * LiveKit URL in the token (E2E-OPS-42) and the Content-Security-Policy that allows the connection.
 */

test.describe('OPS the address of the page', () => {
  test('E2E-OPS-42 [api] the LiveKit URL of every token is the address the caller used, whatever name or IP that is', t.p0, async ({ config, production }) => {
    const origins = [config.baseURL, `https://127.0.0.1:${config.httpsPort}`, `https://${config.nodeIp}:${config.httpsPort}`];
    for (const origin of origins) {
      const expected = `wss://${new URL(origin).host}`;
      const admin = await AdminApi.login(origin, config.admin);
      const studio = await admin.getStudioLiveKitToken(production.id);
      expect(studio.status, studio.raw.text()).toBe(200);
      expect(studio.body.url, `the Regie opened by ${origin}`).toBe(expected);

      // The output page and the sender are opened by the address of the proxy or the phone, the same rule applies.
      const output = new OutputApi(origin, production.slug, production.outputKey);
      const viewer = await output.getOutputLiveKitToken();
      expect(viewer.status, viewer.raw.text()).toBe(200);
      expect(viewer.body.url, `the output opened by ${origin}`).toBe(expected);
    }
  });

  test('E2E-OPS-42 [csp] every page names the address it was opened with in connect-src, so the LiveKit URL is allowed', t.p0, async ({ config }) => {
    for (const origin of [config.baseURL, `https://127.0.0.1:${config.httpsPort}`, `https://${config.nodeIp}:${config.httpsPort}`]) {
      const host = new URL(origin).host;
      for (const path of ['/', '/join/', '/o/webinar?k=x']) {
        const response = await send({ method: 'GET', url: `${origin}${path}` });
        expect(response.status, `${origin}${path}`).toBeLessThan(400);
        const csp = parseCsp(response.headers['content-security-policy'] ?? '');
        expect(csp['connect-src'], `${origin}${path}`).toEqual(expect.arrayContaining(["'self'", `https://${host}`, `wss://${host}`]));
      }
    }
  });

  test('E2E-OPS-42 [regie ui] the Regie opened by the IP address connects to LiveKit on that address and no Content-Security-Policy blocks it', t.p0, async ({ config, context, production }) => {
    const origin = `https://127.0.0.1:${config.httpsPort}`;
    const admin = await AdminApi.login(origin, config.admin);
    await RegiePage.injectSession(context, admin.cookie, { ...config, baseURL: origin, host: '127.0.0.1' });
    const page = await context.newPage();
    const sockets: string[] = [];
    page.on('websocket', (socket) => sockets.push(socket.url()));
    const problems: string[] = [];
    const watch = (message: ConsoleMessage) => {
      if (/content security policy|securityerror|refused to connect/i.test(message.text())) problems.push(message.text());
    };
    page.on('console', watch);
    await page.addInitScript(() => {
      (window as unknown as { __csp: string[] }).__csp = [];
      document.addEventListener('securitypolicyviolation', (event) => (window as unknown as { __csp: string[] }).__csp.push(`${event.violatedDirective} ${event.blockedURI}`));
    });

    await page.goto(`${origin}/`);
    await new RegiePage(page, { ...config, baseURL: origin, host: '127.0.0.1' }).waitReady();
    await expect
      .poll(() => sockets.some((url) => url.startsWith(`wss://127.0.0.1:${config.httpsPort}/rtc`)), { timeout: 30_000, message: `the Regie opens a LiveKit connection on ${origin} (sockets: ${sockets.join(', ')})` })
      .toBe(true);
    expect(sockets.filter((url) => url.includes('/rtc') && !url.startsWith(`wss://127.0.0.1:${config.httpsPort}/`)), 'no LiveKit connection to another name').toEqual([]);
    expect(await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp), 'no Content-Security-Policy violation').toEqual([]);
    expect(problems).toEqual([]);
    expect(production.id).toBeTruthy();
  });
});
