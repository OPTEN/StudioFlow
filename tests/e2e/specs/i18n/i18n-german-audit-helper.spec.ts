import { auditTexts, collectTexts } from '../../support/a11y/german';
import { expect, test } from '../../support/fixtures';
import { t } from '../../support/tags';

/**
 * E2E-A11Y-00: self-test of the helper of the German text audit (`specs/i18n/i18n-german-audit.spec.ts`). It is shown a
 * page with known defects and must find them (and must pass a clean page), so the audit cannot pass vacuously.
 */

const tags = t.with('@p1', '@a11y', '@harness');

function serve(page: import('@playwright/test').Page, baseURL: string, path: string, body: string) {
  return page.route(`${baseURL}${path}`, (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><html lang="de-CH"><head><meta charset="utf-8"><title>Helfer</title></head><body>${body}</body></html>` }),
  );
}

test.describe('German audit helper', () => {
  test('E2E-A11Y-00 [german audit] finds ß, straight quotes, English words, decimal points and AM/PM, passes clean text', tags, async ({ page, config }) => {
    await serve(page, config.baseURL, '/__e2e/de-bad', '<main><p>Grösse und Straße</p><p>Der Name "Anna" fehlt</p><p>Settings und Loading</p><p>Dauer 0.3 s, Rate 2.8 Mbit/s</p><p>Um 03:15 PM</p><button aria-label="Save">x</button></main>');
    await serve(page, config.baseURL, '/__e2e/de-good', '<main><p>Grösse und Strasse</p><p>Der Name «Anna» fehlt</p><p>Einstellungen</p><p>Dauer 0,3 s, Rate 2,8 Mbit/s</p><p>Um 15:15</p><button aria-label="Speichern">x</button></main>');
    await page.goto(`${config.baseURL}/__e2e/de-bad`);
    const bad = auditTexts(await collectTexts(page)).map((violation) => violation.rule);
    expect(bad.some((rule) => /ß/.test(rule)), 'ß found').toBe(true);
    expect(bad.some((rule) => /straight double/.test(rule)), 'straight quotes found').toBe(true);
    expect(bad.filter((rule) => /English UI word/.test(rule)).length, 'Settings, Loading and the aria-label Save found').toBeGreaterThanOrEqual(3);
    expect(bad.some((rule) => /decimal comma/.test(rule)), 'decimal point found').toBe(true);
    expect(bad.some((rule) => /24 h/.test(rule)), 'AM/PM found').toBe(true);
    await page.goto(`${config.baseURL}/__e2e/de-good`);
    expect(auditTexts(await collectTexts(page)), 'the clean page has no violation').toEqual([]);
  });
});
