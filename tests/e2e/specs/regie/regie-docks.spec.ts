import type { Locator, Page } from '@playwright/test';
import { PixelImage } from '../../support/ui/pixels';
import { PublicApi } from '../../support/api';
import { t } from '../../support/tags';
import { expect, test } from '../../support/ui/fixtures';
import { Gesture, SCENES, scenesDock, stationsDock, toastOf } from '../../support/regie/kit';
import { uniqueIp } from '../../support/fixtures';
import { RegiePage } from '../../support/ui/regie';
import { regieBug } from '../../support/regie/bugs';

/**
 * DOCK in the Regie UI (docs/testing.md 2.9: E2E-DOCK-01 ... 10, 2.8 E2E-DEV-14): default arrangement, dragging docks with
 * the drop strips and the insertion line, splitters by pointer and keyboard, hide/show, reset, corrupted storage, the
 * pairing dock, Studio Mode layout stability, per-browser persistence, side zones. The layout lives in
 * `localStorage['studioflow.layout']` (version 1).
 */

test.use({ viewport: { width: 1440, height: 900 } });

type DockId = 'scenes' | 'src' | 'insp' | 'st' | 'audio';
const TITLES: Record<DockId, string> = {
  scenes: 'Scenes',
  src: 'Sources',
  insp: 'Properties',
  st: 'Stations',
  audio: 'Audio',
};
const DEFAULT_WEIGHTS = { scenes: 0.95, src: 1, insp: 1.2, st: 1.1, audio: 1.4, pair: 2.2 };
const DEFAULT_LAYOUT = {
  v: 1,
  zones: { left: [], bottom: ['scenes', 'src', 'insp', 'st', 'audio'], right: [] },
  weights: DEFAULT_WEIGHTS,
  hidden: [],
  bottomH: null,
  leftW: 320,
  rightW: 340,
  split: 0.5,
};
const BLUE = 'rgb(121, 192, 255)';

const dock = (page: Page, id: string): Locator => page.locator(`sf-dock-slot[data-dock="${id}"]`);
const zoneOf = (page: Page, id: string) =>
  dock(page, id).evaluate(
    (element) => element.closest('[data-zone]')?.getAttribute('data-zone') ?? null,
  );
const stored = (page: Page) =>
  page.evaluate(() => {
    const raw = localStorage.getItem('studioflow.layout');
    return raw === null ? null : (JSON.parse(raw) as Record<string, any>);
  });
const sep = (page: Page, name: string) => page.getByRole('separator', { name });

/** Docks of a zone by position (left to right in the bottom zone, top to bottom in the side zones). */
async function order(page: Page, zone: 'left' | 'bottom' | 'right'): Promise<string[]> {
  return page.evaluate(
    (name) =>
      [
        ...document.querySelectorAll(
          `[data-zone="${name}"] > sf-dock-slot[data-dock], [data-zone="${name}"] sf-dock-slot[data-dock]`,
        ),
      ].map((element) => element.getAttribute('data-dock') ?? ''),
    zone,
  );
}

/** Waits until a measured size is within `tolerance` of `target` (layout updates land after the input event). */
async function expectClose(
  read: () => Promise<number>,
  target: number,
  tolerance: number,
  message: string,
): Promise<void> {
  await expect
    .poll(async () => Math.abs((await read()) - target), { message, timeout: 4000 })
    .toBeLessThanOrEqual(tolerance);
}

/** Waits until a dock sits in a zone. */
async function expectZone(
  page: Page,
  id: string,
  zone: 'left' | 'bottom' | 'right',
  message?: string,
): Promise<void> {
  await expect
    .poll(() => zoneOf(page, id), {
      message: message ?? `${id} is in the ${zone} zone`,
      timeout: 5000,
    })
    .toBe(zone);
}

/** Waits until the docks of a zone are in this order (the view moves in an effect after the click). */
async function expectOrder(
  page: Page,
  zone: 'left' | 'bottom' | 'right',
  expected: string[],
  message?: string,
): Promise<void> {
  await expect
    .poll(() => order(page, zone), { message: message ?? `${zone} zone order`, timeout: 5000 })
    .toEqual(expected);
}

async function seedLayout(regie: RegiePage, layout: unknown): Promise<void> {
  await regie.page.evaluate(
    (value) =>
      localStorage.setItem(
        'studioflow.layout',
        typeof value === 'string' ? value : JSON.stringify(value),
      ),
    layout,
  );
  await regie.page.reload();
  await regie.waitReady();
}

async function center(locator: Locator): Promise<{ x: number; y: number }> {
  const box = (await locator.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function startDockDrag(
  page: Page,
  id: DockId,
): Promise<{ gesture: Gesture; start: { x: number; y: number } }> {
  const start = await center(dock(page, id).locator('.c-dock-frame__title'));
  const gesture = new Gesture(page);
  await gesture.begin(start);
  await gesture.to({ x: start.x + 10, y: start.y - 4 }, 3);
  return { gesture, start };
}

const zoneBox = (page: Page, zone: string) =>
  page.locator(`.c-workspace__zone--${zone}`).boundingBox();

test.describe('REGIE docks', () => {
  test(
    'E2E-DOCK-01 [regie] default arrangement: Scenes | Sources | Properties | Stations | Audio at the bottom, side zones empty, height clamp(240 px, 42 dvh, 420 px), 1 px seams',
    t.p0,
    async ({ regie }) => {
      const page = regie.page;
      for (const viewport of [
        { width: 1440, height: 900 },
        { width: 1280, height: 720 },
      ]) {
        await page.setViewportSize(viewport);
        await page.reload();
        await regie.waitReady();
        const label = `${viewport.width}x${viewport.height}`;
        await expectOrder(page, 'bottom', ['scenes', 'src', 'insp', 'st', 'audio'], `${label}: order`);
        await expectOrder(page, 'left', []);
        await expectOrder(page, 'right', []);
        await expect(page.locator('.c-workspace__zone--left')).toHaveClass(/is-empty/);
        await expect(page.locator('.c-workspace__zone--right')).toHaveClass(/is-empty/);
        const xs = await Promise.all(
          (['scenes', 'src', 'insp', 'st', 'audio'] as const).map(
            async (id) => (await dock(page, id).boundingBox())!.x,
          ),
        );
        expect(xs, `${label}: left to right`).toEqual([...xs].sort((a, b) => a - b));
        const bottom = (await zoneBox(page, 'bottom'))!;
        const expected = Math.min(420, Math.max(240, viewport.height * 0.42));
        expect(
          Math.abs(bottom.height - expected),
          `${label}: bottom zone ${bottom.height} px, expected ${expected} px`,
        ).toBeLessThanOrEqual(2);
        expect(bottom.height).toBeGreaterThanOrEqual(150);
        // The seams between docks are 1 px wide.
        const widths = await page
          .locator('.c-dock-slot__split--across')
          .evaluateAll((elements) =>
            elements.map((element) => element.getBoundingClientRect().width),
          );
        expect(widths).toEqual([1, 1, 1, 1]);
        // Nothing is stored before the first change.
        const layout = await stored(page);
        expect(layout === null || layout['v'] === 1).toBe(true);
      }
      expect(regie.problems.pageErrors).toEqual([]);
    },
  );

  test(
    'E2E-DOCK-02 [regie] drag docks to the right, the left and back between two docks: ghost, drop strips, 3 px insertion line, toast with “Reset layout”, side widths, storage; under 5 px, Escape and pointercancel do nothing',
    t.smoke,
    async ({ regie }) => {
      const page = regie.page;
      const toast = toastOf(page);

      // Under 5 px: nothing happens.
      const title = await center(dock(page, 'st').locator('.c-dock-frame__title'));
      let gesture = await new Gesture(page).begin(title);
      await gesture.to({ x: title.x + 3, y: title.y }, 2);
      await expect(page.locator('.c-dock-ghost')).toHaveCount(0);
      await gesture.end();
      await expect(toast).toHaveCount(0);
      await expectOrder(page, 'bottom', ['scenes', 'src', 'insp', 'st', 'audio']);

      // Stations to the right edge: both empty zones show a dashed strip, the ghost follows the pointer.
      let drag = await startDockDrag(page, 'st');
      await expect(page.locator('.c-dock-ghost')).toBeVisible();
      await expect(page.locator('.c-dock-ghost')).toContainText('Stations');
      await expect(page.locator('[data-strip="right"]')).toHaveText('Dock on the right');
      await expect(page.locator('[data-strip="left"]')).toHaveText('Dock on the left');
      await expect(
        page.locator('[data-strip="bottom"]'),
        'the bottom zone holds docks: no strip, an insertion line instead',
      ).toHaveCount(0);
      expect(
        Number(await dock(page, 'st').evaluate((element) => getComputedStyle(element).opacity)),
        'the dragged dock fades',
      ).toBeLessThan(1);
      await drag.gesture.to(await center(page.locator('[data-strip="right"]')), 8);
      await expect(page.locator('[data-strip="right"]')).toHaveClass(/is-hot/);
      await drag.gesture.end();
      await expect(toast).toContainText('Stations is docked on the right');
      await expect(toast.getByRole('button', { name: 'Reset layout' })).toBeVisible();
      await expectZone(page, 'st', 'right');
      expect(Math.round((await zoneBox(page, 'right'))!.width), 'a new right zone is 340 px').toBe(
        340,
      );
      let layout = await stored(page);
      expect(layout).toMatchObject({
        v: 1,
        zones: { left: [], bottom: ['scenes', 'src', 'insp', 'audio'], right: ['st'] },
      });

      // Then to the left edge (the right zone holds only Stations, so it counts as empty again): 320 px.
      drag = await startDockDrag(page, 'st');
      await drag.gesture.to(await center(page.locator('[data-strip="left"]')), 8);
      await expect(page.locator('[data-strip="left"]')).toHaveClass(/is-hot/);
      await drag.gesture.end();
      await expect(toast).toContainText('Stations is docked on the left');
      await expectZone(page, 'st', 'left');
      expect(Math.round((await zoneBox(page, 'left'))!.width), 'a new left zone is 320 px').toBe(
        320,
      );

      // Back to the bottom, between Scenes and Sources: a 3 px blue insertion line shows the target.
      drag = await startDockDrag(page, 'st');
      const scenes = (await dock(page, 'scenes').boundingBox())!;
      await drag.gesture.to(
        { x: scenes.x + scenes.width * 0.8, y: scenes.y + scenes.height / 2 },
        10,
      );
      const line = page.locator('.c-drop-line');
      await expect(line).toBeVisible();
      const lineBox = (await line.boundingBox())!;
      expect(Math.round(lineBox.width), 'insertion line is 3 px wide').toBe(3);
      expect(await line.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(
        BLUE,
      );
      await drag.gesture.end();
      await expect(toast).toContainText('Stations is docked at the bottom');
      await expectOrder(page, 'bottom', ['scenes', 'st', 'src', 'insp', 'audio']);
      layout = await stored(page);
      expect(layout).toMatchObject({
        v: 1,
        zones: { left: [], bottom: ['scenes', 'st', 'src', 'insp', 'audio'], right: [] },
      });
      await expect(page.locator('.c-drop-line')).toBeHidden();

      // Escape during a drag: the layout stays.
      drag = await startDockDrag(page, 'scenes');
      await expect(page.locator('.c-dock-ghost')).toBeVisible();
      await drag.gesture.to(await center(page.locator('[data-strip="right"]')), 6);
      await page.keyboard.press('Escape');
      await expect(page.locator('.c-dock-ghost')).toHaveCount(0);
      await drag.gesture.end();
      await expectOrder(
        page,
        'bottom',
        ['scenes', 'st', 'src', 'insp', 'audio'],
        'Escape leaves the layout as it was',
      );
      await expectZone(page, 'scenes', 'bottom');

      // pointercancel: the same.
      drag = await startDockDrag(page, 'scenes');
      await drag.gesture.to(await center(page.locator('[data-strip="left"]')), 6);
      await page.evaluate(() =>
        document.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1, bubbles: true })),
      );
      await expect(page.locator('.c-dock-ghost')).toHaveCount(0);
      await drag.gesture.end();
      await expectOrder(page, 'bottom', ['scenes', 'st', 'src', 'insp', 'audio']);
      // The arrangement survives a reload.
      await page.reload();
      await regie.waitReady();
      await expectOrder(
        page,
        'bottom',
        ['scenes', 'st', 'src', 'insp', 'audio'],
        'order after a reload',
      );
      expect(regie.problems.pageErrors).toEqual([]);
    },
  );

  test(
    'E2E-DOCK-03 [regie] splitters by pointer: bottom height, side width, between two docks and Preview/Program follow within their limits, turn blue, reset on double-click and persist',
    t.p1,
    async ({ regie }) => {
      const page = regie.page;
      await seedLayout(regie, {
        ...DEFAULT_LAYOUT,
        zones: { left: ['insp'], bottom: ['scenes', 'src'], right: ['st'] },
      });
      const dragSeparator = async (name: string, dx: number, dy: number) => {
        const start = await center(sep(page, name));
        const gesture = new Gesture(page);
        await gesture.begin(start);
        await gesture.to({ x: start.x + dx, y: start.y + dy }, 10);
        await gesture.end();
        await page.evaluate(
          () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
            ),
        );
      };

      // The seam above the bottom zone: +-100 px, then far beyond the limits (>= 150 px for the zone, >= 160 px for the stage).
      const bottomSeam = 'Height of the docks at the bottom';
      const height = async () => (await zoneBox(page, 'bottom'))!.height;
      const base = await height();
      await dragSeparator(bottomSeam, 0, 80);
      await expectClose(height, base - 80, 2, 'dragged down by 80 px: the zone is 80 px lower');
      await dragSeparator(bottomSeam, 0, -80);
      await expectClose(height, base, 2, 'and back up');
      await dragSeparator(bottomSeam, 0, -2000);
      const stageHeight = async () =>
        (await page.locator('section.c-workspace__stage').boundingBox())!.height;
      expect(await stageHeight(), 'the stage never shrinks below 160 px').toBeGreaterThanOrEqual(
        159,
      );
      const tallest = await height();
      await dragSeparator(bottomSeam, 0, 2000);
      expect(await height(), 'the bottom zone never gets below 150 px').toBeGreaterThanOrEqual(149);
      expect(await height()).toBeLessThan(tallest);
      expect((await stored(page))!['bottomH'], 'the height is stored as a fraction').toEqual(
        expect.any(Number),
      );
      await page.getByRole('separator', { name: bottomSeam }).dblclick();
      await expectClose(height, base, 2, 'double-click resets the height');
      expect((await stored(page))!['bottomH']).toBeNull();

      // The vertical seam of a side zone (left: 320 px by default; minimum 220 px).
      const leftSeam = 'Width of the docks on the left';
      const width = async () => Math.round((await zoneBox(page, 'left'))!.width);
      expect(await width()).toBe(320);
      await dragSeparator(leftSeam, 80, 0);
      await expectClose(width, 400, 2, 'width');
      await dragSeparator(leftSeam, -1000, 0);
      await expectClose(width, 220, 1, 'minimum 220 px');
      await dragSeparator(leftSeam, 2000, 0);
      const widest = await width();
      expect(widest, 'at most 42 % of the workspace').toBeLessThanOrEqual(
        Math.round(1440 * 0.42) + 1,
      );
      expect((await stored(page))!['leftW']).toBe(widest);
      await sep(page, leftSeam).dblclick();
      await expectClose(width, 320, 1, 'left zone back to 320 px');

      // The seam between two docks of the bottom zone: weights change, the sum stays.
      const between = 'Size of Scenes and Sources';
      const widths = async () => [
        (await dock(page, 'scenes').boundingBox())!.width,
        (await dock(page, 'src').boundingBox())!.width,
      ];
      const [w0, w1] = await widths();
      await dragSeparator(between, 60, 0);
      const [v0, v1] = await widths();
      expect(Math.abs(v0 - (w0 + 60)), 'the first dock grew by 60 px').toBeLessThanOrEqual(3);
      expect(Math.abs(v0 + v1 - (w0 + w1)), 'the sum is preserved').toBeLessThanOrEqual(2);
      const weights = (await stored(page))!['weights'];
      expect(weights.scenes + weights.src, 'weights keep their sum').toBeCloseTo(
        DEFAULT_WEIGHTS.scenes + DEFAULT_WEIGHTS.src,
        3,
      );
      await dragSeparator(between, 5000, 0);
      expect((await widths())[1], 'the neighbour keeps at least 180 px').toBeGreaterThanOrEqual(
        179,
      );
      await sep(page, between).dblclick();
      await expect
        .poll(
          async () => {
            const [r0, r1] = await widths();
            return Math.abs(r0 / r1 - DEFAULT_WEIGHTS.scenes / DEFAULT_WEIGHTS.src);
          },
          { message: 'double-click resets the weights', timeout: 4000 },
        )
        .toBeLessThan(0.05);

      // Preview | Program (Studio Mode): the split follows within 0.3 ... 0.7.
      await regie.setStudioMode(true);
      const monitors = async () => [
        (await page.locator('sf-monitor.c-monitor--preview').boundingBox())!.width,
        (await page.locator('sf-monitor.c-monitor--program').boundingBox())!.width,
      ];
      const [p0] = await monitors();
      await dragSeparator('Size of Preview and Program', 40, 0);
      const [p1] = await monitors();
      expect(p1, 'the Preview grew').toBeGreaterThan(p0 + 15);
      await dragSeparator('Size of Preview and Program', 3000, 0);
      expect((await stored(page))!['split'], 'the split is capped at 0.7').toBeLessThanOrEqual(0.7);
      await dragSeparator('Size of Preview and Program', -3000, 0);
      expect((await stored(page))!['split'], 'and at 0.3').toBeGreaterThanOrEqual(0.3);
      await sep(page, 'Size of Preview and Program').dblclick();
      expect((await stored(page))!['split']).toBe(0.5);
      await expect
        .poll(async () => Math.abs((await monitors())[0] - p0), {
          message: 'the Preview is back at its width',
        })
        .toBeLessThanOrEqual(3);
      expect(regie.problems.pageErrors).toEqual([]);
    },
  );

  test(
    'E2E-DOCK-03 [regie, seam] a seam turns into a blue 3 px line on hover, on focus and while dragged',
    t.p1,
    async ({ regie }) => {
      const page = regie.page;
      const seam = sep(page, 'Height of the docks at the bottom');
      const shadow = () => seam.evaluate((element) => getComputedStyle(element).boxShadow);
      expect(await shadow()).toBe('none');
      await seam.hover();
      await expect.poll(shadow, { message: 'hover: blue ring' }).toContain(BLUE);
      await page.mouse.move(5, 5);
      await expect.poll(shadow).toBe('none');
      await seam.focus();
      await expect.poll(shadow, { message: 'focus: blue ring' }).toContain(BLUE);
      expect(await seam.evaluate((element) => getComputedStyle(element).cursor)).toBe('row-resize');
      expect(
        await sep(page, 'Size of Scenes and Sources').evaluate(
          (element) => getComputedStyle(element).cursor,
        ),
      ).toBe('col-resize');
      const start = await center(seam);
      const gesture = await new Gesture(page).begin(start);
      await gesture.to({ x: start.x, y: start.y - 30 }, 5);
      await expect(seam).toHaveClass(/is-drag/);
      await expect.poll(shadow, { message: 'dragging: blue ring' }).toContain(BLUE);
      await gesture.end();
    },
  );

  test(
    'E2E-DOCK-04 [regie] “Docks and layout”: hide and show each dock, hide all, restore; hidden docks leave the DOM, the others reflow, the state persists',
    t.p1,
    async ({ regie }) => {
      const page = regie.page;
      const open = async () => {
        await page.getByRole('button', { name: 'Docks and layout' }).click();
        return page.getByRole('dialog', { name: 'Docks and layout' });
      };
      const popover = await open();
      for (const id of ['scenes', 'src', 'insp', 'st', 'audio'] as const)
        await expect(popover.getByRole('checkbox', { name: TITLES[id] })).toBeChecked();
      const before = await dock(page, 'scenes').boundingBox();

      await popover.getByRole('checkbox', { name: 'Sources' }).uncheck();
      await expect(
        dock(page, 'src'),
        'the hidden dock is gone from the DOM and the tab order',
      ).toHaveCount(0);
      await expectOrder(page, 'bottom', ['scenes', 'insp', 'st', 'audio']);
      expect(
        (await dock(page, 'scenes').boundingBox())!.width,
        'the others reflow and grow',
      ).toBeGreaterThan(before!.width + 20);
      expect((await stored(page))!['hidden']).toEqual(['src']);
      await expect(popover.getByRole('checkbox', { name: 'Sources' })).not.toBeChecked();

      for (const id of ['scenes', 'insp', 'st', 'audio'] as const)
        await popover.getByRole('checkbox', { name: TITLES[id] }).uncheck();
      await expectOrder(page, 'bottom', []);
      expect((await stored(page))!['hidden'].sort()).toEqual(['audio', 'insp', 'scenes', 'src', 'st']);
      await expect(
        page.locator('sf-stage'),
        'with every dock hidden the stage stays',
      ).toBeVisible();
      await expect(page.locator('.c-workspace__zone--bottom')).toHaveClass(/is-empty/);
      expect(
        (await page.locator('section.c-workspace__stage').boundingBox())!.height,
      ).toBeGreaterThan(300);

      for (const id of ['scenes', 'src', 'insp', 'st', 'audio'] as const)
        await popover.getByRole('checkbox', { name: TITLES[id] }).check();
      await expectOrder(
        page,
        'bottom',
        ['scenes', 'src', 'insp', 'st', 'audio'],
        'showing them again restores the previous order',
      );
      expect((await stored(page))!['hidden']).toEqual([]);
      await page.keyboard.press('Escape');
      await expect(popover).toBeHidden();
      // A reload keeps what was hidden.
      await (await open()).getByRole('checkbox', { name: 'Stations' }).uncheck();
      await page.reload();
      await regie.waitReady();
      await expectOrder(page, 'bottom', ['scenes', 'src', 'insp', 'audio']);
      expect(regie.problems.pageErrors).toEqual([]);
    },
  );

  test(
    'E2E-DOCK-05 [regie] reset: “Reset layout” in the popover and the toast action restore zones, sizes, weights and hidden docks',
    t.p1,
    async ({ regie }) => {
      const page = regie.page;
      await seedLayout(regie, {
        ...DEFAULT_LAYOUT,
        zones: { left: ['scenes'], bottom: ['insp', 'st'], right: ['src'] },
        hidden: ['st'],
        bottomH: 0.5,
        leftW: 400,
        rightW: 280,
        split: 0.6,
        weights: { ...DEFAULT_WEIGHTS, insp: 3 },
      });
      await expectZone(page, 'scenes', 'left');
      await page.getByRole('button', { name: 'Docks and layout' }).click();
      await page.getByRole('button', { name: 'Reset layout' }).click();
      await expect(toastOf(page)).toContainText('Layout reset');
      await expectOrder(page, 'bottom', ['scenes', 'src', 'insp', 'st', 'audio']);
      expect(await stored(page)).toEqual(DEFAULT_LAYOUT);
      await page.keyboard.press('Escape');

      // Rearrange by keyboard, then use the toast action.
      const grip = page.getByRole('button', {
        name: 'Move dock Stations with the arrow keys',
      });
      await grip.focus();
      // Stations is second to last: the first arrow swaps it with Audio, the second one docks it on the right.
      await page.keyboard.press('ArrowRight');
      await expectOrder(page, 'bottom', ['scenes', 'src', 'insp', 'audio', 'st']);
      await expect(grip).toBeFocused();
      await page.keyboard.press('ArrowRight');
      await expect(toastOf(page)).toContainText('Stations is docked on the right');
      await expectZone(page, 'st', 'right');
      await toastOf(page).getByRole('button', { name: 'Reset layout' }).click();
      await expect(toastOf(page)).toContainText('Layout reset');
      await expectZone(page, 'st', 'bottom');
      expect(await stored(page)).toEqual(DEFAULT_LAYOUT);
    },
  );

  test(
    'E2E-DOCK-06 [regie] corrupted localStorage falls back to the default layout without errors; the next change overwrites it with valid JSON; invalid mode and transition fall back too',
    t.p0,
    async ({ regie, context }) => {
      test.setTimeout(180_000);
      const custom = {
        ...DEFAULT_LAYOUT,
        zones: { left: ['scenes'], bottom: ['src', 'insp'], right: ['st'] },
      };
      const huge = JSON.stringify({
        v: 1,
        zones: DEFAULT_LAYOUT.zones,
        junk: 'x'.repeat(3_000_000),
      });
      const cases: Array<[string, string | null]> = [
        ['empty string', ''],
        ['broken JSON', '{'],
        ['null', 'null'],
        ['a string', '"x"'],
        ['an array', '[]'],
        ['version 2', JSON.stringify({ ...DEFAULT_LAYOUT, v: 2 })],
        ['only the version', '{"v":1}'],
        [
          'a duplicate dock',
          JSON.stringify({
            ...custom,
            zones: { left: ['scenes'], bottom: ['scenes', 'src', 'insp'], right: ['st'] },
          }),
        ],
        [
          'an unknown dock',
          JSON.stringify({
            ...custom,
            zones: { left: ['scenes'], bottom: ['src', 'insp', 'ufo'], right: ['st'] },
          }),
        ],
        [
          'a missing dock',
          JSON.stringify({
            ...custom,
            zones: { left: ['scenes'], bottom: ['src'], right: ['st'] },
          }),
        ],
        [
          'zones that are not arrays',
          JSON.stringify({ ...custom, zones: { left: 'scenes', bottom: 'src', right: 'st' } }),
        ],
        ['unknown hidden ids', JSON.stringify({ ...custom, hidden: ['ufo'] })],
        [
          'weights that are strings',
          JSON.stringify({ ...custom, weights: { scenes: 'a', src: 1, insp: 1, st: 1, pair: 1 } }),
        ],
        [
          'a negative weight',
          JSON.stringify({ ...custom, weights: { ...DEFAULT_WEIGHTS, src: -2 } }),
        ],
        ['leftW as text', JSON.stringify({ ...custom, leftW: 'abc' })],
        ['bottomH 7', JSON.stringify({ ...custom, bottomH: 7 })],
        ['split 5', JSON.stringify({ ...custom, split: 5 })],
        ['a very large value', huge],
      ];
      for (const [label, value] of cases) {
        const page = await context.newPage();
        await page.addInitScript((raw) => {
          try {
            if (raw !== null) localStorage.setItem('studioflow.layout', raw);
          } catch {
            // too large for the quota: the app then sees no value
          }
        }, value);
        const view = new RegiePage(page);
        await view.loginViaApi(regie.requireAdmin().cookie);
        await page.goto('/');
        await view.waitReady();
        await expectOrder(
          page,
          'bottom',
          ['scenes', 'src', 'insp', 'st', 'audio'],
          `${label}: default order`,
        );
        await expectOrder(page, 'left', [], `${label}: left zone empty`);
        await expectOrder(page, 'right', [], `${label}: right zone empty`);
        expect(view.problems.pageErrors, `${label}: no uncaught error`).toEqual([]);
        expect(view.problems.consoleErrors, `${label}: no console error`).toEqual([]);
        await page.close();
      }

      // The next change replaces a broken value by valid JSON.
      const page = await context.newPage();
      await page.addInitScript(() => localStorage.setItem('studioflow.layout', '{broken'));
      const view = new RegiePage(page);
      await view.loginViaApi(regie.requireAdmin().cookie);
      await page.goto('/');
      await view.waitReady();
      await page.evaluate(() => localStorage.setItem('studioflow.layout', '{broken')); // survived the load unchanged
      await page.getByRole('button', { name: 'Docks and layout' }).click();
      await page.getByRole('checkbox', { name: 'Stations' }).uncheck();
      const fixed = await stored(page);
      expect(fixed).toMatchObject({ v: 1, hidden: ['st'] });
      await page.close();

      // Studio Mode and transition: invalid values mean off and Fade 0.3 s.
      for (const studio of ['yes', '2', '']) {
        const next = await context.newPage();
        await next.addInitScript(
          (value) => localStorage.setItem('studioflow.studio', value),
          studio,
        );
        const nextView = new RegiePage(next);
        await nextView.loginViaApi(regie.requireAdmin().cookie);
        await next.goto('/');
        await nextView.waitReady();
        await expect(nextView.studioModeSwitch(), `studio "${studio}" means off`).not.toBeChecked();
        await next.close();
      }
      for (const transition of ['"abc"', '{', '{"kind":"zoom","durationMs":"x"}', '[1,2]']) {
        const next = await context.newPage();
        await next.addInitScript(
          (value) => localStorage.setItem('studioflow.transition', value),
          transition,
        );
        const nextView = new RegiePage(next);
        await nextView.loginViaApi(regie.requireAdmin().cookie);
        await next.goto('/');
        await nextView.waitReady();
        await expect(
          nextView.transitionOption('Fade'),
          `transition ${transition} means Fade`,
        ).toHaveAttribute('aria-pressed', 'true');
        await expect(next.locator('.c-duration__value')).toHaveText('0.3 s');
        await next.close();
      }

      // A storage that throws (Safari private mode): the Regie works with the default layout in memory.
      const blocked = await context.newPage();
      await blocked.addInitScript(() => {
        const fail = () => {
          throw new DOMException('blocked', 'SecurityError');
        };
        Storage.prototype.getItem = fail;
        Storage.prototype.setItem = fail;
      });
      const blockedView = new RegiePage(blocked);
      await blockedView.loginViaApi(regie.requireAdmin().cookie);
      await blocked.goto('/');
      await blockedView.waitReady();
      await expectOrder(blocked, 'bottom', ['scenes', 'src', 'insp', 'st', 'audio']);
      await blocked.getByRole('button', { name: 'Docks and layout' }).click();
      await blocked.getByRole('checkbox', { name: 'Stations' }).uncheck();
      await expectOrder(
        blocked,
        'bottom',
        ['scenes', 'src', 'insp', 'audio'],
        'the layout works in memory',
      );
      expect(blockedView.problems.pageErrors).toEqual([]);
    },
  );

  test(
    'E2E-DOCK-07 [regie] the pairing dock takes the place of Sources and Properties (and of the Audio dock in the same zone); closing (X button, Escape) restores them and the focus; knock cards move with it',
    t.p1,
    async ({ regie, production }) => {
      const page = regie.page;
      const knock = await new PublicApi(regie.config.apiDirect, uniqueIp()).createPairingRequest({
        name: 'Laptop Dock',
        kind: 'laptop',
        platform: 'Windows · Chrome',
      });
      expect(knock.status).toBe(201);
      production.pendingRequests.push({
        requestId: knock.body.requestId,
        pollToken: knock.body.pollToken,
      });
      const card = (scope: Locator) =>
        scope.getByRole('group', { name: 'Pairing request' }).filter({ hasText: 'Laptop Dock' });
      await expect(
        card(stationsDock(page)),
        'the knock card shows in Stations while the pairing dock is closed',
      ).toBeVisible({ timeout: 5000 });

      const trigger = regie.pairButton();
      await trigger.click();
      await expect(regie.pairingDock()).toBeVisible();
      await expectOrder(
        page,
        'bottom',
        ['scenes', 'pair', 'st'],
        'Pair device sits where Sources was, and Audio gives way so that it keeps its width',
      );
      await expect(dock(page, 'src')).toHaveCount(0);
      await expect(dock(page, 'insp')).toHaveCount(0);
      await expect(dock(page, 'audio')).toHaveCount(0);
      await expect(
        card(regie.pairingDock()),
        'the knock card is in the pairing dock side column',
      ).toBeVisible();
      await expect(card(stationsDock(page)), 'and no longer in Stations').toHaveCount(0);

      // X button: the docks return, the focus goes back to “Pair device”.
      await regie.closePairing();
      await expectOrder(page, 'bottom', ['scenes', 'src', 'insp', 'st', 'audio']);
      await expect(trigger).toBeFocused();
      await expect(card(stationsDock(page))).toBeVisible();
      // Escape does the same.
      await trigger.click();
      await expect(regie.pairingDock()).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(regie.pairingDock()).toBeHidden();
      await expectOrder(page, 'bottom', ['scenes', 'src', 'insp', 'st', 'audio']);
      await expect(trigger).toBeFocused();

      // A custom layout: Sources and Properties on the right, Properties first: the dock takes the first of them.
      await seedLayout(regie, {
        ...DEFAULT_LAYOUT,
        zones: { left: [], bottom: ['scenes', 'st', 'audio'], right: ['insp', 'src'] },
      });
      await regie.pairButton().click();
      await expect(regie.pairingDock()).toBeVisible();
      await expectOrder(page, 'right', ['pair']);
      await expectOrder(page, 'bottom', ['scenes', 'st', 'audio'], 'Audio stays: it is not in the zone of the pairing dock');
      await regie.closePairing();
      await expectOrder(page, 'right', ['insp', 'src']);
      expect(await stored(page)).toMatchObject({
        zones: { bottom: ['scenes', 'st', 'audio'], right: ['insp', 'src'] },
      });
      expect(regie.problems.pageErrors).toEqual([]);
    },
  );

  test(
    'E2E-DOCK-08 [regie] Studio Mode with a custom layout: docks and control column keep their boxes, the mode survives a reload and is per browser',
    t.p1,
    async ({ regie, openRegie }) => {
      const page = regie.page;
      await seedLayout(regie, {
        ...DEFAULT_LAYOUT,
        zones: { left: ['scenes'], bottom: ['src', 'insp'], right: ['st'] },
      });
      const boxes = async (target: Page) => ({
        column: await target.locator('sf-control-column').boundingBox(),
        docks: await Promise.all(
          (['scenes', 'src', 'insp', 'st', 'audio'] as const).map((id) =>
            dock(target, id).boundingBox(),
          ),
        ),
        zones: await Promise.all(['left', 'bottom', 'right'].map((zone) => zoneBox(target, zone))),
      });
      const before = await boxes(page);
      await regie.setStudioMode(true);
      await expect(regie.take()).toBeVisible();
      const after = await boxes(page);
      expect(after.docks, 'docks do not move (±0 px)').toEqual(before.docks);
      expect(after.zones).toEqual(before.zones);
      expect({ x: after.column!.x, y: after.column!.y, width: after.column!.width }).toEqual({
        x: before.column!.x,
        y: before.column!.y,
        width: before.column!.width,
      });
      await page.reload();
      await regie.waitReady();
      await expect(regie.studioModeSwitch(), 'persists across a reload').toBeChecked();
      const reloaded = await boxes(page);
      expect(reloaded.docks).toEqual(before.docks);

      // A second context knows nothing of it.
      const other = await openRegie();
      await expect(other.studioModeSwitch()).not.toBeChecked();
      await expectOrder(other.page, 'bottom', ['scenes', 'src', 'insp', 'st', 'audio']);
      expect(await other.page.evaluate(() => localStorage.getItem('studioflow.studio'))).not.toBe(
        '1',
      );
      expect(regie.problems.pageErrors).toEqual([]);
    },
  );

  test(
    'E2E-DOCK-09 [regie] the layout is per browser and survives logout and login; clearing the site data resets it',
    t.p2,
    async ({ openRegie }) => {
      const first = await openRegie({ login: 'ui' });
      const second = await openRegie({ login: 'ui' });
      await seedLayout(first, {
        ...DEFAULT_LAYOUT,
        zones: { left: ['scenes'], bottom: ['src', 'insp', 'st'], right: [] },
      });
      await seedLayout(second, {
        ...DEFAULT_LAYOUT,
        zones: { left: [], bottom: ['scenes', 'src', 'insp'], right: ['st'] },
      });
      await expectZone(first.page, 'scenes', 'left');
      await expectZone(second.page, 'st', 'right');
      await expectZone(second.page, 'scenes', 'bottom', 'the other browser has its own layout');

      // Logout (production menu) and login again through the form: the layout is still there.
      await first.page.getByRole('button', { name: /^Production .*, menu$/ }).click();
      await first.page.getByRole('button', { name: 'Sign out' }).click();
      await expect(first.page).toHaveURL(/\/login/);
      await first.loginViaUi();
      await first.waitReady();
      await expectZone(first.page, 'scenes', 'left', 'the layout survives logout and login');
      await expectZone(second.page, 'st', 'right');

      // Clearing the site data resets it.
      await first.page.evaluate(() => localStorage.clear());
      await first.page.reload();
      await first.waitReady();
      await expectOrder(first.page, 'bottom', ['scenes', 'src', 'insp', 'st', 'audio']);
    },
  );

  test(
    'E2E-DOCK-10 [regie] side zones and an empty bottom zone at 1280x720: nothing overflows, the Program monitor stays at least 160 px high, the seam of the empty zone is gone',
    t.p2,
    async ({ regie }) => {
      const page = regie.page;
      await page.setViewportSize({ width: 1280, height: 720 });
      const checkFits = async (label: string) => {
        expect(
          await page.evaluate(() => [
            document.documentElement.scrollWidth <= document.documentElement.clientWidth,
            document.documentElement.scrollHeight <= document.documentElement.clientHeight,
          ]),
          `${label}: no page scroll`,
        ).toEqual([true, true]);
        const monitor = (await page
          .locator('sf-monitor.c-monitor--program .c-monitor__screen')
          .boundingBox())!;
        expect(monitor.height, `${label}: Program monitor height`).toBeGreaterThanOrEqual(160);
        const stage = (await page.locator('section.c-workspace__stage').boundingBox())!;
        expect(
          monitor.y + monitor.height,
          `${label}: the monitor stays inside the stage`,
        ).toBeLessThanOrEqual(stage.y + stage.height + 1);
        expect(regie.problems.pageErrors).toEqual([]);
      };
      // Everything on the right.
      await seedLayout(regie, {
        ...DEFAULT_LAYOUT,
        zones: { left: [], bottom: [], right: ['scenes', 'src', 'insp', 'st', 'audio'] },
      });
      await expect(page.locator('.c-workspace__zone--bottom')).toHaveClass(/is-empty/);
      await expect(
        page.getByRole('separator', { name: 'Height of the docks at the bottom' }),
        'no seam for an empty bottom zone',
      ).toHaveCount(0);
      await expectOrder(page, 'right', ['scenes', 'src', 'insp', 'st', 'audio']);
      await checkFits('all on the right');
      // Left and right.
      await seedLayout(regie, {
        ...DEFAULT_LAYOUT,
        zones: { left: ['scenes', 'src'], bottom: [], right: ['insp', 'st', 'audio'] },
      });
      await expect(page.getByRole('separator', { name: 'Width of the docks on the left' })).toBeVisible();
      await expect(page.getByRole('separator', { name: 'Width of the docks on the right' })).toBeVisible();
      await checkFits('left and right');
      // The docks of the bottom zone hidden through the popover.
      await seedLayout(regie, DEFAULT_LAYOUT);
      await page.getByRole('button', { name: 'Docks and layout' }).click();
      for (const id of ['scenes', 'src', 'insp', 'st', 'audio'] as const)
        await page.getByRole('checkbox', { name: TITLES[id] }).uncheck();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('separator', { name: 'Height of the docks at the bottom' })).toHaveCount(0);
      await checkFits('bottom docks hidden');
    },
  );

  test(
    'E2E-DOCK-11 [regie] scroll-edge fades: the dark fade at the bottom of a dock body shows only while more content can be scrolled in',
    t.p2,
    async ({ regie, api, production }) => {
      await production.seed([...SCENES]);
      for (let index = 4; index <= 20; index++)
        await api.createScene(production.id, { name: `Scene ${index}`, cloneFromSceneId: null });
      const page = regie.page;
      await page.reload();
      await regie.waitReady();
      const body = scenesDock(page).locator('.c-dock-frame__body');
      const attachments = await body.evaluate(
        (element) => getComputedStyle(element).backgroundAttachment,
      );
      expect(attachments, 'two local masks and two fixed fades').toBe(
        'local, local, scroll, scroll',
      );
      const metrics = () =>
        body.evaluate((element) => ({
          scrollable: element.scrollHeight > element.clientHeight + 1,
          top: element.scrollTop,
          max: element.scrollHeight - element.clientHeight,
        }));
      expect((await metrics()).scrollable, 'many scenes: the dock scrolls').toBe(true);
      // Mean luminance of the bottom 8 px of the body (without the content): dark while more is below, panel-coloured at the end.
      const bottomLuma = async () => {
        const box = (await body.boundingBox())!;
        const image = PixelImage.fromPng(
          await page.screenshot({
            clip: { x: box.x + box.width - 14, y: box.y + box.height - 8, width: 10, height: 8 },
            animations: 'disabled',
          }),
        );
        return image.meanLuma();
      };
      await body.evaluate((element) => (element.scrollTop = 0));
      const withMore = await bottomLuma();
      await body.evaluate((element) => (element.scrollTop = element.scrollHeight));
      const atEnd = await bottomLuma();
      expect(
        withMore,
        `a fade at the bottom while more content is below (${withMore.toFixed(1)} vs ${atEnd.toFixed(1)})`,
      ).toBeLessThan(atEnd - 2);
      // A dock that does not scroll shows no fade at all.
      const stations = stationsDock(page).locator('.c-dock-frame__body');
      expect(
        await stations.evaluate((element) => element.scrollHeight <= element.clientHeight + 1),
      ).toBe(true);
      const box = (await stations.boundingBox())!;
      const image = PixelImage.fromPng(
        await page.screenshot({
          clip: { x: box.x + box.width - 14, y: box.y + box.height - 8, width: 10, height: 8 },
          animations: 'disabled',
        }),
      );
      const lumaNone = image.meanLuma();
      expect(Math.abs(lumaNone - atEnd), 'no fade without scrolling').toBeLessThan(3);
    },
  );
});

test.describe('REGIE docks by keyboard', () => {
  test(
    'E2E-DEV-14 [regie] a dock moves with the arrow keys on its grip (left > bottom > right and back, no wrap) with toast and “Reset layout”; focus stays; splitters move 16 px (Shift 64 px) and reset on Enter',
    t.p1,
    async ({ regie }) => {
      const page = regie.page;
      const grip = (id: DockId) =>
        page.getByRole('button', { name: `Move dock ${TITLES[id]} with the arrow keys` });
      const toast = toastOf(page);
      await grip('scenes').focus();

      // Scenes is first at the bottom: ArrowRight walks through the bottom zone, then into the right zone.
      await page.keyboard.press('ArrowRight');
      await expect(toast).toContainText('Scenes is docked at the bottom');
      await expect(toast.getByRole('button', { name: 'Reset layout' })).toBeVisible();
      await expectOrder(page, 'bottom', ['src', 'scenes', 'insp', 'st', 'audio']);
      await expect(grip('scenes'), 'the focus stays on the grip').toBeFocused();
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowRight');
      await expectOrder(page, 'bottom', ['src', 'insp', 'st', 'audio', 'scenes']);
      await page.keyboard.press('ArrowRight');
      await expect(toast).toContainText('Scenes is docked on the right');
      await expectZone(page, 'scenes', 'right');
      await expect(grip('scenes')).toBeFocused();
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowDown');
      await expectZone(page, 'scenes', 'right', 'no move beyond the right end');
      expect((await stored(page))!['zones']).toEqual({
        left: [],
        bottom: ['src', 'insp', 'st', 'audio'],
        right: ['scenes'],
      });
      // And back: ArrowLeft returns to the bottom zone, on past its start into the left zone.
      await page.keyboard.press('ArrowLeft');
      await expect(toast).toContainText('Scenes is docked at the bottom');
      await expectOrder(page, 'bottom', ['src', 'insp', 'st', 'audio', 'scenes']);
      for (let step = 0; step < 5; step++) await page.keyboard.press('ArrowLeft');
      await expect(toast).toContainText('Scenes is docked on the left');
      await expectZone(page, 'scenes', 'left');
      await page.keyboard.press('ArrowLeft');
      await page.keyboard.press('ArrowUp');
      await expectZone(page, 'scenes', 'left', 'no move beyond the left end');
      await toast.getByRole('button', { name: 'Reset layout' }).click();
      expect(await stored(page)).toEqual(DEFAULT_LAYOUT);

      // Splitters: 16 px per arrow, 64 px with Shift, Enter resets; orientation and names as pinned.
      const bottomSeam = sep(page, 'Height of the docks at the bottom');
      await expect(bottomSeam).toHaveAttribute('aria-orientation', 'horizontal');
      const height = async () => (await zoneBox(page, 'bottom'))!.height;
      const h0 = await height();
      await bottomSeam.focus();
      await page.keyboard.press('ArrowUp');
      await expectClose(height, h0 + 16, 1, 'height');
      await page.keyboard.press('Shift+ArrowUp');
      await expectClose(height, h0 + 16 + 64, 1, 'height');
      await page.keyboard.press('ArrowDown');
      await expectClose(height, h0 + 64, 1, 'height');
      expect((await stored(page))!['bottomH'], 'persisted').toEqual(expect.any(Number));
      await page.keyboard.press('Enter');
      await expectClose(height, h0, 1, 'height');
      await bottomSeam.press('ArrowLeft'); // not an arrow of this axis
      await expectClose(height, h0, 1, 'height');

      // The seam between two docks (Sources | Properties, in the middle of the zone): 16 px per arrow, 64 px with Shift.
      const between = sep(page, 'Size of Sources and Properties');
      await expect(between).toHaveAttribute('aria-orientation', 'vertical');
      const seamX = async () => {
        const box = (await between.boundingBox())!;
        return box.x + box.width / 2;
      };
      const x0 = await seamX();
      await between.focus();
      await page.keyboard.press('ArrowRight');
      await expectClose(seamX, x0 + 16, 1, 'the seam moved 16 px');
      await page.keyboard.press('Shift+ArrowLeft');
      await expectClose(seamX, x0 + 16 - 64, 1, 'and 64 px with Shift');
      await page.keyboard.press('Enter');
      await expectClose(seamX, x0, 1, 'Enter resets the seam');

      // Preview / Program (Studio Mode on) and a side zone.
      await regie.setStudioMode(true);
      const monitorSeam = sep(page, 'Size of Preview and Program');
      await expect(monitorSeam).toHaveAttribute('aria-orientation', 'vertical');
      const previewWidth = async () =>
        (await page.locator('sf-monitor.c-monitor--preview').boundingBox())!.width;
      const p0 = await previewWidth();
      await monitorSeam.focus();
      await page.keyboard.press('ArrowRight');
      await expect.poll(previewWidth, { message: 'the Preview grew' }).toBeGreaterThan(p0 + 4);
      await page.keyboard.press('Enter');
      await expectClose(previewWidth, p0, 2, 'previewWidth');
      expect((await stored(page))!['split']).toBe(0.5);

      await grip('st').focus();
      await page.keyboard.press('ArrowRight');
      await expectOrder(page, 'bottom', ['scenes', 'src', 'insp', 'audio', 'st']);
      await expect(grip('st')).toBeFocused();
      await page.keyboard.press('ArrowRight');
      await expect(toast).toContainText('Stations is docked on the right');
      const rightSeam = sep(page, 'Width of the docks on the right');
      await expect(rightSeam).toHaveAttribute('aria-orientation', 'vertical');
      const rightWidth = async () => Math.round((await zoneBox(page, 'right'))!.width);
      expect(await rightWidth()).toBe(340);
      await rightSeam.focus();
      await page.keyboard.press('ArrowLeft'); // moving the seam left makes the right zone wider
      await expectClose(rightWidth, 356, 1, 'right zone 356 px');
      await page.keyboard.press('Shift+ArrowLeft');
      await expectClose(rightWidth, 420, 1, 'right zone 420 px');
      await page.keyboard.press('Enter');
      await expectClose(rightWidth, 340, 1, 'right zone back to 340 px');
      expect((await stored(page))!['rightW']).toBe(340);
      expect(regie.problems.pageErrors).toEqual([]);
    },
  );
});

test.describe('REGIE docks: edge seams', () => {
  test(
    'E2E-DEV-14 [regie, edge seams] the keyboard step of a seam next to a dock at the window edge is 16 px as well',
    t.p1,
    async ({ regie }) => {
      regieBug(
        'REGIE-02',
        'the seam between two docks moves 20.3 px or 11.6 px instead of 16 px per arrow key when one of the docks has the window gutter padding',
      );
      const page = regie.page;
      for (const name of [
        'Size of Scenes and Sources',
        'Size of Stations and Audio',
      ]) {
        const seam = sep(page, name);
        const seamX = async () => {
          const box = (await seam.boundingBox())!;
          return box.x + box.width / 2;
        };
        const x0 = await seamX();
        await seam.focus();
        await page.keyboard.press('ArrowRight');
        await expectClose(seamX, x0 + 16, 1.5, `${name}: one arrow moves the seam by 16 px`);
        await page.keyboard.press('Enter');
      }
    },
  );
});
