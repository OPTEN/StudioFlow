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
    route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Helper</title>${head}</head><body>${body}</body></html>` }),
  );
}

test.describe('a11y helpers', () => {
  test('E2E-A11Y-00 [layout] finds horizontal overflow, overlapping controls and a covered control, passes a clean layout', tags, async ({ page, config }) => {
    await serve(page, config.baseURL, '/__e2e/layout-bad', '<style>body{margin:0}.wide{width:3000px;height:20px;background:#ccc}.a,.b{position:absolute;top:100px;width:100px;height:40px}.a{left:10px}.b{left:60px}.cover{position:absolute;left:300px;top:100px;width:200px;height:100px;background:#fff;z-index:5}</style><div class="wide"></div><button class="a">One</button><button class="b">Two</button><button id="t" style="position:absolute;left:320px;top:120px;width:60px;height:30px">Target</button><div class="cover"></div>');
    await serve(page, config.baseURL, '/__e2e/layout-good', '<style>body{margin:0}.row{display:flex;gap:8px;padding:8px}</style><div class="row"><button>One</button><button>Two</button><button id="t">Target</button></div>');
    await page.setViewportSize({ width: 800, height: 600 });
    await page.goto(`${config.baseURL}/__e2e/layout-bad`);
    const bad = await overflowReport(page);
    expect(bad.scrollWidth, 'the wide element makes the page scroll horizontally').toBeGreaterThan(bad.clientWidth);
    expect(bad.offenders.length, 'and the offender is named').toBeGreaterThan(0);
    const overlaps = await findOverlaps(page, 'body');
    expect(overlaps.some((entry) => /One/.test(entry.a + entry.b) && /Two/.test(entry.a + entry.b)), 'the overlapping buttons are found').toBe(true);
    await expect(expectInViewport(page.locator('#t'), 'covered target')).rejects.toThrow(/not covered|covered/);
    await page.goto(`${config.baseURL}/__e2e/layout-good`);
    const good = await overflowReport(page);
    expect(good.scrollWidth).toBeLessThanOrEqual(good.clientWidth);
    expect(good.offenders).toEqual([]);
    expect(await findOverlaps(page, 'body'), 'no overlap in a flex row').toEqual([]);
    await expectInViewport(page.locator('#t'), 'clean target');
  });

  test('E2E-A11Y-00 [focus] reads the indicator kinds and finds a control without one', tags, async ({ page, config }) => {
    await serve(page, config.baseURL, '/__e2e/focus', '<style>button{outline:none}.ok:focus-visible{outline:2px solid rgb(121,192,255);outline-offset:2px}</style><button class="ok">Good</button><button class="none">No indicator</button>');
    await page.goto(`${config.baseURL}/__e2e/focus`);
    const stops = await tabThrough(page);
    expect(stops.map((stop) => `${stop.info.name}:${stop.info.ring.kind}`)).toEqual(['Good:outline', 'No indicator:none']);
    await resetFocusToTop(page);
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    expect((await describeActiveSettled(page, 100))!.name, 'Shift+Tab goes back one stop').toBe('Good');
  });

  test('E2E-A11Y-00 [motion] finds a transition and an animation with a duration and accepts zero', tags, async ({ page, config }) => {
    await serve(page, config.baseURL, '/__e2e/motion', '<style>@keyframes k{from{opacity:0}to{opacity:1}}.t{transition:opacity .15s}.a{animation:k 1s}.z{transition:opacity 0s}</style><div class="t">t</div><div class="a">a</div><div class="z">z</div>');
    await page.goto(`${config.baseURL}/__e2e/motion`);
    const found = await nonZeroDurations(page);
    expect(found.map((entry) => `${entry.element}:${entry.property}`).sort()).toEqual(['div.a:animation-duration', 'div.t:transition-duration']);
  });

  test('E2E-A11Y-00 [axe] reports an unnamed button as critical and an unlabelled field, passes a clean page, skips excluded known-bug selectors only while the bug is open', tags, async ({ page, config }) => {
    await serve(page, config.baseURL, '/__e2e/axe-bad', '<main><h1>Title</h1><button></button><input type="text"><div role="separator" tabindex="0" aria-label="Divider"></div></main>');
    await serve(page, config.baseURL, '/__e2e/axe-good', '<main><h1>Title</h1><button>Go</button><label>Name <input type="text"></label></main>');
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
