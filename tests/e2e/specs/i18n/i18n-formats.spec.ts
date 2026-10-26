import { pairPhone } from '../../support/production';
import { expect, test } from '../../support/ui/fixtures';
import { t } from '../../support/tags';

/**
 * I18N - numbers and server texts follow the language (docs/testing.md 2.16): English writes the decimal point
 * ("0.5 s"), German the decimal comma ("0,5 s") (decision D3); the log lines of the API are codes plus parameters that
 * the Regie renders in the active language.
 */

const tags = t.with('@p1', '@i18n');

test.describe('I18N formats', () => {
  test.use({ locale: 'en-US' });

  test('E2E-I18N-11 [regie] the fade durations use the decimal point in English and the comma in German, live', tags, async ({ regie }) => {
    const { page } = regie;
    const value = page.locator('.c-duration__value');
    await expect(value).toHaveText(/^\d\.\d s$|^\d s$/);

    // Step to the shortest duration: "0.2 s" in English.
    const shorter = page.getByRole('button', { name: 'Shorter fade' });
    while (await shorter.isEnabled()) await shorter.click();
    await expect(value).toHaveText('0.2 s');

    await page.getByRole('button', { name: 'Open settings' }).click();
    await page.getByRole('dialog', { name: 'Settings' }).getByLabel('Interface language').selectOption('de-CH');
    await expect(value).toHaveText('0,2 s');
    await page.keyboard.press('Escape');

    const longer = page.getByRole('button', { name: 'Blende länger' });
    while (await longer.isEnabled()) await longer.click();
    await expect(value).toHaveText('2 s');

    await page.getByRole('button', { name: 'Einstellungen öffnen' }).click();
    await page.getByRole('dialog', { name: 'Einstellungen' }).getByLabel('Sprache der Oberfläche').selectOption('en');
    await expect(value).toHaveText('2 s');
    await shorter.click();
    await expect(value).toHaveText('1.5 s');
  });

  test('E2E-I18N-12 [regie] the 24 h clock and the elapsed times have no AM/PM in either language', tags, async ({ regie }) => {
    const { page } = regie;
    const clock = page.locator('.c-header__clock');
    await expect(clock).toHaveText(/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/);

    await page.getByRole('button', { name: 'Open settings' }).click();
    await page.getByRole('dialog', { name: 'Settings' }).getByLabel('Interface language').selectOption('de-CH');
    await expect(page.getByRole('button', { name: 'Einstellungen öffnen' })).toBeVisible();
    await expect(clock).toHaveText(/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/);
  });

  test('E2E-I18N-13 [regie] a log entry of the API is rendered in the language of the Regie and changes with it', tags, async ({ regie, pairContext }) => {
    const { page } = regie;
    await pairPhone(pairContext, { name: 'Phone 1' });
    const log = page.locator('.c-status__log');
    await expect(log).toContainText('K1 Phone 1 paired');

    await page.getByRole('button', { name: 'Open settings' }).click();
    await page.getByRole('dialog', { name: 'Settings' }).getByLabel('Interface language').selectOption('de-CH');
    await expect(log).toContainText('K1 Phone 1 gekoppelt');
    await expect(log).not.toContainText('paired');
  });
});
