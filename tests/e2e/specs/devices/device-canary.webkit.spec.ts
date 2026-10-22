import { expect, test } from '../../support/fixtures';
import { t } from '../../support/tags';

/**
 * E2E-DEV-00 for the webkit project: UI only. WebKit on Windows has no usable WebRTC (research 2026-10-22), so no
 * media is tested here; the project proves that the pages load and lay out without horizontal scroll in Safari's
 * engine. Whether WebRTC exists is recorded, not asserted.
 *
 * WebKit on Windows resolves "localhost" to ::1, where Docker Desktop accepts the connection and never answers, so the
 * pages are opened under https://127.0.0.1 (the stack serves that address as an extra host, see support/env.ts).
 */

test.describe('device canary (WebKit, UI only)', () => {
  for (const route of ['/', '/join/']) {
    test(`E2E-DEV-00 [webkit] ${route} loads over HTTPS without horizontal scroll`, t.p2, async ({ page, config, browserName }, testInfo) => {
      expect(browserName).toBe('webkit');
      const base = config.baseURL.replace('//localhost', '//127.0.0.1');
      const response = await page.goto(`${base}${route}`);
      expect(response?.status(), `${route} is served`).toBeLessThan(400);
      const facts = await page.evaluate(() => ({
        title: document.title,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        webrtc: typeof RTCPeerConnection,
        secure: window.isSecureContext,
      }));
      testInfo.annotations.push({ type: 'webkit', description: JSON.stringify(facts) });
      expect(facts.secure).toBe(true);
      expect(facts.overflow, 'no horizontal scroll').toBeLessThanOrEqual(0);
    });
  }
});
