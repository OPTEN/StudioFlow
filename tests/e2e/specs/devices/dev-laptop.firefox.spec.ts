import { chromium } from '@playwright/test';
import { CHROMIUM_ARGS } from '../../support/fake-media';
import { installEndedShim, stopSharingInFirefox } from '../../support/devices/firefox-stop';
import { openPairingTab } from '../../support/devices/pairing';
import { readPlaces } from '../../support/devices/places';
import { newUiContext } from '../../support/ui/init';
import { RegiePage } from '../../support/ui/regie';
import { LaptopSender } from '../../support/ui/sender';
import { expect, test } from '../../support/ui/fixtures';
import { t } from '../../support/tags';

/**
 * Desktop Firefox as a sender (docs/testing.md DEV-12, PAIR-15, PAIR-03): the fake camera comes from the launch prefs
 * (FIREFOX_PREFS), the screen from the canvas override of the UI init (Firefox has no tab capture flag), LiveKit needs the LAN
 * address as the node IP for ICE (the harness detects it). The Regie runs in Chromium: it is another browser than the sender
 * of this project.
 */

test.describe('Firefox as a sender', () => {
  test(
    'E2E-DEV-12 [firefox] the laptop sender in Firefox: kind detection, pair by check code, share, a second screen, end and share again, the camera; “Windows · Firefox”, no battery value',
    t.p1,
    async ({ context, api, production, config, browserName, onCleanup }, testInfo) => {
      test.setTimeout(240_000);
      expect(browserName).toBe('firefox');
      testInfo.annotations.push({ type: 'node-ip', description: config.nodeIp });
      // The Regie in Chromium.
      const regieBrowser = await chromium.launch({ args: CHROMIUM_ARGS });
      onCleanup(() => regieBrowser.close());
      const regieContext = await newUiContext(regieBrowser);
      const regie = await RegiePage.open(regieContext, { login: 'api', cookie: api.cookie });

      await installEndedShim(context); // Firefox ignores a script-dispatched `ended` (support/devices/firefox-stop.ts)
      const laptop = await LaptopSender.inContext(context, 'desktop');
      await laptop.gotoStart();
      expect(await laptop.defaultKind(), 'Firefox has getDisplayMedia: laptop by default').toBe('laptop');
      await laptop.submitPairingForm('Laptop Fox', 'laptop');
      const code = await laptop.checkCode();
      await openPairingTab(regie, 'laptop');
      expect(await regie.knockCheckCode('Laptop Fox')).toBe(code);
      await regie.approveKnock('Laptop Fox');
      await laptop.waitConnected(40_000);
      const stored = await laptop.waitForStoredDevice();

      await laptop.shareScreen();
      await laptop.waitForSlot('screen-1', 'live', 40_000);
      await laptop.addScreen();
      await laptop.waitForSlot('screen-2', 'live', 40_000);
      expect((await laptop.mediaCalls()).display, 'two prompts: the canvas override ran').toBe(2);
      expect(await stopSharingInFirefox(laptop.page, 1), 'Stop sharing of screen 2').toBe(true);
      await laptop.waitForSlot('screen-2', 'ended', 15_000);
      await laptop.reshare('screen-2');
      await laptop.waitForSlot('screen-2', 'live', 40_000);
      await laptop.addCamera();
      await laptop.waitForSlot('camera', 'live', 40_000);

      const snapshot = (await api.getSnapshot(production.id)).body;
      const device = snapshot.devices[0]!;
      testInfo.annotations.push({ type: 'device', description: `firefox: platform “${device.platform}”, battery ${device.telemetry?.batteryPct ?? 'none'}, network ${device.telemetry?.network ?? 'none'}` });
      expect(device.platform, 'platform text').toMatch(/^[\w .()-]+ · Firefox$/);
      expect(snapshot.sources.filter((source) => source.deviceId === stored.deviceId).map((source) => source.code).sort()).toEqual(['K1', 'S1', 'S2']);
      // Firefox has no Battery API: no value, not “0%”.
      expect(device.telemetry?.batteryPct ?? null, 'no battery value in Firefox').toBeNull();
      const row = regie.page.locator(`.c-st[data-device="${stored.deviceId}"]`);
      await row.locator('.c-st__row').click();
      await expect(row.locator('.c-st__kv')).toContainText('Device');
      await expect(row.locator('.c-st__kv'), 'no “Battery” row').not.toContainText('Battery');
      await expect.poll(async () => (await readPlaces(regie.page)).stations[0]?.tone, { message: 'no outage', timeout: 5000 }).toBe('');
      expect(laptop.problems.pageErrors, 'no uncaught error').toEqual([]);
      expect(laptop.problems.cspViolations, 'no CSP violation').toEqual([]);
    },
  );
});
