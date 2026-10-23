import { chromium } from '@playwright/test';
import { CHROMIUM_ARGS } from '../../support/fake-media';
import { pairLaptopViaKnock } from '../../support/devices/pairing';
import { readPlaces } from '../../support/devices/places';
import { pairViaApi } from '../../support/ui/pairing';
import { LaptopSender } from '../../support/ui/sender';
import { expect, test } from '../../support/ui/fixtures';
import { t } from '../../support/tags';

/**
 * DEV-12 (the laptop sender in desktop browsers: Chromium and Edge here, Firefox in dev-laptop.firefox.spec.ts) and DEV-21 (PWA
 * and service worker of the sender), docs/testing.md 2.8.
 */

for (const browserName of ['chromium', 'edge'] as const) {
  test(
    `E2E-DEV-12 [ui, ${browserName}] the laptop sender: pair by check code, share a screen, a second screen, end and share again, the camera; the platform text, the battery value and a quiet console`,
    t.p1,
    async ({ regie, browser, api, production, onCleanup }, testInfo) => {
      test.setTimeout(240_000);
      let senderBrowser = browser;
      if (browserName === 'edge') {
        try {
          senderBrowser = await chromium.launch({ channel: 'msedge', args: CHROMIUM_ARGS });
        } catch (error) {
          test.skip(true, `Microsoft Edge cannot be launched here: ${(error as Error).message.split('\n')[0]}`);
          return;
        }
        onCleanup(() => senderBrowser.close());
      }
      // Edge keeps its own user agent (the descriptor of the desktop profile would make it «Chrome»).
      const laptop = await LaptopSender.open(senderBrowser, browserName === 'edge' ? { context: { userAgent: undefined } } : {});
      onCleanup(() => laptop.close());
      const paired = await pairLaptopViaKnock(regie, laptop, 'Laptop Mia');
      expect(paired.checkCode).toMatch(/^\d{2} \d{2}$/);

      await laptop.shareScreen();
      await laptop.waitForSlot('screen-1', 'live', 30_000);
      await laptop.addScreen();
      await laptop.waitForSlot('screen-2', 'live', 30_000);
      await laptop.browserStopsSharing(1);
      await laptop.waitForSlot('screen-2', 'ended', 15_000);
      await laptop.reshare('screen-2');
      await laptop.waitForSlot('screen-2', 'live', 30_000);
      await laptop.addCamera();
      await laptop.waitForSlot('camera', 'live', 30_000);

      const snapshot = (await api.getSnapshot(production.id)).body;
      expect(snapshot.sources.filter((source) => source.deviceId === paired.stored.deviceId).map((source) => `${source.code} ${source.label}`).sort()).toEqual(['K1 Laptop Mia · Kamera', 'S1 Laptop Mia · Screen 1', 'S2 Laptop Mia · Screen 2']);
      const device = snapshot.devices[0]!;
      testInfo.annotations.push({ type: 'device', description: `${browserName}: platform «${device.platform}», battery ${device.telemetry?.batteryPct ?? 'none'}` });
      expect(device.platform, 'platform text').toMatch(/^Windows · (Chrome|Edge)$/);
      if (browserName === 'edge') expect(device.platform).toBe('Windows · Edge');
      // Chromium and Edge have the Battery API: the Regie shows the «Akku» row once the first report has arrived.
      const row = regie.page.locator(`.c-st[data-device="${paired.stored.deviceId}"]`);
      await row.locator('.c-st__row').click();
      await expect(row.locator('.c-st__kv')).toContainText(/Akku\s*\d+ %/, { timeout: 15_000 });
      await expect.poll(async () => (await readPlaces(regie.page)).stations[0]?.tone, { message: 'no outage', timeout: 5000 }).toBe('');
      expect(laptop.problems.pageErrors, 'no uncaught error').toEqual([]);
      expect(laptop.problems.cspViolations, 'no CSP violation').toEqual([]);
      expect(laptop.problems.consoleErrors.filter((text) => !/Failed to load resource/.test(text)), 'no console error').toEqual([]);
    },
  );
}

test.describe('DEV sender, PWA', () => {
  test(
    'E2E-DEV-21 [ui] PWA and service worker of the sender: manifest, icons, a worker scoped to /join/, the shell offline, no API, hub or media request in the cache, ngsw.json not cached',
    t.p1,
    async ({ openPhone, pairContext, config }) => {
      test.setTimeout(180_000);
      const phone = await openPhone({ profile: 'pixel7' });
      const page = phone.page;
      // The manifest.
      const manifestResponse = await page.request.get(`${config.baseURL}/join/manifest.webmanifest`);
      expect(manifestResponse.status()).toBe(200);
      const manifest = (await manifestResponse.json()) as { name: string; short_name?: string; scope: string; start_url: string; display: string; theme_color: string; icons: Array<{ src: string; sizes: string; type?: string; purpose?: string }> };
      expect(manifest.name).toBe('StudioFlow Sender');
      // Relative values ("./") resolve against the manifest URL /join/manifest.webmanifest.
      const manifestUrl = `${config.baseURL}/join/manifest.webmanifest`;
      expect(new URL(manifest.scope, manifestUrl).pathname, 'scope').toBe('/join/');
      expect(new URL(manifest.start_url, manifestUrl).pathname, 'start_url').toBe('/join/');
      expect(manifest.display).toBe('standalone');
      expect(manifest.theme_color.toLowerCase()).toBe('#0d1117');
      const sizes = manifest.icons.map((icon) => icon.sizes);
      expect(sizes, '192 and 512 px icons').toEqual(expect.arrayContaining(['192x192', '512x512']));
      expect(manifest.icons.some((icon) => (icon.purpose ?? '').includes('maskable')), 'a maskable icon').toBe(true);
      for (const icon of manifest.icons) {
        const response = await page.request.get(new URL(icon.src, `${config.baseURL}/join/`).toString());
        expect(response.status(), `icon ${icon.src}`).toBe(200);
        expect(response.headers()['content-type'] ?? '', `icon ${icon.src} type`).toMatch(/^image\//);
      }
      // ngsw.json is never cached.
      const ngsw = await page.request.get(`${config.baseURL}/join/ngsw.json`);
      expect(ngsw.status()).toBe(200);
      expect(ngsw.headers()['cache-control'] ?? '', 'ngsw.json cache control').toMatch(/no-cache|no-store|max-age=0/);

      // A paired phone, so the shell and the station can be loaded offline.
      const device = await (await import('../../support/production')).pairPhone(pairContext, { name: 'Handy PWA' });
      await phone.seedCredentials(device.credentials);
      await phone.gotoStart();
      await phone.waitConnected();
      // Angular registers the worker once the app is stable (at the latest after 30 s).
      await expect
        .poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).map((registration) => ({ scope: registration.scope, script: (registration.active ?? registration.installing ?? registration.waiting)?.scriptURL ?? null }))), { message: 'the service worker is registered', timeout: 60_000, intervals: [1000] })
        .toEqual([{ scope: `${config.baseURL}/join/`, script: `${config.baseURL}/join/ngsw-worker.js` }]);
      await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
      // Wait until the worker has cached the shell (index and the scripts).
      const listCache = () =>
        page.evaluate(async () => {
          const urls: string[] = [];
          for (const name of await caches.keys()) for (const request of await (await caches.open(name)).keys()) urls.push(request.url);
          return urls;
        });
      await expect.poll(async () => (await listCache()).some((url) => /\/join\/(index\.html)?$|\/join\/main[-.]/.test(url)), { message: 'the worker cached index.html and the main script', timeout: 90_000, intervals: [1000] }).toBe(true);
      const cached = await listCache();
      await test.info().attach('sw-cache.txt', { body: cached.join('\n'), contentType: 'text/plain' });
      expect(cached.length, 'the app shell is cached').toBeGreaterThan(3);
      expect(cached.filter((url) => /\/(api|hubs|rtc)(\/|\?|$)/.test(new URL(url).pathname)), 'no API, hub or media request in the cache').toEqual([]);

      // Offline: the shell loads and the station says that it is offline.
      await page.context().setOffline(true);
      await page.reload();
      await expect(page.locator('sf-root, main').first()).toBeVisible({ timeout: 20_000 });
      await expect(page.locator('[data-testid=connection-state]').first()).toContainText(/Offline|Verbindet neu/, { timeout: 20_000 });
      await expect(page.getByText(/Offline: keine Netzwerkverbindung/)).toBeVisible();
      await page.context().setOffline(false);
      await phone.waitConnected(40_000);
      // And the unpaired shell works offline too.
      await page.evaluate(() => localStorage.removeItem('studioflow.sender.v1'));
      await page.context().setOffline(true);
      await page.goto('/join/');
      await expect(page.getByRole('heading', { name: 'Gerät koppeln' })).toBeVisible({ timeout: 20_000 });
      await page.context().setOffline(false);
      expect(pairViaApi).toBeDefined();
    },
  );
});
