import type { Locator, Page } from '@playwright/test';
import { labelOf, tabThrough } from '../../support/a11y/focus';
import { boxOf, expectInViewport, expectNoOverflow, findOverlaps, overflowReport, saveScreen, VIEWPORTS, type Box } from '../../support/a11y/layout';
import { knownBug } from '../../support/a11y/known-bug';
import { openBusyRegie, openRegieOn, settle } from '../../support/a11y/regie-setup';
import type { RegiePage } from '../../support/ui/regie';
import { expect, test } from '../../support/ui/fixtures';
import { t } from '../../support/tags';

/**
 * E2E-DEV-01 ... 06 (docs/testing.md 2.8): the Regie at 1280x720, 1366x768, 1440x900, 1920x1080, 1180x800, 900x700 and
 * 390x844. Pre: 7 scenes, 5 stations, one incident. Every test checks no horizontal scroll, the bounding boxes of
 * header, control column and docks (no overlapping controls), 16:9 monitors inside the viewport, that Take is
 * reachable, and leaves screenshots under `.output/<project>/screens`.
 */

const CLAMP_DOCK_HEIGHT = (viewportHeight: number) => Math.min(420, Math.max(240, viewportHeight * 0.42));

interface Metrics {
  header: Box | null;
  strip: Box | null;
  program: Box | null;
  preview: Box | null;
  control: Box | null;
  take: Box | null;
  bottomZone: Box | null;
  docks: Array<{ name: string; box: Box }>;
  dockHeadHeight: number | null;
  thumb: Box | null;
}

async function metrics(page: Page): Promise<Metrics> {
  return page.evaluate(() => {
    const box = (selector: string) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const r = element.getBoundingClientRect();
      return r.width === 0 && r.height === 0 ? null : { x: r.x, y: r.y, w: r.width, h: r.height };
    };
    return {
      header: box('header.c-header'),
      strip: box('sf-status-line'),
      program: box('sf-monitor[kind=program] .c-monitor__screen'),
      preview: box('sf-monitor[kind=preview] .c-monitor__screen'),
      control: box('sf-control-column'),
      take: box('.c-take'),
      bottomZone: box('[data-zone=bottom]'),
      docks: Array.from(document.querySelectorAll('sf-dock-slot')).map((dock) => {
        const r = dock.getBoundingClientRect();
        return { name: dock.getAttribute('aria-label') ?? '', box: { x: r.x, y: r.y, w: r.width, h: r.height } };
      }),
      dockHeadHeight: box('.c-dock-frame__head')?.h ?? null,
      thumb: box('.c-scene__thumb'),
    };
  });
}

/** Controls whose position the DEV-01 list names, as locators on the Regie. */
function criticalControls(regie: RegiePage, studio: boolean): Array<[string, Locator]> {
  const page = regie.page;
  const controls: Array<[string, Locator]> = [
    ['Studio Mode switch', regie.studioModeSwitch()],
    ['Cut', regie.transitionOption('Cut')],
    ['Fade', regie.transitionOption('Fade')],
    ['Shorter fade', page.getByRole('button', { name: 'Shorter fade' })],
    ['Longer fade', page.getByRole('button', { name: 'Longer fade' })],
    ['Add device', regie.pairButton()],
    ['output chip', page.getByRole('button', { name: /^Output/ })],
    ['health button', page.locator('sf-status-line .c-status__health')],
    ['Layout', page.getByRole('button', { name: 'Layout', exact: true })],
    ['+ Source', page.getByRole('button', { name: 'Add source', exact: true })],
  ];
  if (studio) controls.push(['Take', regie.take()]);
  return controls;
}

async function checkMonitors(regie: RegiePage, studio: boolean, label: string): Promise<{ program: Box; preview: Box | null }> {
  const m = await metrics(regie.page);
  expect(m.program, `${label}: the Program monitor is rendered`).not.toBeNull();
  const viewport = regie.page.viewportSize()!;
  for (const [name, box] of [['Program', m.program], ['Preview', studio ? m.preview : null]] as const) {
    if (!box) continue;
    expect(Math.abs(box.w / box.h - 16 / 9), `${label}: ${name} monitor is 16:9 (${Math.round(box.w)}x${Math.round(box.h)})`).toBeLessThan(0.012);
    expect(box.x, `${label}: ${name} monitor starts inside the viewport`).toBeGreaterThanOrEqual(-0.5);
    expect(box.x + box.w, `${label}: ${name} monitor ends inside the viewport width`).toBeLessThanOrEqual(viewport.width + 0.5);
  }
  if (studio) expect(m.preview, `${label}: the Preview monitor is rendered in Studio Mode`).not.toBeNull();
  return { program: m.program!, preview: m.preview };
}

async function expectNoOverlappingControls(page: Page, label: string): Promise<void> {
  for (const scope of ['header.c-header', 'sf-control-column', 'sf-workspace']) {
    const overlaps = await findOverlaps(page, scope);
    expect(overlaps, `${label}: no overlapping controls in ${scope}`).toEqual([]);
  }
}

const tags = (priority: 'p0' | 'p1' | 'p2') => t.with(`@${priority}`, '@a11y', '@responsive');

/** The checks every desktop layout (>= 1280 wide, docks at the bottom) shares. */
async function checkDesktop(regie: RegiePage, options: { name: string; studio: boolean; compact: boolean }): Promise<void> {
  const { page } = regie;
  const viewport = page.viewportSize()!;
  const label = `${options.name} ${options.studio ? 'Studio Mode' : 'direct'}`;

  // no page scroll at all (the Regie is one screen)
  await expectNoOverflow(page, { vertical: false, label });

  const m = await metrics(page);
  expect(m.header!.h, `${label}: toolbar height`).toBeCloseTo(52, 0);
  expect(m.strip!.h, `${label}: the activity bar is one line of 36 px`).toBeCloseTo(36, 0);
  const monitors = await checkMonitors(regie, options.studio, label);
  expect(monitors.program.y + monitors.program.h, `${label}: the monitors end above the docks`).toBeLessThanOrEqual(m.bottomZone!.y + 0.5);

  // five docks side by side at the bottom
  expect(m.docks.map((dock) => dock.name), `${label}: five docks`).toEqual(['Scenes', 'Sources of the scene', 'Properties', 'Devices', 'Audio']);
  const tops = m.docks.map((dock) => Math.round(dock.box.y));
  expect(new Set(tops).size, `${label}: the docks share one top edge (${tops.join(', ')})`).toBe(1);
  for (let index = 1; index < m.docks.length; index++)
    expect(m.docks[index]!.box.x, `${label}: dock ${m.docks[index]!.name} is right of ${m.docks[index - 1]!.name}`).toBeGreaterThanOrEqual(m.docks[index - 1]!.box.x + m.docks[index - 1]!.box.w - 1);
  const last = m.docks.at(-1)!.box;
  expect(last.x + last.w, `${label}: the docks span the viewport width`).toBeCloseTo(viewport.width, 0);
  expect(last.y + last.h, `${label}: the docks end at the viewport bottom`).toBeCloseTo(viewport.height, 0);
  const zone = m.bottomZone!;
  expect(zone.h, `${label}: dock zone height clamp(240, 42dvh, 420) = ${CLAMP_DOCK_HEIGHT(viewport.height).toFixed(0)}`).toBeCloseTo(CLAMP_DOCK_HEIGHT(viewport.height), 0);
  expect(zone.h, `${label}: dock zone height is at least 150 px`).toBeGreaterThanOrEqual(150);
  expect(zone.h, `${label}: dock zone height is at most 420 px`).toBeLessThanOrEqual(420.5);

  // compact rules at heights <= 820: one-line scene rows with 48 px thumbnails, 36 px dock headers
  expect(m.dockHeadHeight, `${label}: dock header height`).toBeCloseTo(options.compact ? 36 : 40, 0);
  const rows = await page.locator('button.c-scene').evaluateAll((buttons) => buttons.map((button) => { const r = button.getBoundingClientRect(); return { y: r.y, h: r.height }; }));
  expect(rows, `${label}: seven scenes`).toHaveLength(7);
  if (options.compact) {
    expect(m.thumb!.w, `${label}: compact thumbnails are 48 px wide`).toBeCloseTo(48, 0);
    for (const row of rows) expect(row.h, `${label}: a compact scene row is one line (<= 36 px high)`).toBeLessThanOrEqual(36);
  } else {
    for (const row of rows) expect(row.h, `${label}: a two-line scene row is taller than 40 px`).toBeGreaterThan(40);
  }
  // all seven scenes visible without scrolling (inside their dock and the viewport)
  for (const [index, row] of rows.entries()) {
    expect(row.y, `${label}: scene ${index + 1} starts below the dock header`).toBeGreaterThanOrEqual(zone.y + m.dockHeadHeight! - 1);
    expect(row.y + row.h, `${label}: scene ${index + 1} ends inside the viewport`).toBeLessThanOrEqual(viewport.height + 0.5);
  }
  const scrolls = await page.locator('sf-dock-slot[aria-label=Scenes] .c-dock-frame__body').evaluate((body) => ({ scrollable: body.scrollHeight > body.clientHeight + 1, scrollHeight: body.scrollHeight, clientHeight: body.clientHeight }));
  expect(scrolls.scrollable, `${label}: the Scenes dock does not scroll (${scrolls.scrollHeight} > ${scrolls.clientHeight})`).toBe(false);

  // the critical controls are inside the viewport and not covered
  for (const [name, locator] of criticalControls(regie, options.studio)) await expectInViewport(locator.first(), `${label}: ${name}`);
  await expectInViewport(regie.scene('Welcome'), `${label}: first scene`);
  await expectInViewport(regie.scene('Credits'), `${label}: last scene`);

  await expectNoOverlappingControls(page, label);
}

async function openPopoversAndCheck(regie: RegiePage, label: string): Promise<void> {
  const { page } = regie;
  const viewport = page.viewportSize()!;
  const triggers: Array<[string, Locator]> = [
    ['Output', page.getByRole('button', { name: /^Output/ })],
    ['Layout', page.getByRole('button', { name: 'Layout', exact: true })],
    ['+ Source', page.getByRole('button', { name: 'Add source', exact: true })],
  ];
  for (const [name, trigger] of triggers) {
    await trigger.click();
    const popover = page.locator('.c-pop').first();
    await expect(popover, `${label}: popover of ${name} opens`).toBeVisible();
    const box = (await boxOf(popover))!;
    expect(box.x, `${label}: popover of ${name} starts inside the viewport`).toBeGreaterThanOrEqual(-0.5);
    expect(box.x + box.w, `${label}: popover of ${name} ends inside the viewport width`).toBeLessThanOrEqual(viewport.width + 0.5);
    expect(box.y, `${label}: popover of ${name} starts inside the viewport`).toBeGreaterThanOrEqual(-0.5);
    expect(box.y + box.h, `${label}: popover of ${name} ends inside the viewport height`).toBeLessThanOrEqual(viewport.height + 0.5);
    await page.keyboard.press('Escape');
    await expect(popover).toBeHidden();
  }
}

test.describe('Regie responsive layout', () => {
  for (const viewport of [VIEWPORTS.w1280, VIEWPORTS.w1366]) {
    const name = `${viewport.width}x${viewport.height}`;
    test(`E2E-DEV-01 [regie-${name}] one screen without scroll: toolbar 52 px, activity bar 36 px, 16:9 monitors, five docks at the bottom, compact scene rows, critical controls in the viewport`, tags('p0'), async ({ openRegie, pairContext, onCleanup }) => {
      test.setTimeout(120_000);
      const { regie } = await openBusyRegie({ openRegie, pairContext, onCleanup }, { viewport, incident: 'reconnecting', studio: false });
      await expect(regie.page.getByRole('region', { name: 'Activity' }), 'the incident is visible in the activity bar').toContainText('reconnecting');
      await checkDesktop(regie, { name, studio: false, compact: true });
      await saveScreen(regie.page, `regie-${name}-direct`);
      await openPopoversAndCheck(regie, `${name} direct`);

      await regie.setStudioMode(true);
      await settle(regie.page);
      await checkDesktop(regie, { name, studio: true, compact: true });
      await saveScreen(regie.page, `regie-${name}-studio`);
      await openPopoversAndCheck(regie, `${name} Studio Mode`);
      expect(regie.problems.pageErrors, 'no uncaught error').toEqual([]);
    });
  }

  test('E2E-DEV-02 [regie-1440x900] the first-viewport composition of the brief: header, strip, monitors with the 176 px control column, docks; two-line scene rows, 40 px dock headers', tags('p1'), async ({ openRegie, pairContext, onCleanup }) => {
    test.setTimeout(120_000);
    const viewport = VIEWPORTS.w1440;
    const { regie } = await openBusyRegie({ openRegie, pairContext, onCleanup }, { viewport, incident: 'reconnecting', studio: false });
    await checkDesktop(regie, { name: '1440x900', studio: false, compact: false });
    const m = await metrics(regie.page);
    expect(m.control!.w, 'the control column is 176 px wide').toBeCloseTo(176, 0);
    await saveScreen(regie.page, 'regie-1440x900-direct');
    await openPopoversAndCheck(regie, '1440x900 direct');
    await regie.setStudioMode(true);
    await settle(regie.page);
    await checkDesktop(regie, { name: '1440x900', studio: true, compact: false });
    const studio = await metrics(regie.page);
    expect(studio.control!.w, 'the control column is still 176 px wide in Studio Mode').toBeCloseTo(176, 0);
    expect(studio.take!.w, 'Take is as wide as the column').toBeCloseTo(176, 0);
    expect(studio.take!.h, 'Take is at least 56 px high').toBeGreaterThanOrEqual(56);
    await saveScreen(regie.page, 'regie-1440x900-studio');
  });

  test('E2E-DEV-03 [regie-1920x1080] monitors scale up but stay 16:9 inside their container, docks at most 420 px high, inspector rows keep their layout', tags('p1'), async ({ openRegie, pairContext, onCleanup }) => {
    test.setTimeout(120_000);
    const viewport = VIEWPORTS.w1920;
    const { regie } = await openBusyRegie({ openRegie, pairContext, onCleanup }, { viewport, incident: 'reconnecting', studio: false });
    await checkDesktop(regie, { name: '1920x1080', studio: false, compact: false });
    const direct = await metrics(regie.page);
    expect(direct.program!.w, 'the Program monitor scales up beyond its 1440 px size').toBeGreaterThan(800);
    expect(direct.bottomZone!.h, 'docks are at most 420 px high').toBeLessThanOrEqual(420.5);
    // the monitor never exceeds the stage region (monitors left of the control column)
    expect(direct.program!.x + direct.program!.w, 'Program ends before the control column').toBeLessThanOrEqual(direct.control!.x + 0.5);
    // inspector rows keep their layout: label left of its field, one row, the field not wider than the dock
    const inspector = await regie.page.locator('sf-dock-slot[aria-label=Properties]').evaluate((dock) => {
      const dockBox = dock.getBoundingClientRect();
      const field = dock.querySelector<HTMLElement>('input[type=text], input:not([type])');
      const label = field?.closest('label, div, sf-scene-inspector')?.querySelector('span, label');
      const fieldBox = field?.getBoundingClientRect();
      const labelBox = label?.getBoundingClientRect();
      return { dock: { w: dockBox.width }, field: fieldBox ? { x: fieldBox.x, y: fieldBox.y, w: fieldBox.width, h: fieldBox.height } : null, label: labelBox ? { x: labelBox.x, y: labelBox.y, w: labelBox.width, h: labelBox.height } : null };
    });
    expect(inspector.field, 'the scene name field exists').not.toBeNull();
    expect(inspector.field!.w, 'the name field is not wider than the dock').toBeLessThanOrEqual(inspector.dock.w);
    expect(inspector.field!.w, 'the name field keeps a readable width (<= 420 px)').toBeLessThanOrEqual(420);
    expect(inspector.field!.h, 'the name field keeps the 28 px control height (--control-h)').toBeCloseTo(28, 0);
    await saveScreen(regie.page, 'regie-1920x1080-direct');
    await regie.setStudioMode(true);
    await settle(regie.page);
    await checkDesktop(regie, { name: '1920x1080', studio: true, compact: false });
    const studio = await metrics(regie.page);
    expect(studio.preview!.x + studio.preview!.w, 'Preview ends before Program starts').toBeLessThanOrEqual(studio.program!.x + 0.5);
    await saveScreen(regie.page, 'regie-1920x1080-studio');
  });

  test('E2E-DEV-04 [regie-1180x800] docks stack in a two-column grid below the stage, the page scrolls vertically only, grips and splitters are hidden, Take is reachable', tags('p0'), async ({ openRegie, pairContext, onCleanup }) => {
    test.setTimeout(120_000);
    const viewport = VIEWPORTS.w1180;
    const { regie } = await openBusyRegie({ openRegie, pairContext, onCleanup }, { viewport, incident: 'reconnecting', studio: false });
    const { page } = regie;
    for (const studio of [false, true]) {
      const label = `1180x800 ${studio ? 'Studio Mode' : 'direct'}`;
      if (studio) {
        await regie.setStudioMode(true);
        await settle(page);
      }
      await expectNoOverflow(page, { label });
      const report = await overflowReport(page);
      expect(report.scrollHeight, `${label}: the page scrolls vertically (stacked docks)`).toBeGreaterThan(report.clientHeight);

      const m = await metrics(page);
      await checkMonitors(regie, studio, label);
      // two-column grid below the stage: Scenes | Sources over Properties | Devices, hairline separated
      const byName = Object.fromEntries(m.docks.map((dock) => [dock.name, dock.box]));
      expect(m.docks.map((dock) => dock.name)).toEqual(['Scenes', 'Sources of the scene', 'Properties', 'Devices', 'Audio']);
      const stageBottom = m.program!.y + m.program!.h;
      expect(byName['Scenes']!.y, `${label}: the docks start below the stage`).toBeGreaterThan(stageBottom);
      expect(Math.abs(byName['Scenes']!.y - byName['Sources of the scene']!.y), `${label}: Scenes and Sources share the first row`).toBeLessThan(2);
      expect(Math.abs(byName['Properties']!.y - byName['Devices']!.y), `${label}: Properties and Devices share the second row`).toBeLessThan(2);
      expect(byName['Properties']!.y, `${label}: the second row is below the first`).toBeGreaterThan(byName['Scenes']!.y + byName['Scenes']!.h - 2);
      expect(byName['Sources of the scene']!.x, `${label}: two columns`).toBeGreaterThan(byName['Scenes']!.x + byName['Scenes']!.w - 2);
      expect(Math.abs(byName['Scenes']!.x - byName['Properties']!.x), `${label}: the columns line up`).toBeLessThan(2);

      // grips and workspace splitters are hidden (display: none), not merely inert
      const hidden = await page.evaluate(() => {
        const visible = (element: Element) => { const s = getComputedStyle(element); const r = element.getBoundingClientRect(); return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0; };
        return {
          grips: Array.from(document.querySelectorAll('.c-dock-frame__grip')).filter(visible).length,
          workspaceSplits: Array.from(document.querySelectorAll('.c-workspace__split, .c-dock-slot__split')).filter(visible).length,
        };
      });
      expect(hidden.grips, `${label}: drag grips are hidden`).toBe(0);
      expect(hidden.workspaceSplits, `${label}: dock splitters are hidden`).toBe(0);

      // header wraps without overlap, no overlapping controls
      await expectNoOverlappingControls(page, label);
      // Take is reachable by scrolling and by keyboard
      if (studio) {
        await regie.take().scrollIntoViewIfNeeded();
        await expectInViewport(regie.take(), `${label}: Take after scrolling`);
      }
      await regie.pairButton().scrollIntoViewIfNeeded();
      await expectInViewport(regie.pairButton(), `${label}: Add device after scrolling`);
      await page.evaluate(() => window.scrollTo(0, 0));
      await saveScreen(page, `regie-1180x800-${studio ? 'studio' : 'direct'}`);
      await saveScreen(page, `regie-1180x800-${studio ? 'studio' : 'direct'}-full`, { fullPage: true });
    }
    // the pairing dock spans both columns
    await regie.openPairing('phone');
    await settle(page);
    const pairing = await boxOf(page.locator('sf-dock-slot[data-dock=pair]'));
    expect(pairing, 'the pairing dock is rendered').not.toBeNull();
    const workspace = (await boxOf(page.locator('sf-workspace')))!;
    expect(pairing!.w, 'the pairing dock spans both columns').toBeGreaterThan(workspace.w - 80);
    await expectNoOverflow(page, { label: '1180x800 pairing dock' });
    await saveScreen(page, '1180x800-pairing', { fullPage: true });
    expect(regie.problems.pageErrors).toEqual([]);
  });

  test('E2E-DEV-04 [regie-1180x800, no dead tab stop] in the stacked layout no separator is focusable: the Preview/Program splitter is hidden or removed from the tab order', tags('p1'), async ({ openRegie, pairContext, onCleanup }) => {
    test.setTimeout(120_000);
    knownBug('A11Y-05', 'at <= 1180 px the Preview/Program splitter stays visible and focusable (role=separator, tabindex=0) although it is disabled and does nothing');
    const { regie } = await openBusyRegie({ openRegie, pairContext, onCleanup }, { viewport: VIEWPORTS.w1180, incident: null, studio: true, stations: 2 });
    const stops = await tabThrough(regie.page);
    expect(stops.filter((stop) => stop.info.role === 'separator').map((stop) => labelOf(stop.info)), 'no separator is a tab stop in the stacked layout (resizing is off)').toEqual([]);
  });

  test('E2E-DEV-04 [regie-1180x800, layout persisted] a layout saved at a wide size survives the stacked view', tags('p1'), async ({ openRegie, pairContext, onCleanup }) => {
    test.setTimeout(120_000);
    const { regie } = await openBusyRegie({ openRegie, pairContext, onCleanup }, { viewport: VIEWPORTS.w1440, incident: null });
    const { page } = regie;
    // move a dock to the right zone with the grip keys, remember the stored layout (Audio is the last dock of the bottom zone)
    const grip = page.getByRole('button', { name: 'Move dock Audio with the arrow keys' });
    await grip.focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('[data-zone=right] sf-dock-slot[aria-label=Audio]')).toHaveCount(1);
    const stored = await page.evaluate(() => localStorage.getItem('studioflow.layout'));
    expect(stored, 'the layout is stored').not.toBeNull();
    await page.setViewportSize(VIEWPORTS.w1180);
    await settle(page);
    await expectNoOverflow(page, { label: 'stacked with a moved dock' });
    expect(await page.evaluate(() => localStorage.getItem('studioflow.layout')), 'the stacked view leaves the stored layout alone').toBe(stored);
    await page.setViewportSize(VIEWPORTS.w1440);
    await settle(page);
    await expect(page.locator('[data-zone=right] sf-dock-slot[aria-label=Audio]'), 'the dock is on the right again at the wide size').toHaveCount(1);
  });

  test('E2E-DEV-05 [regie-900x700] one column by priority: Program, controls (Take full width, >= 48 px), Preview, docks in one column; scenes as a 200 px card strip; strip shows only ok and incidents', tags('p0'), async ({ openRegie, pairContext, onCleanup }) => {
    test.setTimeout(120_000);
    const viewport = VIEWPORTS.w900;
    const { regie } = await openBusyRegie({ openRegie, pairContext, onCleanup }, { viewport, incident: 'reconnecting', studio: false });
    const { page } = regie;
    for (const studio of [false, true]) {
      const label = `900x700 ${studio ? 'Studio Mode' : 'direct'}`;
      if (studio) {
        await regie.setStudioMode(true);
        await settle(page);
      }
      await expectNoOverflow(page, { label });
      const m = await metrics(page);
      // order top to bottom: Program, controls, (Preview), docks
      expect(m.program!.y, `${label}: Program is below the toolbar and the activity bar`).toBeGreaterThan(m.strip!.y + m.strip!.h - 1);
      expect(m.control!.y, `${label}: the controls follow the Program monitor`).toBeGreaterThanOrEqual(m.program!.y + m.program!.h - 1);
      if (studio) {
        expect(m.preview, `${label}: Preview is rendered`).not.toBeNull();
        expect(m.preview!.y, `${label}: Preview follows the controls`).toBeGreaterThanOrEqual(m.control!.y + m.control!.h - 1);
        expect(m.take!.w, `${label}: Take is full width`).toBeGreaterThan(m.control!.w - 4);
        expect(m.take!.h, `${label}: Take is at least 48 px high`).toBeGreaterThanOrEqual(48);
      }
      const firstDock = m.docks[0]!.box;
      const above = studio ? m.preview! : m.control!;
      expect(firstDock.y, `${label}: the docks follow`).toBeGreaterThanOrEqual(above.y + above.h - 1);
      // docks in one column
      expect(new Set(m.docks.map((dock) => Math.round(dock.box.x))).size, `${label}: docks share one column`).toBe(1);
      for (let index = 1; index < m.docks.length; index++) expect(m.docks[index]!.box.y, `${label}: ${m.docks[index]!.name} below ${m.docks[index - 1]!.name}`).toBeGreaterThanOrEqual(m.docks[index - 1]!.box.y + m.docks[index - 1]!.box.h - 1);
      expect(m.docks.map((dock) => dock.name)).toEqual(['Scenes', 'Sources of the scene', 'Properties', 'Devices', 'Audio']);
      // the controls are two columns: the segmented control and the stepper side by side
      const transition = (await boxOf(page.getByRole('group', { name: 'Transition type' })))!;
      const stepper = (await boxOf(page.getByRole('group', { name: 'Fade duration' })))!;
      expect(Math.abs(transition.y - stepper.y), `${label}: Transition and the duration stepper share a row`).toBeLessThan(6);
      expect(stepper.x, `${label}: the stepper is right of the Transition control`).toBeGreaterThan(transition.x + transition.w - 2);
      // scenes: a horizontal strip of 200 px cards
      const cards = await page.locator('button.c-scene').evaluateAll((buttons) => buttons.map((button) => { const r = button.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }));
      expect(cards, `${label}: seven scene cards`).toHaveLength(7);
      const rows = cards.map((card) => card.y);
      // 2 px of tolerance: the cards sit on fractional pixels
      expect(Math.max(...rows) - Math.min(...rows), `${label}: the scene cards share one row (y ${JSON.stringify(rows.map(Math.round))})`).toBeLessThanOrEqual(2);
      for (const [index, card] of cards.entries()) expect(card.w, `${label}: scene card ${index + 1} is 200 px wide`).toBeCloseTo(200, 0);
      const strip = await page.locator('sf-dock-slot[aria-label=Scenes] .c-dock-frame__body, sf-dock-slot[aria-label=Scenes] .c-scenes-dock__list').evaluateAll((elements) => elements.map((element) => ({ cls: element.className, scrollW: element.scrollWidth, clientW: element.clientWidth, overflowX: getComputedStyle(element).overflowX })));
      expect(strip.some((entry) => entry.scrollW > entry.clientW + 1 && /(auto|scroll)/.test(entry.overflowX)), `${label}: the scene strip scrolls horizontally inside its dock (${JSON.stringify(strip)})`).toBe(true);
      await saveScreen(page, `regie-900x700-${studio ? 'studio' : 'direct'}`);
      await saveScreen(page, `regie-900x700-${studio ? 'studio' : 'direct'}-full`, { fullPage: true });
    }
    // the activity bar: the incident is shown
    await expect(page.getByRole('region', { name: 'Activity' })).toContainText('reconnecting');
  });

  test('E2E-DEV-05 [regie-900x700, activity bar] without an incident the activity bar shows the device health; the latest event shows at 1440 px and gives way at 900 px; one line', tags('p1'), async ({ openRegie, pairContext, onCleanup }) => {
    test.setTimeout(120_000);
    const { regie } = await openBusyRegie({ openRegie, pairContext, onCleanup }, { viewport: VIEWPORTS.w900, incident: null });
    const strip = regie.page.getByRole('region', { name: 'Activity' });
    const health = strip.locator('.c-status__health');
    await expect(health).toHaveText(/^All \d+ devices OK$/);
    const latest = strip.locator('.c-status__log');
    // the latest event at a wide size ...
    await regie.page.setViewportSize(VIEWPORTS.w1440);
    await expect(latest, 'the latest event is shown at 1440 px').toBeVisible();
    // ... gives way at 900 px
    await regie.page.setViewportSize(VIEWPORTS.w900);
    await settle(regie.page);
    await expect(health).toBeVisible();
    await expect(latest, 'the latest event is hidden at 900 px').toBeHidden();
    await expect(strip.getByRole('link', { name: 'Activity log' })).toBeVisible();
    expect((await boxOf(strip))!.h, 'the activity bar stays one line of 36 px').toBeCloseTo(36, 0);
  });

  test('E2E-DEV-06 [regie-390x844] phone-sized: no horizontal scroll, Take >= 48 px, scene cards >= 44 px, every control reachable by scrolling, toast fits; touch operation', tags('p1'), async ({ openRegie, pairContext, onCleanup }) => {
    test.setTimeout(150_000);
    const viewport = VIEWPORTS.w390;
    const { regie } = await openBusyRegie({ openRegie, pairContext, onCleanup }, { viewport, touch: true, incident: 'reconnecting', studio: false });
    const { page } = regie;
    await expectNoOverflow(page, { label: '390x844 direct' });
    await saveScreen(page, 'regie-390x844-direct');
    await saveScreen(page, 'regie-390x844-direct-full', { fullPage: true });
    await expectNoOverlappingControlsAt390(page);

    // switch a scene by tap: Studio Mode off -> the Program changes at once, the toast fits the viewport
    const target = regie.scene('Break');
    await target.scrollIntoViewIfNeeded();
    await target.tap();
    await expect(regie.scene('Break')).toHaveAttribute('aria-pressed', 'true');
    const toast = regie.toast().first();
    await expect(toast, 'a toast confirms the switch').toBeVisible();
    const toastBox = (await boxOf(toast))!;
    const scrollY = await page.evaluate(() => window.scrollY);
    expect(toastBox.w, 'the toast fits max-width calc(100vw - 32px)').toBeLessThanOrEqual(viewport.width - 32 + 1);
    expect(toastBox.x - 0, 'the toast starts inside the viewport').toBeGreaterThanOrEqual(0);
    expect(toastBox.x + toastBox.w, 'the toast ends inside the viewport').toBeLessThanOrEqual(viewport.width + 0.5);
    void scrollY;

    await regie.setStudioMode(true);
    await settle(page);
    await expectNoOverflow(page, { label: '390x844 Studio Mode' });
    const m = await metrics(page);
    expect(m.take!.h, 'Take is at least 48 px high').toBeGreaterThanOrEqual(48);
    const cards = await page.locator('button.c-scene').evaluateAll((buttons) => buttons.map((button) => { const r = button.getBoundingClientRect(); return { w: r.width, h: r.height }; }));
    for (const [index, card] of cards.entries()) expect(card.h, `scene card ${index + 1} is at least 44 px high`).toBeGreaterThanOrEqual(44);
    await saveScreen(page, 'regie-390x844-studio');
    await saveScreen(page, 'regie-390x844-studio-full', { fullPage: true });

    // every control is reachable: scroll it into view and it lies inside the viewport
    const unreachable: string[] = [];
    const controls = await page.locator('button:visible, a[href]:visible, input:visible, select:visible, [role=switch]:visible').all();
    for (const control of controls) {
      // a transient control (the Dismiss button of a toast that timed out) may be gone by now: the list shrank by one
      if ((await control.count()) === 0) continue;
      const name = (await control.getAttribute('aria-label')) ?? ((await control.innerText().catch(() => '')) || (await control.getAttribute('class')) || 'control');
      if (/\bu-sr-only\b/.test((await control.getAttribute('class')) ?? '')) continue;
      await control.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => undefined);
      const reached = await control.evaluate((element) => {
        const r = element.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.left >= -0.5 && r.right <= window.innerWidth + 0.5 && r.top < window.innerHeight && r.bottom > 0;
      });
      if (!reached) unreachable.push(name.replace(/\s+/g, ' ').slice(0, 50));
    }
    expect(unreachable, 'every control can be scrolled into the viewport').toEqual([]);

    // informational: controls smaller than 44 px (GAP-38: DESIGN.md keeps 26-30 px controls in the Regie)
    const small = await page.evaluate(() =>
      Array.from(document.querySelectorAll('button, a[href], input, select, [role=switch]'))
        .filter((element) => { const s = getComputedStyle(element); const r = element.getBoundingClientRect(); return s.display !== 'none' && r.width > 0 && r.height > 0 && !element.closest('.u-sr-only') && Math.min(r.width, r.height) < 44; })
        .map((element) => { const r = element.getBoundingClientRect(); return `${element.getAttribute('aria-label') ?? (element as HTMLElement).innerText?.replace(/\s+/g, ' ').trim().slice(0, 30) ?? element.tagName} ${Math.round(r.width)}x${Math.round(r.height)}`; }),
    );
    await test.info().attach('controls-under-44px.json', { body: JSON.stringify({ gap: 'GAP-38 (informational)', count: small.length, controls: small }, null, 2), contentType: 'application/json' });
    test.info().annotations.push({ type: 'gap', description: `GAP-38: ${small.length} controls under 44 px at 390x844 (informational list attached)` });

    // touch operation: open the pairing dock and expand a station by tap
    await regie.pairButton().scrollIntoViewIfNeeded();
    await regie.pairButton().tap();
    await expect(regie.pairingTab('phone')).toBeVisible();
    await regie.pairingDock().getByRole('button', { name: 'Close add device' }).tap();
    const station = regie.page.locator('.c-st__row').first();
    await station.scrollIntoViewIfNeeded();
    await station.tap();
    await expect(station).toHaveAttribute('aria-expanded', 'true');
    expect(regie.problems.pageErrors).toEqual([]);
  });
});

async function expectNoOverlappingControlsAt390(page: Page): Promise<void> {
  for (const scope of ['header.c-header', 'sf-control-column', 'sf-workspace']) {
    const overlaps = await findOverlaps(page, scope);
    expect(overlaps, `390x844: no overlapping controls in ${scope}`).toEqual([]);
  }
}

void openRegieOn;
