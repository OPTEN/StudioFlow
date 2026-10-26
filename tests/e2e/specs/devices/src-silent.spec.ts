import { chromium, type Browser } from '@playwright/test';
import { THRESHOLD } from '../../support/constants';
import { CutProxy } from '../../support/devices/cut-proxy';
import { FULL, logTexts, putInScene } from '../../support/devices/fleet';
import { readPlaces, waitForOutage, waitForRecovered } from '../../support/devices/places';
import { CHROMIUM_ARGS } from '../../support/fake-media';
import { sleep } from '../../support/shell';
import { PhoneSender } from '../../support/ui/sender';
import { pairViaApi } from '../../support/ui/pairing';
import { expect, test } from '../../support/ui/fixtures';
import { t } from '../../support/tags';

/**
 * SRC-02 with a SILENT outage (T-DETECT-SILENT): the phone's browser context talks to the stack through a proxy that can swallow
 * every byte without closing a socket (support/devices/cut-proxy.ts). The device hub then stops answering: the API notices
 * after its client timeout (5 s), the phone's own SignalR client after its server timeout (5 s). The method needs its own
 * Chromium (per-context proxies need the browser to be launched with a proxy) with the loopback bypass switched off.
 */

async function proxyBrowser(): Promise<Browser> {
  return chromium.launch({ args: [...CHROMIUM_ARGS, '--proxy-bypass-list=<-loopback>'], proxy: { server: 'http://per-context' } });
}

test.describe('SRC silent outage', () => {
  test(
    'E2E-SRC-02 [ui, silent] packets that silently stop: the outage shows in all six places within T-DETECT-SILENT (target 5 s, hard 6.5 s), the phone recovers by itself',
    t.p0,
    async ({ regie, pairContext, api, production, onCleanup }, testInfo) => {
      test.setTimeout(240_000);
      const proxy = await new CutProxy().start();
      onCleanup(() => proxy.stop());
      const browser = await proxyBrowser();
      onCleanup(() => browser.close());
      const phone = await PhoneSender.open(browser, { profile: 'pixel7', context: { proxy: { server: proxy.url } } });
      onCleanup(() => phone.close());
      const device = await pairViaApi(pairContext, phone, { name: 'Phone Proxy' });
      await phone.waitForCamera('live', 45_000);
      expect(proxy.tunnels, 'the phone talks through the proxy').toBeGreaterThan(0);
      await putInScene(api, production, 0, device.sourceId('camera'), FULL);
      await expect.poll(async () => (await readPlaces(regie.page)).stations[0]?.line ?? '', { timeout: 20_000 }).toMatch(/Mbit\/s/);
      await sleep(2000);

      const startedAt = Date.now();
      proxy.blackhole();
      const outage = await waitForOutage(regie, 'K1', 'reconnecting', { startedAt, timeoutMs: 20_000 });
      testInfo.annotations.push({ type: 'measurement', description: `T-DETECT-SILENT (hub traffic swallowed -> six places): ${outage.elapsedMs} ms (target 5000, hard ${THRESHOLD.detectSilentHardMs})` });
      await testInfo.attach('detect-silent.json', { body: JSON.stringify({ elapsedMs: outage.elapsedMs, droppedBytes: proxy.dropped, detail: outage.check.detail }, null, 2), contentType: 'application/json' });
      expect(outage.elapsedMs, 'T-DETECT-SILENT hard limit 6.5 s').toBeLessThanOrEqual(THRESHOLD.detectSilentHardMs);
      expect(outage.elapsedMs, 'a silent loss is not detected before the client timeout can have elapsed').toBeGreaterThan(2000);
      expect(await logTexts(api, production)).toContain('K1 reconnecting');

      // The phone notices as well (its server timeout is 5 s): “Reconnecting…”.
      await expect(phone.connectionState().first()).toHaveAttribute('data-state', /reconnecting|offline/, { timeout: 15_000 });

      // The path comes back: new connections work, the phone returns by itself.
      await sleep(4000);
      const resumedAt = Date.now();
      proxy.resume();
      await phone.waitForConnection('connected', 60_000);
      await waitForRecovered(regie, 'K1', { timeoutMs: 60_000 });
      testInfo.annotations.push({ type: 'measurement', description: `recovery after a silent outage of about ${Math.round((resumedAt - startedAt) / 1000)} s: path back -> “back” ${Date.now() - resumedAt} ms` });
    },
  );
});
