import type { Locator } from '@playwright/test';
import { pairPhone } from '../../support/production';
import { chooseLanguage } from '../../support/regie/kit';
import { expect, test } from '../../support/ui/fixtures';
import { t } from '../../support/tags';

/**
 * I18N - numbers and server texts follow the language (docs/testing.md 2.17): English writes the decimal point
 * ("0.5 s"), German the decimal comma ("0,5 s") (decision D3); the log lines of the API are codes plus parameters that
 * the Regie renders in the active language.
 */

const tags = t.with('@p1', '@i18n');

/**
 * Clicks `button` until `value` reads `end`, waiting for every step to show: a loop on isEnabled() raced the update and
 * clicked a button that had just become disabled (#80).
 */
async function stepTo(button: Locator, value: Locator, end: string): Promise<void> {
  for (let step = 0; step < 20; step++) {
    const before = (await value.textContent()) ?? '';
    if (before === end) break;
    await button.click();
    await expect(value).not.toHaveText(before);
  }
  await expect(value).toHaveText(end);
  await expect(button).toBeDisabled();
}

test.describe('I18N formats', () => {
  test.use({ locale: 'en-US' });

  test('E2E-I18N-11 [regie] the fade durations use the decimal point in English and the comma in German, live', tags, async ({ regie }) => {
    const { page } = regie;
    const value = page.locator('.c-duration__value');
    await expect(value).toHaveText(/^\d\.\d s$|^\d s$/);

    // Step to the shortest duration: "0.2 s" in English.
    const shorter = page.getByRole('button', { name: 'Shorter fade' });
    await stepTo(shorter, value, '0.2 s');

    // The language is chosen in the settings window; back in the control room the same duration reads in German.
    await chooseLanguage(page, 'de-CH');
    await expect(value).toHaveText('0,2 s');

    const longer = page.getByRole('button', { name: 'Blende länger' });
    await stepTo(longer, value, '2 s');

    await chooseLanguage(page, 'en');
    await expect(value).toHaveText('2 s');
    await shorter.click();
    await expect(value).toHaveText('1.5 s');
  });

  test('E2E-I18N-12 [regie] the 24 h clock and the elapsed times have no AM/PM in either language', tags, async ({ regie }) => {
    const { page } = regie;
    const clock = page.locator('.c-header__clock');
    await expect(clock).toHaveText(/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/);

    await chooseLanguage(page, 'de-CH');
    await expect(page.getByRole('link', { name: 'Einstellungen', exact: true })).toBeVisible();
    await expect(clock).toHaveText(/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/);
  });

  test('E2E-I18N-13 [regie] a log entry of the API is rendered in the language of the Regie and changes with it', tags, async ({ regie, pairContext }) => {
    const { page } = regie;
    await pairPhone(pairContext, { name: 'Phone 1' });
    const log = page.locator('.c-status__log');
    await expect(log).toContainText('K1 Phone 1 paired');

    await chooseLanguage(page, 'de-CH');
    await expect(log).toContainText('K1 Phone 1 gekoppelt');
    await expect(log).not.toContainText('paired');
  });
});
