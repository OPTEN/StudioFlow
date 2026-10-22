import { auditTexts, collectTexts } from '../../support/a11y/german';
import { describeActiveSettled, resetFocusToTop, tabThrough } from '../../support/a11y/focus';
import { findOverlaps, overflowReport, expectInViewport } from '../../support/a11y/layout';
import { nonZeroDurations } from '../../support/a11y/motion';
import { scanAxe } from '../../support/a11y/axe';
import { expect, test } from '../../support/fixtures';
import { t } from '../../support/tags';

/**
 * E2E-A11Y-00: self-tests of the helpers of this area. Each one is shown a page with a known defect and must find it
 * (and must pass a clean page), so the a11y specs cannot pass vacuously.
 */

const tags = t.with('@p1', '@a11y', '@harness');

function serve(page: import('@playwright/test').Page, baseURL: string, path: string, body: string, head = '') {
  return page.route(`${baseURL}${path}`, (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><html lang="de-CH"><head><meta charset="utf-8"><title>Helfer</title>${head}</head><body>${body}</body></html>` }),
  );
}

test.describe('a11y helpers', () => {
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

  test('E2E-A11Y-00 [layout] finds horizontal overflow, overlapping controls and a covered control, passes a clean layout', tags, async ({ page, config }) => {
    await serve(page, config.baseURL, '/__e2e/layout-bad', '<style>body{margin:0}.wide{width:3000px;height:20px;background:#ccc}.a,.b{position:absolute;top:100px;width:100px;height:40px}.a{left:10px}.b{left:60px}.cover{position:absolute;left:300px;top:100px;width:200px;height:100px;background:#fff;z-index:5}</style><div class="wide"></div><button class="a">Eins</button><button class="b">Zwei</button><button id="t" style="position:absolute;left:320px;top:120px;width:60px;height:30px">Ziel</button><div class="cover"></div>');
    await serve(page, config.baseURL, '/__e2e/layout-good', '<style>body{margin:0}.row{display:flex;gap:8px;padding:8px}</style><div class="row"><button>Eins</button><button>Zwei</button><button id="t">Ziel</button></div>');
    await page.setViewportSize({ width: 800, height: 600 });
    await page.goto(`${config.baseURL}/__e2e/layout-bad`);
    const bad = await overflowReport(page);
    expect(bad.scrollWidth, 'the wide element makes the page scroll horizontally').toBeGreaterThan(bad.clientWidth);
    expect(bad.offenders.length, 'and the offender is named').toBeGreaterThan(0);
    const overlaps = await findOverlaps(page, 'body');
    expect(overlaps.some((entry) => /Eins/.test(entry.a + entry.b) && /Zwei/.test(entry.a + entry.b)), 'the overlapping buttons are found').toBe(true);
    await expect(expectInViewport(page.locator('#t'), 'covered target')).rejects.toThrow(/not covered|covered/);
    await page.goto(`${config.baseURL}/__e2e/layout-good`);
    const good = await overflowReport(page);
    expect(good.scrollWidth).toBeLessThanOrEqual(good.clientWidth);
    expect(good.offenders).toEqual([]);
    expect(await findOverlaps(page, 'body'), 'no overlap in a flex row').toEqual([]);
    await expectInViewport(page.locator('#t'), 'clean target');
  });

  test('E2E-A11Y-00 [focus] reads the indicator kinds and finds a control without one', tags, async ({ page, config }) => {
    await serve(page, config.baseURL, '/__e2e/focus', '<style>button{outline:none}.ok:focus-visible{outline:2px solid rgb(121,192,255);outline-offset:2px}</style><button class="ok">Gut</button><button class="none">Ohne Anzeige</button>');
    await page.goto(`${config.baseURL}/__e2e/focus`);
    const stops = await tabThrough(page);
    expect(stops.map((stop) => `${stop.info.name}:${stop.info.ring.kind}`)).toEqual(['Gut:outline', 'Ohne Anzeige:none']);
    await resetFocusToTop(page);
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    expect((await describeActiveSettled(page, 100))!.name, 'Shift+Tab goes back one stop').toBe('Gut');
  });

  test('E2E-A11Y-00 [motion] finds a transition and an animation with a duration and accepts zero', tags, async ({ page, config }) => {
    await serve(page, config.baseURL, '/__e2e/motion', '<style>@keyframes k{from{opacity:0}to{opacity:1}}.t{transition:opacity .15s}.a{animation:k 1s}.z{transition:opacity 0s}</style><div class="t">t</div><div class="a">a</div><div class="z">z</div>');
    await page.goto(`${config.baseURL}/__e2e/motion`);
    const found = await nonZeroDurations(page);
    expect(found.map((entry) => `${entry.element}:${entry.property}`).sort()).toEqual(['div.a:animation-duration', 'div.t:transition-duration']);
  });

  test('E2E-A11Y-00 [axe] reports an unnamed button as critical and an unlabelled field, passes a clean page, skips excluded known-bug selectors only while the bug is open', tags, async ({ page, config }) => {
    await serve(page, config.baseURL, '/__e2e/axe-bad', '<main><h1>Titel</h1><button></button><input type="text"><div role="separator" tabindex="0" aria-label="Trenner"></div></main>');
    await serve(page, config.baseURL, '/__e2e/axe-good', '<main><h1>Titel</h1><button>Los</button><label>Name <input type="text"></label></main>');
    await page.goto(`${config.baseURL}/__e2e/axe-bad`);
    const bad = await scanAxe(page, 'helper-axe-bad', { noBestPractice: true });
    expect(bad.blocking.map((violation) => violation.id)).toEqual(expect.arrayContaining(['button-name', 'label']));
    const separators = await scanAxe(page, 'helper-axe-separator', { include: ['[role=separator]'], includeKnownBugs: true, noBestPractice: true });
    expect(separators.blocking.map((violation) => violation.id), 'a focusable separator without aria-valuenow is critical').toContain('aria-required-attr');
    await page.goto(`${config.baseURL}/__e2e/axe-good`);
    const good = await scanAxe(page, 'helper-axe-good', { noBestPractice: true });
    expect(good.blocking).toEqual([]);
    expect(good.passes).toBeGreaterThan(0);
  });
});
