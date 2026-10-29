import type { Page } from '@playwright/test';
import { expectNoSeriousAxe } from '../../support/a11y/axe';
import { openBusyRegie } from '../../support/a11y/regie-setup';
import { newUiContext } from '../../support/ui';
import { openAppearanceSettings } from '../../support/regie/kit';
import { PixelImage } from '../../support/ui/pixels';
import { expect, test } from '../../support/ui/fixtures';
import { t } from '../../support/tags';

/**
 * E2E-DEV-23 (docs/testing.md 2.8): the appearance of the Regie. Dark is the default even when the system prefers
 * light; Dark | Light | System in the settings window (Appearance and language) applies at once, survives a reload without a flash (the
 * `theme-init.js` script alone sets it), is followed by other tabs and by System live, and is shared by the login page
 * and /monitoring. In both themes axe finds no serious violation (colour contrast included), the picture areas stay
 * dark, and an incident still shows lamp and wash. The texts are not asserted: the controls are found by their ids.
 */

const tags = t.with('@p1', '@ui', '@theme');
const VIEWPORT = { width: 1440, height: 900 };
const STORAGE_KEY = 'studioflow.theme';
const THEMES = ['dark', 'light'] as const;

const THEME_SEGMENTS = '[aria-labelledby="sf-theme-label"] button';
const SEGMENT = { dark: 0, light: 1, system: 2 } as const;

/** Panel colours of the two themes (DESIGN.md "Themes"), as the browser reports them. */
const PANEL = { dark: 'rgb(30, 30, 33)', light: 'rgb(247, 247, 249)' } as const;

/** Picks a segment of the appearance setting; opens the settings window through the gear first when needed. */
async function chooseTheme(page: Page, theme: keyof typeof SEGMENT): Promise<void> {
  if (!(await page.locator(THEME_SEGMENTS).first().isVisible())) {
    await openAppearanceSettings(page);
  }
  await page.locator(THEME_SEGMENTS).nth(SEGMENT[theme]).click();
}

async function stored(page: Page): Promise<string | null> {
  return page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY);
}

/** Stores the choice, then reloads, so the page starts in that theme the way a returning visitor does. */
async function startIn(page: Page, theme: (typeof THEMES)[number]): Promise<void> {
  await page.evaluate(([key, value]) => localStorage.setItem(key!, value!), [STORAGE_KEY, theme]);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
}

const bodyBackground = (page: Page): Promise<string> =>
  page.evaluate(() => getComputedStyle(document.body).backgroundColor);

test.describe('Regie appearance', () => {
  test(
    'E2E-DEV-23 [theme] dark by default, Light and System from the settings window, kept across a reload, followed by other tabs',
    tags,
    async ({ regie }) => {
      const { page } = regie;
      await page.emulateMedia({ colorScheme: 'light' });
      await page.reload();
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
      expect(await stored(page), 'nothing stored by default').toBeNull();
      expect(await bodyBackground(page)).toBe(PANEL.dark);

      await chooseTheme(page, 'light');
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
      expect(await bodyBackground(page)).toBe(PANEL.light);
      expect(await stored(page)).toBe('light');
      await expect(page.locator(THEME_SEGMENTS).nth(SEGMENT.light)).toHaveAttribute('aria-pressed', 'true');

      // A second tab of the same browser follows the change through the storage event.
      const other = await page.context().newPage();
      await other.goto('/');
      await expect(other.locator('html')).toHaveAttribute('data-theme', 'light');
      await chooseTheme(page, 'dark');
      await expect(other.locator('html')).toHaveAttribute('data-theme', 'dark');
      await other.close();

      await chooseTheme(page, 'system');
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
      await page.emulateMedia({ colorScheme: 'dark' });
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
      await page.emulateMedia({ colorScheme: 'light' });
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
      expect(await stored(page)).toBe('system');

      await chooseTheme(page, 'light');
      await page.reload();
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
      // The reload stays on the appearance page of the settings window.
      await expect(page.locator(THEME_SEGMENTS).nth(SEGMENT.light)).toHaveAttribute('aria-pressed', 'true');
      expect(regie.problems.pageErrors, 'no uncaught error').toEqual([]);
      expect(regie.problems.cspViolations, 'no CSP violation').toEqual([]);
    },
  );

  test(
    'E2E-DEV-23 [theme] the stored theme is applied before the app starts (no flash), and an unknown value means dark',
    tags,
    async ({ regie }) => {
      const { page } = regie;
      await startIn(page, 'light');
      // Without the application bundle only the head script can have set the attribute.
      await page.route('**/main-*.js', (route) => route.abort());
      await page.reload();
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
      expect(await bodyBackground(page)).toBe(PANEL.light);

      await page.evaluate((key) => localStorage.setItem(key, 'sepia'), STORAGE_KEY);
      await page.reload();
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
      await page.unroute('**/main-*.js');
    },
  );

  test(
    'E2E-DEV-23 [theme] the login page and /monitoring follow the choice',
    tags,
    async ({ regie, browser, onCleanup }) => {
      const { page } = regie;
      await startIn(page, 'light');
      await page.goto('/monitoring');
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
      expect(await bodyBackground(page)).toBe(PANEL.light);

      // The login page of a visitor with no session: the same browser storage, no cookie.
      const context = await newUiContext(browser, { context: { viewport: VIEWPORT, colorScheme: 'dark' } });
      onCleanup(() => context.close());
      const visitor = await context.newPage();
      await visitor.goto('/login');
      await expect(visitor.locator('html'), 'dark by default, whatever the system prefers').toHaveAttribute('data-theme', 'dark');
      await visitor.evaluate((key) => localStorage.setItem(key, 'system'), STORAGE_KEY);
      await visitor.reload();
      await expect(visitor.locator('html'), 'System follows the dark system').toHaveAttribute('data-theme', 'dark');
      await visitor.emulateMedia({ colorScheme: 'light' });
      await expect(visitor.locator('html')).toHaveAttribute('data-theme', 'light');
      expect(await bodyBackground(visitor)).toBe(PANEL.light);
    },
  );
});

for (const theme of THEMES) {
  test.describe(`${theme} theme`, () => {
    test(
      `E2E-DEV-23 [theme, axe, ${theme}] login, Regie with an incident, the appearance settings and /monitoring have no serious violation`,
      tags,
      async ({ openRegie, pairContext, onCleanup, browser }) => {
        test.setTimeout(150_000);
        const { regie } = await openBusyRegie({ openRegie, pairContext, onCleanup }, { viewport: VIEWPORT, incident: 'reconnecting', studio: true });
        const { page } = regie;
        await startIn(page, theme);
        await expect(page.locator('.c-status__lead.is-warn')).toBeVisible();
        await expectNoSeriousAxe(page, `regie-${theme}`);

        await openAppearanceSettings(page);
        await expect(page.locator(THEME_SEGMENTS).first()).toBeVisible();
        await expectNoSeriousAxe(page, `regie-settings-${theme}`);

        await page.goto('/monitoring');
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        await expect(page.getByRole('main')).toBeVisible();
        await expectNoSeriousAxe(page, `monitoring-${theme}`);

        const context = await newUiContext(browser, { context: { viewport: VIEWPORT } });
        onCleanup(() => context.close());
        const visitor = await context.newPage();
        await visitor.goto('/login');
        await visitor.evaluate(([key, value]) => localStorage.setItem(key!, value!), [STORAGE_KEY, theme]);
        await visitor.reload();
        await expect(visitor.locator('html')).toHaveAttribute('data-theme', theme);
        await expectNoSeriousAxe(visitor, `login-${theme}`);
        expect(regie.problems.pageErrors).toEqual([]);
      },
    );

    test(
      `E2E-DEV-23 [theme, ${theme}] the picture areas stay dark and an incident shows its lamp and wash`,
      tags,
      async ({ openRegie, pairContext, onCleanup }) => {
        test.setTimeout(150_000);
        const { regie } = await openBusyRegie({ openRegie, pairContext, onCleanup }, { viewport: VIEWPORT, incident: 'reconnecting', studio: true });
        const { page } = regie;
        await startIn(page, theme);
        const row = page.locator('.c-st.is-warn');
        await expect(row).toBeVisible();

        // The wells behind the pictures: monitors, scene thumbnails, station thumbnails.
        for (const selector of ['.c-monitor__screen', '.c-scene__thumb', 'sf-station-thumb']) {
          const luminance = await page.locator(selector).first().evaluate((element) => {
            const [red, green, blue] = getComputedStyle(element).backgroundColor.match(/\d+/g)!.map(Number);
            return 0.299 * red! + 0.587 * green! + 0.114 * blue!;
          });
          expect(luminance, `${selector} is near black in the ${theme} theme`).toBeLessThan(16);
        }

        // The incident: an amber lamp with its halo and a wash that differs from the panel on screen.
        // (the redesign draws the halo as a box-shadow ring; the amber is the theme's --amber, #ff9f0a / #9a4700)
        const lamp = row.locator('.c-lamp');
        await expect(lamp).not.toHaveCSS('box-shadow', 'none');
        const amber = theme === 'dark' ? 'rgb(255, 159, 10)' : 'rgb(154, 71, 0)';
        await expect(lamp).toHaveCSS('background-color', amber);
        const panel = PixelImage.fromPng(await page.locator('.c-dock-frame__body').first().screenshot());
        const wash = PixelImage.fromPng(await row.screenshot());
        const [panelRed, panelGreen, panelBlue] = panel.pixel(2, 2);
        const [washRed, washGreen, washBlue] = wash.pixel(2, 2);
        const difference = Math.abs(panelRed - washRed) + Math.abs(panelGreen - washGreen) + Math.abs(panelBlue - washBlue);
        expect(difference, 'the wash of the incident row differs from the panel').toBeGreaterThan(24);
      },
    );
  });
}
