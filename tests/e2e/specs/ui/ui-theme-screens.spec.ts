import path from 'node:path';
import type { Page } from '@playwright/test';
import { openBusyRegie, settle } from '../../support/a11y/regie-setup';
import { newUiContext } from '../../support/ui';
import { expect, test } from '../../support/ui/fixtures';

/**
 * Screenshot set of both themes (.impeccable/review/themes/), for the design review of issue #10. Not a test of
 * behaviour: it only runs with `E2E_THEME_SCREENSHOTS=1` and writes one PNG per view, theme and viewport:
 * `<view>-<theme>-<width>x<height>.png`.
 *
 *   E2E_THEME_SCREENSHOTS=1 E2E_REUSE_STACK=1 tests/e2e/stack.sh test 3 --project=desktop-chromium specs/ui/ui-theme-screens.spec.ts
 */

const OUTPUT = path.resolve(__dirname, '../../../../.impeccable/review/themes');
const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
] as const;
/** The system prefers the other theme, so a view only follows the stored choice. System itself shows one of the two. */
const APPEARANCES = [
  { name: 'dark', system: 'light' },
  { name: 'light', system: 'dark' },
] as const;

test.skip(!process.env['E2E_THEME_SCREENSHOTS'], 'set E2E_THEME_SCREENSHOTS=1 to write the screenshot set');

async function shoot(page: Page, view: string, appearance: string, size: { width: number; height: number }): Promise<void> {
  await settle(page);
  await page.screenshot({ path: path.join(OUTPUT, `${view}-${appearance}-${size.width}x${size.height}.png`) });
}

for (const size of VIEWPORTS) {
  test(`theme screenshots at ${size.width}x${size.height}`, async ({ openRegie, pairContext, onCleanup, browser }) => {
    test.setTimeout(240_000);
    const { regie } = await openBusyRegie({ openRegie, pairContext, onCleanup }, { viewport: size, incident: 'reconnecting', studio: true });
    const { page } = regie;
    const visitor = await (await newUiContext(browser, { context: { viewport: size } })).newPage();
    onCleanup(() => visitor.context().close());
    await visitor.goto('/login');

    for (const appearance of APPEARANCES) {
      for (const target of [page, visitor]) {
        await target.emulateMedia({ colorScheme: appearance.system });
        await target.evaluate(([key, value]) => localStorage.setItem(key!, value!), ['studioflow.theme', appearance.name]);
      }
      await page.goto('/');
      await expect(page.locator('.c-status__inc.is-warn')).toBeVisible();
      await shoot(page, 'regie-studio', appearance.name, size);

      await page.locator('[aria-controls="sf-pop-settings"]').click();
      await shoot(page, 'regie-settings', appearance.name, size);
      await page.keyboard.press('Escape');

      await regie.setStudioMode(false);
      await shoot(page, 'regie-direct', appearance.name, size);
      await regie.setStudioMode(true);

      await page.goto('/monitoring');
      await expect(page.getByRole('main')).toBeVisible();
      await shoot(page, 'monitoring', appearance.name, size);

      await visitor.goto('/login');
      await shoot(visitor, 'login', appearance.name, size);
    }
  });
}
