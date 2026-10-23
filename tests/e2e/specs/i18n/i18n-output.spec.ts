import { TEXT } from '../../support/text';
import { TEXT_DE } from '../../support/text.de';
import { expect, test } from '../../support/ui/fixtures';
import { t } from '../../support/tags';

/**
 * I18N - the output page has no language setting (docs/testing.md 2.14): `?lang=` wins, then the browser language,
 * then English. The language of the Regie in `studioflow.locale` (same origin) does not reach it. The standby and end
 * slates are texts of the production and stay as they were written.
 */

const tags = t.with('@p1', '@i18n');
const WRONG_KEY = 'wrong-output-key-0123456789';

test.describe('I18N output page', () => {
  test.use({ locale: 'en-US' });

  test('E2E-I18N-07 [output] ?lang=de-CH shows the page in German, without it the browser language decides', tags, async ({ openOutput, production }) => {
    const target = { slug: production.slug, outputKey: WRONG_KEY };

    const english = await openOutput(target);
    await expect.poll(() => english.slateText(), { timeout: 20_000 }).toContain(TEXT.slate.denied);
    expect(await english.page.evaluate(() => document.documentElement.lang), '<html lang> by browser language').toBe('en');

    const german = await openOutput(target, { lang: 'de-CH' });
    await expect.poll(() => german.slateText(), { timeout: 20_000 }).toContain(TEXT_DE.slate.denied);
    expect(await german.page.evaluate(() => document.documentElement.lang), '<html lang> by ?lang').toBe('de-CH');

    const short = await openOutput(target, { lang: 'de' });
    await expect.poll(() => short.slateText(), { timeout: 20_000 }).toContain(TEXT_DE.slate.denied);

    const unknown = await openOutput(target, { lang: 'fr' });
    await expect.poll(() => unknown.slateText(), { timeout: 20_000 }).toContain(TEXT.slate.denied);
  });

  test('E2E-I18N-08 [output] a German browser gets the German page, ?lang=en wins over it', tags, async ({ openOutput, production }) => {
    const target = { slug: production.slug, outputKey: WRONG_KEY };

    const browserGerman = await openOutput(target, {}, { context: { context: { locale: 'de-AT' } } });
    await expect.poll(() => browserGerman.slateText(), { timeout: 20_000 }).toContain(TEXT_DE.slate.denied);

    const forcedEnglish = await openOutput(target, { lang: 'en' }, { context: { context: { locale: 'de-AT' } } });
    await expect.poll(() => forcedEnglish.slateText(), { timeout: 20_000 }).toContain(TEXT.slate.denied);
  });

  test('E2E-I18N-09 [output] the language setting of the Regie does not reach the output page', tags, async ({ openOutput, production, config }) => {
    // The Regie and the output page share the origin, so they share `localStorage`.
    const origin = new URL(config.baseURL).origin;
    const storageState = { cookies: [], origins: [{ origin, localStorage: [{ name: 'studioflow.locale', value: 'de-CH' }] }] };
    const output = await openOutput({ slug: production.slug, outputKey: WRONG_KEY }, {}, { context: { context: { storageState } } });
    await expect.poll(() => output.slateText(), { timeout: 20_000 }).toContain(TEXT.slate.denied);
    expect(await output.page.evaluate(() => localStorage.getItem('studioflow.locale')), 'the setting is there').toBe('de-CH');
    expect(await output.page.evaluate(() => document.documentElement.lang)).toBe('en');
  });

  test('E2E-I18N-10 [output] the standby slate is a text of the production: it is the same in both languages', tags, async ({ openOutput, production }) => {
    const german = await openOutput(production, { lang: 'de-CH' });
    await expect.poll(() => german.slateText(), { timeout: 20_000 }).toContain(TEXT.slate.standby);
    expect(await german.slateText()).toContain(production.name);
  });
});
