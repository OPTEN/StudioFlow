import type { Page } from '@playwright/test';
import { backToControlRoom, chooseLanguage, languageSelect, openAppearanceSettings } from '../../support/regie/kit';
import { TEXT_DE } from '../../support/text.de';
import { newUiContext } from '../../support/ui';
import { expect, test } from '../../support/ui/fixtures';
import { t } from '../../support/tags';

/**
 * I18N - the language of the Regie, the monitoring page and the sender (docs/testing.md 2.17): the browser language
 * picks the locale, the setting in `studioflow.locale` beats it, and a change applies at once without a reload.
 * The `i18n` project runs in `de-CH`; every test here sets the browser language it needs.
 */

const tags = t.with('@p1', '@i18n');
const STORAGE_KEY = 'studioflow.locale';

/** Browser language -> what the sign-in page shows (supported: `en*` and `de*`, everything else is English). */
const DETECTION = [
  { browser: 'en-US', locale: 'en', submit: 'Sign in' },
  { browser: 'en-GB', locale: 'en', submit: 'Sign in' },
  { browser: 'de-CH', locale: 'de-CH', submit: 'Anmelden' },
  { browser: 'de-AT', locale: 'de-CH', submit: 'Anmelden' },
  { browser: 'de-DE', locale: 'de-CH', submit: 'Anmelden' },
  { browser: 'fr-CH', locale: 'en', submit: 'Sign in' },
] as const;

const storedLocale = (page: Page) => page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY);
const documentLanguage = (page: Page) => page.evaluate(() => document.documentElement.lang);

test.describe('I18N language', () => {
  for (const { browser: language, locale, submit } of DETECTION) {
    test(`E2E-I18N-01 [ui] browser language ${language} shows the sign-in page in ${locale}`, tags, async ({ browser, onCleanup }) => {
      const context = await newUiContext(browser, { context: { locale: language } });
      onCleanup(() => context.close());
      const page = await context.newPage();
      await page.goto('/login');
      await expect(page.getByRole('button', { name: submit })).toBeVisible();
      expect(await documentLanguage(page), '<html lang>').toBe(locale);
      expect(await storedLocale(page), 'automatic detection stores nothing').toBeNull();
    });
  }

  test('E2E-I18N-02 [ui] the stored setting beats the browser language, survives a reload, and `auto` removes it again', tags, async ({ browser, onCleanup }) => {
    const context = await newUiContext(browser, { context: { locale: 'en-US' } });
    onCleanup(() => context.close());
    const page = await context.newPage();
    await page.goto('/login');
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();

    await page.getByLabel('Interface language').selectOption('de-CH');
    await expect(page.getByRole('button', { name: 'Anmelden' })).toBeVisible();
    expect(await storedLocale(page)).toBe('de-CH');
    expect(await documentLanguage(page)).toBe('de-CH');

    await page.reload();
    await expect(page.getByRole('button', { name: 'Anmelden' })).toBeVisible();
    await expect(page.getByLabel('Sprache der Oberfläche')).toHaveValue('de-CH');

    await page.getByLabel('Sprache der Oberfläche').selectOption('auto');
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
    expect(await storedLocale(page), 'automatic removes the key').toBeNull();
    expect(await documentLanguage(page)).toBe('en');
  });

  test('E2E-I18N-03 [ui] a second tab follows a language change at once', tags, async ({ browser, onCleanup }) => {
    const context = await newUiContext(browser, { context: { locale: 'en-US' } });
    onCleanup(() => context.close());
    const first = await context.newPage();
    const second = await context.newPage();
    await first.goto('/login');
    await second.goto('/login');
    await expect(second.getByRole('button', { name: 'Sign in' })).toBeVisible();

    await first.getByLabel('Interface language').selectOption('de-CH');
    await expect(second.getByRole('button', { name: 'Anmelden' })).toBeVisible();
    expect(await documentLanguage(second)).toBe('de-CH');
  });
});

test.describe('I18N language in English', () => {
  test.use({ locale: 'en-US' });

  test('E2E-I18N-04 [regie] switching the language in the settings window changes the app at once and the control room after it, without a reload', tags, async ({ regie }) => {
    const { page } = regie;
    // A marker on the window is gone after a reload; the settings window is a client-side route of the same page.
    await page.evaluate(() => {
      (window as unknown as { __noReload: boolean }).__noReload = true;
    });
    await expect(page.getByRole('region', { name: 'Scenes', exact: true })).toBeVisible();
    expect(await documentLanguage(page)).toBe('en');

    await openAppearanceSettings(page);
    await expect(page.locator('.c-settings__version'), 'the version the server runs').toHaveText(/^\d+\.\d+\.\d+(\+[0-9a-f]{7})?$/);
    await languageSelect(page).selectOption('de-CH');
    expect(await documentLanguage(page), 'the settings window follows at once').toBe('de-CH');
    expect(await storedLocale(page)).toBe('de-CH');

    await backToControlRoom(page);
    await expect(page.getByRole('region', { name: 'Szenen', exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Scenes', exact: true })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Einstellungen', exact: true })).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload), 'the page was not reloaded').toBe(true);

    await chooseLanguage(page, 'en');
    await expect(page.getByRole('region', { name: 'Scenes', exact: true })).toBeVisible();
    expect(await documentLanguage(page)).toBe('en');
    expect(regie.problems.pageErrors).toEqual([]);
  });

  test('E2E-I18N-05 [sender] switching the language on the pairing page of the sender changes it without a reload', tags, async ({ openPhone }) => {
    const phone = await openPhone({ profile: 'pixel7' });
    await phone.gotoStart();
    const { page } = phone;
    await page.evaluate(() => {
      (window as unknown as { __noReload: boolean }).__noReload = true;
    });
    await expect(page.getByRole('heading', { name: 'Pair device' })).toBeVisible();

    await page.getByLabel('Interface language').selectOption('de-CH');
    await expect(page.getByRole('heading', { name: 'Gerät koppeln' })).toBeVisible();
    expect(await documentLanguage(page)).toBe('de-CH');
    expect(await page.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload), 'the page was not reloaded').toBe(true);

    await page.reload();
    await expect(page.getByRole('heading', { name: 'Gerät koppeln' })).toBeVisible();
  });
});

test.describe('I18N language of the server texts', () => {
  test.use({ locale: 'en-US' });

  test('E2E-I18N-06 [regie] the sign-in error is written in the language of the page, not the one of the API', tags, async ({ browser, onCleanup }) => {
    for (const { language, submit, username, password, error } of [
      { language: 'en-US', submit: 'Sign in', username: 'Username', password: 'Password', error: 'Wrong username or password.' },
      { language: 'de-CH', submit: 'Anmelden', username: 'Benutzername', password: 'Passwort', error: TEXT_DE.loginFailed },
    ]) {
      const context = await newUiContext(browser, { context: { locale: language } });
      onCleanup(() => context.close());
      const page = await context.newPage();
      await page.goto('/login');
      await page.getByLabel(username).fill('nobody');
      await page.getByLabel(password).fill('wrong-password-123');
      await page.getByRole('button', { name: submit }).click();
      await expect(page.getByRole('alert').filter({ hasText: /\S/ })).toContainText(error);
    }
  });
});
