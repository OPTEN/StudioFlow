import { PhoneSender, describeDevice, type DeviceProfile } from '../../support/ui';
import { expect, test } from '../../support/ui/fixtures';
import { t } from '../../support/tags';

/**
 * H-UI-10 - the sender fixtures in the context of a mobile Playwright project (pixel-7, iphone-15, ipad on Chromium,
 * playwright.config.ts): `PhoneSender.inContext` wraps a page of the project's own context, which the UI `context`
 * fixture already equipped (test hooks flag, init script, fake media).
 */

const PROFILE_OF_PROJECT: Record<string, DeviceProfile> = {
  'pixel-7': 'pixel7',
  'iphone-15': 'iphone15',
  ipad: 'iphone15',
};
const USER_AGENT_OF_PROJECT: Record<string, RegExp> = {
  'pixel-7': /Android/,
  'iphone-15': /iPhone/,
  ipad: /iPad|Macintosh/,
};

test.describe('UI fixtures (mobile projects)', () => {
  test(
    'H-UI-10 [mobile] a phone page of the project context pairs by invite link and its camera goes live',
    t.with('@p1', '@ui-fixture', '@harness'),
    async ({ context, api, production, isMobile }, testInfo) => {
      test.setTimeout(90_000);
      expect(isMobile, `project ${testInfo.project.name} emulates a mobile device`).toBe(true);
      const profile = PROFILE_OF_PROJECT[testInfo.project.name] ?? 'pixel7';
      const phone = await PhoneSender.inContext(context, profile);
      const invite = (await api.getPhoneInvite(production.id)).body.url;
      await phone.gotoInvite(invite);
      await phone.waitConnected();
      await phone.waitForCamera('live');
      const device = await describeDevice(phone);
      expect(device.touchPoints, 'touch').toBeGreaterThan(0);
      expect(device.userAgent, `user agent of the ${testInfo.project.name} project`).toMatch(
        USER_AGENT_OF_PROJECT[testInfo.project.name] ?? /./,
      );
      expect(phone.problems.pageErrors).toEqual([]);
    },
  );
});
