import type { Page } from '@playwright/test';
import { describeActiveSettled } from '../../support/a11y/focus';
import { tabTo, byName, focusTop } from '../../support/a11y/keys';
import { boxOf, expectNoOverflow, findOverlaps, overflowReport, saveScreen, VIEWPORTS } from '../../support/a11y/layout';
import { openBusyRegie, settle } from '../../support/a11y/regie-setup';
import { knownBug } from '../../support/a11y/known-bug';
import { expect, test } from '../../support/ui/fixtures';
import { t } from '../../support/tags';

/**
 * E2E-DEV-18 (long text does not break layouts), E2E-DEV-20 (touch input in the Regie) and E2E-DEV-22 (forced colours
 * and 200 % zoom), docs/testing.md 2.8. All P2.
 */

const tags = t.with('@p2', '@a11y');

async function visualFingerprint(page: Page, selector: string): Promise<string> {
  return page.locator(selector).first().evaluate((element) => {
    const style = getComputedStyle(element);
    const after = getComputedStyle(element, '::after');
    return JSON.stringify({
      color: style.color,
      background: style.backgroundColor,
      border: [style.borderTopColor, style.borderBottomColor, style.borderTopWidth, style.borderBottomWidth, style.borderTopStyle, style.borderBottomStyle],
      outline: [style.outlineStyle, style.outlineWidth],
      shadow: style.boxShadow,
      decoration: style.textDecorationLine,
      weight: style.fontWeight,
      afterBackground: after.backgroundColor,
      afterContent: after.content,
    });
  });
}

test.describe('Forced colours and zoom', () => {
  test('E2E-DEV-22 [forced colours] states stay distinguishable without colour: the words “reconnecting”, “PGM”, “PVW” and “PROGRAM”/“PREVIEW” name them, lamps are decorative; focus indicators stay', tags, async ({ openRegie, pairContext, onCleanup }) => {
    test.setTimeout(150_000);
    const { regie } = await openBusyRegie({ openRegie, pairContext, onCleanup }, { viewport: { width: 1440, height: 900 }, forcedColors: 'active', incident: 'reconnecting', studio: true });
    const { page } = regie;
    expect(await page.evaluate(() => matchMedia('(forced-colors: active)').matches), 'forced colours are on').toBe(true);
    await saveScreen(page, 'regie-1440x900-forced-colors');
    // the outage is named in words in the activity bar, on the scene row and on the station row (not only by a lamp colour)
    await expect(page.getByRole('region', { name: 'Activity' })).toContainText('reconnecting');
    await expect(page.getByRole('button', { name: /^Presentation, in Preview, K3 disrupted$/ })).toBeVisible();
    await expect(page.locator('.c-st__row').first()).toHaveAccessibleName(/reconnecting/);
    await expect(page.locator('.c-st__l2').first()).toContainText('reconnecting');
    // Program and Preview are told in words, the scene rows carry the tags
    await expect(page.getByText('PROGRAM', { exact: false }).first()).toBeVisible();
    await expect(page.locator('.c-tag--pgm').first()).toHaveText('PGM');
    await expect(page.locator('.c-tag--pvw').first()).toHaveText('PVW');
    // lamps are decorative and the words carry the meaning
    expect(await page.locator('.c-lamp').evaluateAll((elements) => elements.filter((element) => element.getAttribute('aria-hidden') !== 'true').length)).toBe(0);

    // focus indicators survive: an outline of 2 px on a button, whatever colour the system gives it
    await focusTop(page);
    await tabTo(page, byName('Start broadcast', 'button'), { what: 'Start broadcast' });
    const ring = (await describeActiveSettled(page, 800))!.ring;
    expect(ring.outlineStyle, 'outline style under forced colours').not.toBe('none');
    expect(ring.outlineWidth, 'outline width under forced colours').toBeGreaterThanOrEqual(2);
  });

  test('E2E-DEV-22 [forced colours, controls] the Studio Mode switch is visible and the selected Transition segment differs from the others by more than a colour', tags, async ({ openRegie, pairContext, onCleanup }) => {
    test.setTimeout(150_000);
    knownBug('A11Y-11', 'forced colours: the Studio Mode switch (appearance:none input painted by background colours) has no border, so track and thumb disappear; the selected Transition segment keeps only an 8 % background tint (its blue underline is a box-shadow that forced colours removes); the Regie CSS has no forced-colors rules');
    const { regie } = await openBusyRegie({ openRegie, pairContext, onCleanup }, { viewport: { width: 1440, height: 900 }, forcedColors: 'active', incident: null, studio: true, stations: 2 });
    const { page } = regie;
    expect(await page.evaluate(() => matchMedia('(forced-colors: active)').matches)).toBe(true);
    // the switch: its box is drawn by a border or an outline in forced colours
    const track = await page.locator('.c-switch input').evaluate((input) => {
      const style = getComputedStyle(input);
      return { border: parseFloat(style.borderTopWidth) > 0 && style.borderTopStyle !== 'none', outline: style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0, background: style.backgroundColor };
    });
    expect(track.border || track.outline, `the switch track is drawn with a border or an outline in forced colours (${JSON.stringify(track)})`).toBe(true);
    // the pressed segment differs from the unpressed one in more than the colour of its text
    const a = JSON.parse(await visualFingerprint(page, '.c-transition__option[aria-pressed=true]')) as Record<string, unknown>;
    const b = JSON.parse(await visualFingerprint(page, '.c-transition__option[aria-pressed=false]')) as Record<string, unknown>;
    const differs = ['border', 'outline', 'shadow', 'decoration', 'weight', 'afterBackground'].filter((key) => JSON.stringify(a[key]) !== JSON.stringify(b[key]));
    expect(differs, `the selected segment differs in border, outline, decoration or weight (${JSON.stringify(a)} vs ${JSON.stringify(b)})`).not.toEqual([]);
  });

  test('E2E-DEV-22 [zoom] 640x360 (200 % zoom at 1280x720) falls into the one-column layout without horizontal scroll; Take, the scenes and the docks stay reachable', tags, async ({ openRegie, pairContext, onCleanup }) => {
    test.setTimeout(150_000);
    const { regie } = await openBusyRegie({ openRegie, pairContext, onCleanup }, { viewport: { width: 640, height: 360 }, incident: 'reconnecting', studio: true });
    const { page } = regie;
    await expectNoOverflow(page, { label: '640x360 Studio Mode' });
    const overlaps = await findOverlaps(page, 'body');
    expect(overlaps, 'no overlapping controls at 640x360').toEqual([]);
    // the one-column order of the 900 px layout: Program, controls, Preview, docks
    const program = (await boxOf(page.locator('sf-monitor[kind=program] .c-monitor__screen')))!;
    const take = (await boxOf(regie.take()))!;
    const preview = (await boxOf(page.locator('sf-monitor[kind=preview] .c-monitor__screen')))!;
    const scenes = (await boxOf(page.locator('sf-dock-slot[aria-label=Scenes]')))!;
    expect(take.y, 'Take follows the Program monitor').toBeGreaterThan(program.y + program.h - 2);
    expect(preview.y, 'Preview follows the controls').toBeGreaterThan(take.y);
    expect(scenes.y, 'the docks follow the Preview').toBeGreaterThan(preview.y + preview.h - 2);
    await regie.take().scrollIntoViewIfNeeded();
    await expect(regie.take()).toBeVisible();
    for (const name of ['Welcome', 'Credits']) {
      await regie.scene(name).scrollIntoViewIfNeeded();
      await expect(regie.scene(name)).toBeVisible();
    }
    await regie.pairButton().scrollIntoViewIfNeeded();
    await expect(regie.pairButton()).toBeVisible();
    await saveScreen(page, 'regie-640x360-studio-full', { fullPage: true });
    // the same at 200 % zoom with the pointer: a scene click still switches
    await regie.setStudioMode(false);
    await settle(page);
    await regie.scene('Break').scrollIntoViewIfNeeded();
    await regie.clickScene('Break');
    await expect(regie.scene('Break')).toHaveAttribute('aria-pressed', 'true');
    void overflowReport;
  });
});

test.describe('Long text', () => {
  const longScene = 'A scene with an extraordinarily long name for testing the rows of the scene list xxxxx'.slice(0, 80);
  const longDevice = 'Device with a very long name for the station list and the message line '.slice(0, 60);
  const longProduction = 'Production with a very, very long name that must not overflow in the header yyyyyyyy'.slice(0, 80);

  const cases: Array<{ name: string; viewport: { width: number; height: number }; incidentName: 'long' | 'short'; bug?: boolean; priority: 'p1' | 'p2' }> = [
    { name: '1280x720', viewport: VIEWPORTS.w1280, incidentName: 'long', priority: 'p2' },
    { name: '900x700', viewport: VIEWPORTS.w900, incidentName: 'long', priority: 'p2' },
    { name: '390x844', viewport: VIEWPORTS.w390, incidentName: 'short', priority: 'p2' },
    { name: '390x844, incident of a station with a 60-character name', viewport: VIEWPORTS.w390, incidentName: 'long', bug: true, priority: 'p2' },
  ];

  for (const entry of cases) {
    test(`E2E-DEV-18 [long text, ${entry.name}] a scene name of 80 characters, device names of 60 and a production name of 80 stay inside their rows: no overflow, no overlapping controls`, tags, async ({ openRegie, pairContext, onCleanup, production, api }) => {
      test.setTimeout(240_000);
      if (entry.bug) knownBug('A11Y-12', 'at 390 px the incident entry of the activity bar (button.c-status__target with the device name) is wider than the viewport and makes the page scroll horizontally when the device name has 60 characters');
      const { regie, seeded } = await openBusyRegie({ openRegie, pairContext, onCleanup }, { viewport: entry.viewport, incident: 'reconnecting', studio: false });
      expect((await api.renameDevice(production.id, seeded.stations[0]!.device.id, longDevice)).status, 'the 60-character device name is accepted').toBeLessThan(300);
      if (entry.incidentName === 'long') expect((await api.renameDevice(production.id, seeded.stations[2]!.device.id, longDevice.replace(/^Device/, 'Phone'))).status).toBeLessThan(300);
      expect((await api.updateScene(production.id, seeded.scenes[1]!.id, { name: longScene })).status, 'the 80-character scene name is accepted').toBeLessThan(300);
      expect((await api.updateProduction(production.id, { name: longProduction })).status, 'the 80-character production name is accepted').toBeLessThan(300);
      const { page } = regie;
      await expect(page.locator('.c-prod__name')).toContainText('Production with a very');
      await expect(page.locator('button.c-scene', { hasText: 'A scene with an' }), 'the long scene name is shown').toBeVisible();
      for (const studio of [false, true]) {
        await regie.setStudioMode(studio);
        await settle(page);
        const label = `long text ${entry.name} ${studio ? 'Studio Mode' : 'direct'}`;
        await saveScreen(page, `regie-long-text-${entry.viewport.width}x${entry.viewport.height}-${entry.incidentName}-incident-${studio ? 'studio' : 'direct'}`);
        await expectNoOverflow(page, { label });
        if (entry.viewport.width >= 1280) await expectNoOverflow(page, { vertical: false, label });
        for (const scope of ['header.c-header', 'sf-control-column', 'sf-workspace', 'sf-status-line']) expect(await findOverlaps(page, scope), `${label}: no overlapping controls in ${scope}`).toEqual([]);
        // text is cut by an ellipsis or wrapped inside its row: nothing is wider than its container's visible box
        const cut = await page.evaluate(() => {
          const offenders: string[] = [];
          for (const element of Array.from(document.querySelectorAll('.c-prod__name, .c-scene__name, .c-st__name, .c-monitor__name, .c-status__target'))) {
            const box = element.getBoundingClientRect();
            const parent = element.parentElement!.getBoundingClientRect();
            if (box.width === 0) continue;
            if (box.right > parent.right + 1 || box.left < parent.left - 1) offenders.push(`${element.className} ${Math.round(box.left)}..${Math.round(box.right)} vs parent ${Math.round(parent.left)}..${Math.round(parent.right)}`);
          }
          return offenders;
        });
        expect(cut, `${label}: names stay inside their parents`).toEqual([]);
        if (entry.viewport.width >= 1280) expect((await boxOf(page.locator('header.c-header')))!.h, `${label}: the toolbar keeps its 52 px`).toBeCloseTo(52, 0);
      }
      expect(regie.problems.pageErrors).toEqual([]);
    });
  }
});

test.describe('Touch input', () => {
  test('E2E-DEV-20 [touch] tap a scene, tap Take, drag an element with a finger without scrolling the page, tap a station row; splitters and grips are inert at <= 1180 px', tags, async ({ openRegie, pairContext, onCleanup, production, browser }) => {
    test.setTimeout(240_000);
    void browser;
    const { regie, seeded } = await openBusyRegie({ openRegie, pairContext, onCleanup }, { viewport: { width: 1180, height: 820 }, touch: true, incident: null, studio: true, context: { isMobile: false } });
    const { page } = regie;
    const api = regie.requireAdmin();
    const snapshot = async () => (await api.getSnapshot(production.id)).body;
    // tap a scene: the Preview loads it, exactly once (no double activation from tap + synthetic click)
    const posts: string[] = [];
    page.on('request', (request) => {
      if (request.method() === 'PUT' && /\/preview$/.test(new URL(request.url()).pathname)) posts.push(request.url());
    });
    await regie.scene('Interview').tap();
    await expect.poll(async () => (await snapshot()).production.previewSceneId).toBe(seeded.scenes[3]!.id);
    await page.waitForTimeout(500);
    expect(posts.length, 'one tap sends one preview request').toBe(1);
    await regie.scene('Presentation').tap();
    await expect.poll(async () => (await snapshot()).production.previewSceneId).toBe(seeded.scenes[1]!.id);
    await page.waitForTimeout(500);
    expect(posts.length, 'the second tap sends one more request, not two').toBe(2);
    // drag the picture-in-picture element with a finger (touch events through CDP): the element moves, the page does not scroll
    const scene = async () => (await snapshot()).scenes.find((entry) => entry.id === seeded.scenes[1]!.id)!;
    const item = (await scene()).items.find((entry) => entry.w === 600)!;
    const box = page.locator(`.c-edit-box[data-item-id="${item.id}"]`);
    await box.scrollIntoViewIfNeeded();
    const scrollBefore = await page.evaluate(() => window.scrollY);
    const rect = (await box.boundingBox())!;
    const from = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x, y: from.y }] });
    for (let step = 1; step <= 10; step++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x - step * 10, y: from.y - step * 8 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(async () => (await scene()).items.find((entry) => entry.id === item.id)!.x, { message: 'the finger moved the element', timeout: 15_000 }).toBeLessThan(item.x - 50);
    expect(await page.evaluate(() => window.scrollY), 'dragging the element does not scroll the page').toBe(scrollBefore);
    // Take by tap. Harness note: in Chromium's synthesized touch sequence (CDP) the first tap after the finger drag is swallowed (the
    // second works, a mouse click always works); a tap on the header brand ends the drag sequence before the tests go on.
    await page.locator('.c-header__brand').tap();
    await page.evaluate(() => window.scrollTo(0, 0));
    test.info().annotations.push({ type: 'take-state', description: JSON.stringify({ disabled: await regie.take().isDisabled(), preview: (await snapshot()).production.previewSceneId, program: (await snapshot()).production.programSceneId, box: await regie.take().boundingBox() }) });
    await regie.take().tap();
    await expect.poll(async () => (await snapshot()).production.programSceneId, { message: 'a tap on Take takes' }).toBe(seeded.scenes[1]!.id);
    // a station row by tap
    const row = page.locator('.c-st__row').first();
    await row.scrollIntoViewIfNeeded();
    await row.tap();
    await expect(row).toHaveAttribute('aria-expanded', 'true');
    // grips and workspace splitters are hidden at 1180 px
    const hidden = await page.evaluate(() => ({
      grips: Array.from(document.querySelectorAll('.c-dock-frame__grip')).filter((element) => getComputedStyle(element).display !== 'none').length,
      splits: Array.from(document.querySelectorAll('.c-workspace__split, .c-dock-slot__split')).filter((element) => getComputedStyle(element).display !== 'none').length,
    }));
    expect(hidden, 'grips and dock splitters are hidden at 1180 px').toEqual({ grips: 0, splits: 0 });
    expect(regie.problems.pageErrors).toEqual([]);
    void knownBug;
  });
});
