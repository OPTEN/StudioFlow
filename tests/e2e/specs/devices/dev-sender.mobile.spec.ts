import { FULL, putInScene } from '../../support/devices/fleet';
import { expectNoOverflow, readTargets, smallTargets } from '../../support/devices/layout';
import { sleep } from '../../support/shell';
import { PhoneSender, describeDevice, type DeviceProfile } from '../../support/ui';
import { expect, test } from '../../support/ui/fixtures';
import { t } from '../../support/tags';

/**
 * The sender in the context of the mobile Playwright projects (pixel-7, iphone-15, ipad on Chromium, playwright.config.ts):
 * DEV-07 / DEV-08 / DEV-09 with the device the project emulates. `context` is the project's own context (touch, mobile, pixel
 * ratio, user agent) with the UI init; the pages of this spec run in it.
 */

const PROFILE_OF_PROJECT: Record<string, DeviceProfile> = { 'pixel-7': 'pixel7', 'iphone-15': 'iphone15', ipad: 'iphone15' };

test.describe('DEV sender, mobile projects', () => {
  test(
    'E2E-DEV-07 [mobile] the project device pairs by QR link, the camera goes live, the tally frame surrounds the viewport, rotation keeps the picture, no horizontal scroll, targets of 44 px',
    t.p1,
    async ({ context, regie, api, production, isMobile, hasTouch, viewport }, testInfo) => {
      test.setTimeout(120_000);
      expect(isMobile, `project ${testInfo.project.name} emulates a mobile device`).toBe(true);
      expect(hasTouch).toBe(true);
      const profile = PROFILE_OF_PROJECT[testInfo.project.name] ?? 'pixel7';
      const phone = await PhoneSender.inContext(context, profile);
      const invite = (await api.getPhoneInvite(production.id)).body.url;
      await phone.gotoInvite(invite);
      await phone.waitConnected();
      await phone.waitForCamera('live', 45_000);
      const facts = await describeDevice(phone);
      testInfo.annotations.push({ type: 'device', description: `${testInfo.project.name}: ${viewport!.width}x${viewport!.height}, ${facts.userAgent.slice(0, 60)}` });
      expect(facts.width, 'the viewport of the project').toBe(viewport!.width);
      await expectNoOverflow(phone.page, `${testInfo.project.name} station`);
      expect(smallTargets(await readTargets(phone.page)).map((target) => `${target.tag} ${target.label} ${target.width}x${target.height}`)).toEqual([]);

      // K1 in the program scene and on air: the red frame covers the whole viewport, also after a rotation.
      const sourceId = `${(await phone.waitForStoredDevice()).deviceId}/camera`;
      await putInScene(api, production, 0, sourceId, FULL);
      await api.startBroadcast(production.id);
      await phone.waitForTally('program');
      for (const size of [{ width: viewport!.height, height: viewport!.width }, { width: viewport!.width, height: viewport!.height }]) {
        await phone.page.setViewportSize(size);
        await sleep(300);
        const frame = await phone.page.evaluate(() => {
          const element = document.querySelector('[data-testid=tally]') as HTMLElement;
          const box = element.getBoundingClientRect();
          return { covers: box.width >= window.innerWidth - 1 && box.height >= window.innerHeight - 1, shadow: getComputedStyle(element).boxShadow };
        });
        expect(frame.covers, `the tally frame covers ${size.width}x${size.height}`).toBe(true);
        expect(frame.shadow).toContain('rgb(248, 81, 73)');
        await expectNoOverflow(phone.page, `${testInfo.project.name} ${size.width}x${size.height}`);
        expect(await phone.cameraState(), 'the camera keeps sending through the rotation').toBe('live');
      }
      void regie;
    },
  );
});
