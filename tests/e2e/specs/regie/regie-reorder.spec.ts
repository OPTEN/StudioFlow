import type { Locator, Page } from '@playwright/test';
import { t } from '../../support/tags';
import { expect, test } from '../../support/ui/fixtures';
import {
  COLOR,
  getScene,
  hex,
  item,
  monitorPixels,
  recordRequests,
  renderedItems,
  replaceItems,
  uploadSolid,
  type Rgb,
} from '../../support/regie/kit';
import type { Production } from '../../support/production';
import type { AdminApi } from '../../support/api';

/**
 * Reordering by drag and drop and from the keyboard (issue #19): the Sources dock (the item order is the z-order) and
 * the Scenes dock. The elements are three flat-colour images that overlap, so the pixels of the Program monitor and of
 * the output page tell the order apart. The selectors are the structure of the sortable list (`data-sortable-id`
 * rows, `.c-sortable__handle`), not texts, so the specs hold in every language; the live region is read in English.
 */

test.use({ viewport: { width: 1440, height: 900 } });

const SCENE_NAMES = ['Scene A', 'Scene B', 'Scene C'];
/** Inside all three elements (red 100/100, green 300/200, blue 500/300, each 600 x 338). */
const OVERLAP = { x: 540, y: 340, width: 60, height: 60 };

const sourceRows = (page: Page): Locator => page.locator('sf-sources-dock .c-sortable__row');
const sceneRows = (page: Page): Locator => page.locator('sf-scenes-dock .c-sortable__row');
const rowOf = (rows: Locator, id: string): Locator => rows.and(rows.page().locator(`[data-sortable-id="${id}"]`));
const handleOf = (rows: Locator, id: string): Locator =>
  rowOf(rows, id).locator('.c-sortable__handle');
/** The row ids in list order (top to bottom). */
const idsOf = (rows: Locator): Promise<Array<string | null>> =>
  rows.evaluateAll((elements) => elements.map((element) => element.getAttribute('data-sortable-id')));

/** Back to front: red, green, blue. */
async function seedOverlappingLayers(
  api: AdminApi,
  production: Production,
): Promise<{ sceneId: string; ids: string[] }> {
  await production.seed(SCENE_NAMES);
  const sceneId = production.sceneIds[0]!;
  const [red, green, blue] = await Promise.all(
    (
      [
        ['Red', COLOR.red],
        ['Green', COLOR.green],
        ['Blue', COLOR.blue],
      ] as Array<[string, Rgb]>
    ).map(([name, color]) => uploadSolid(api, production, name, color)),
  );
  await replaceItems(api, production, sceneId, [
    item('itm_layera', red!.id, { x: 100, y: 100, w: 600, h: 338 }),
    item('itm_layerb', green!.id, { x: 300, y: 200, w: 600, h: 338 }),
    item('itm_layerc', blue!.id, { x: 500, y: 300, w: 600, h: 338 }),
  ]);
  return { sceneId, ids: ['itm_layera', 'itm_layerb', 'itm_layerc'] };
}

const apiOrder = async (api: AdminApi, production: Production, sceneId: string) =>
  (await getScene(api, production, sceneId)).items.map((entry) => entry.id);

/** Presses on a row, moves in steps to `toY` and releases there (a real mouse drag). */
async function dragRowTo(page: Page, row: Locator, toY: number, release = true): Promise<void> {
  const box = (await row.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y - 12, { steps: 3 });
  await page.mouse.move(x, toY, { steps: 14 });
  if (release) await page.mouse.up();
}

test.describe('REGIE reorder', () => {
  test(
    'E2E-SCENE-30 [regie, output] drag the back element to the top of the Sources dock: one order request on drop, the Program monitor and the output show it in front, the other operator follows, undo restores',
    t.p1,
    async ({ regie, openRegie, openOutput, api, production }) => {
      const { sceneId } = await seedOverlappingLayers(api, production);
      const page = regie.page;
      await regie.waitForConvergence(production.id);
      const operatorB = await openRegie();
      expect((await api.startBroadcast(production.id)).status).toBe(200);
      const output = await openOutput(production);
      await output.stage();
      const monitorShare = async (color: Rgb) =>
        (await monitorPixels(page)).share(hex(color), OVERLAP);
      const outputShare = async (color: Rgb) => {
        const stage = await output.stagePixels();
        return stage.image.shareOfColor(
          hex(color),
          {
            x: OVERLAP.x * stage.scale,
            y: OVERLAP.y * stage.scale,
            width: OVERLAP.width * stage.scale,
            height: OVERLAP.height * stage.scale,
          },
          28,
        );
      };

      // The list shows the front element first.
      await expect.poll(() => idsOf(sourceRows(page))).toEqual(['itm_layerc', 'itm_layerb', 'itm_layera']);
      await expect.poll(() => monitorShare(COLOR.blue), { message: 'blue is in front' }).toBeGreaterThan(0.9);
      await expect.poll(() => outputShare(COLOR.blue), { message: 'blue is in front on the output' }).toBeGreaterThan(0.9);
      const before = await getScene(api, production, sceneId);

      const orderRequests = recordRequests(
        page,
        (path, method) => method === 'PUT' && /\/scenes\/[^/]+\/items\/order$/.test(path),
      );
      const replaceRequests = recordRequests(
        page,
        (path, method) => method === 'PUT' && /\/scenes\/[^/]+\/items$/.test(path),
      );

      // Drag the red (bottom) row above the blue (top) row, and hold: nothing is sent while dragging.
      const topBox = (await sourceRows(page).first().boundingBox())!;
      await dragRowTo(page, rowOf(sourceRows(page), 'itm_layera'), topBox.y + 4, false);
      await expect(page.locator('sf-sources-dock .c-sortable__line'), 'the insertion line shows the target').toBeVisible();
      expect(orderRequests, 'no request while dragging').toHaveLength(0);
      await page.mouse.up();

      await expect.poll(() => idsOf(sourceRows(page))).toEqual(['itm_layera', 'itm_layerc', 'itm_layerb']);
      await expect.poll(() => apiOrder(api, production, sceneId)).toEqual(['itm_layerb', 'itm_layerc', 'itm_layera']);
      expect(orderRequests, 'one request on drop').toHaveLength(1);
      expect(orderRequests[0]!.body).toEqual({ itemIds: ['itm_layerb', 'itm_layerc', 'itm_layera'] });
      expect(replaceRequests, 'the order does not use ReplaceSceneItems').toHaveLength(0);
      await expect(page.locator('sf-sources-dock .c-src.is-sel'), 'dragging does not select').toHaveCount(0);

      // Nothing but the order changed, and every picture follows: monitor, output, the other operator.
      const after = await getScene(api, production, sceneId);
      expect(
        [...after.items].sort((a, b) => a.id.localeCompare(b.id)),
        'no element changed',
      ).toEqual([...before.items].sort((a, b) => a.id.localeCompare(b.id)));
      await expect.poll(() => monitorShare(COLOR.red), { message: 'red is in front now' }).toBeGreaterThan(0.9);
      await expect
        .poll(async () => (await renderedItems(page, 'program')).map((entry) => `${entry.id.slice(-1)}${entry.z}`))
        .toEqual(['b0', 'c1', 'a2']);
      await expect.poll(() => outputShare(COLOR.red), { message: 'red is in front on the output' }).toBeGreaterThan(0.9);
      await expect
        .poll(() => idsOf(sourceRows(operatorB.page)), { message: 'the other operator follows', timeout: 4000 })
        .toEqual(['itm_layera', 'itm_layerc', 'itm_layerb']);

      // Ctrl+Z puts the old order back.
      await page.locator('body').click({ position: { x: 5, y: 5 } });
      await page.keyboard.press('Control+z');
      await expect.poll(() => apiOrder(api, production, sceneId)).toEqual(['itm_layera', 'itm_layerb', 'itm_layerc']);
      await expect.poll(() => outputShare(COLOR.blue), { message: 'blue is in front again' }).toBeGreaterThan(0.9);
      await expect.poll(() => idsOf(sourceRows(page))).toEqual(['itm_layerc', 'itm_layerb', 'itm_layera']);
      expect(regie.problems.pageErrors).toEqual([]);
    },
  );

  test(
    'E2E-SCENE-31 [regie] a click still selects, Escape cancels a drag, a drop away from the list restores the order and none of them sends a request',
    t.p1,
    async ({ regie, api, production }) => {
      const { sceneId } = await seedOverlappingLayers(api, production);
      const page = regie.page;
      await regie.waitForConvergence(production.id);
      const requests = recordRequests(page, (path, method) => method !== 'GET' && /\/scenes\//.test(path));
      const rows = sourceRows(page);
      await expect.poll(() => idsOf(rows)).toEqual(['itm_layerc', 'itm_layerb', 'itm_layera']);

      // A short click selects the element.
      await rowOf(rows, 'itm_layerb').locator('.c-src__select').click();
      await expect(page.locator('sf-sources-dock .c-src.is-sel')).toHaveCount(1);

      // Escape in the middle of a drag.
      const topBox = (await rows.first().boundingBox())!;
      await dragRowTo(page, rowOf(rows, 'itm_layera'), topBox.y + 4, false);
      await expect(page.locator('sf-sources-dock .c-sortable__row.is-lifted')).toHaveCount(1);
      await page.keyboard.press('Escape');
      await expect(page.locator('sf-sources-dock .c-sortable__row.is-lifted')).toHaveCount(0);
      await page.mouse.up();
      await expect.poll(() => idsOf(rows)).toEqual(['itm_layerc', 'itm_layerb', 'itm_layera']);
      await expect(page.locator('sf-sources-dock .c-src.is-sel'), 'Escape left the selection alone').toHaveCount(1);

      // A drop well to the side of the list.
      const box = (await rowOf(rows, 'itm_layera').boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2, box.y - 30, { steps: 4 });
      await page.mouse.move(1400, 300, { steps: 10 });
      await page.mouse.up();
      await expect.poll(() => idsOf(rows)).toEqual(['itm_layerc', 'itm_layerb', 'itm_layera']);

      expect(await apiOrder(api, production, sceneId)).toEqual(['itm_layera', 'itm_layerb', 'itm_layerc']);
      expect(requests, 'no write was sent').toEqual([]);
      expect(regie.problems.pageErrors).toEqual([]);
    },
  );

  test(
    'E2E-SCENE-32 [regie, a11y] keyboard: the handle picks a row up with Space, the arrows move it, Space drops it, Escape cancels; Alt+Up/Down moves at once; every step is announced',
    t.p1,
    async ({ regie, api, production }) => {
      const { sceneId } = await seedOverlappingLayers(api, production);
      const page = regie.page;
      await regie.waitForConvergence(production.id);
      const rows = sourceRows(page);
      const live = page.locator('[aria-live="assertive"]');
      await expect.poll(() => idsOf(rows)).toEqual(['itm_layerc', 'itm_layerb', 'itm_layera']);

      // Pick the bottom row up, two steps to the top, drop.
      const handle = handleOf(rows, 'itm_layera');
      await handle.focus();
      await page.keyboard.press('Space');
      await expect(handle).toHaveAttribute('aria-pressed', 'true');
      await expect(live).toContainText(/picked up at position 3 of 3/);
      await page.keyboard.press('ArrowUp');
      await page.keyboard.press('ArrowUp');
      await expect(live).toContainText(/moved to position 1 of 3/);
      await page.keyboard.press('Space');
      await expect.poll(() => apiOrder(api, production, sceneId)).toEqual(['itm_layerb', 'itm_layerc', 'itm_layera']);
      await expect.poll(() => idsOf(rows)).toEqual(['itm_layera', 'itm_layerc', 'itm_layerb']);
      await expect(live).toContainText(/position 1 of 3/);

      // Escape cancels.
      await handle.focus();
      await page.keyboard.press('Enter');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Escape');
      await expect(live).toContainText(/Move cancelled/);
      await expect(handle).toHaveAttribute('aria-pressed', 'false');
      await expect.poll(() => idsOf(rows)).toEqual(['itm_layera', 'itm_layerc', 'itm_layerb']);
      expect(await apiOrder(api, production, sceneId)).toEqual(['itm_layerb', 'itm_layerc', 'itm_layera']);

      // Alt+Down moves the focused row one place back, Alt+Shift+Up to the very front; the focus stays.
      const select = rowOf(rows, 'itm_layera').locator('.c-src__select');
      await select.focus();
      await page.keyboard.press('Alt+ArrowDown');
      await expect.poll(() => idsOf(rows)).toEqual(['itm_layerc', 'itm_layera', 'itm_layerb']);
      await expect(select, 'the row keeps the focus after it moved').toBeFocused();
      await page.keyboard.press('Alt+Shift+ArrowUp');
      await expect.poll(() => idsOf(rows)).toEqual(['itm_layera', 'itm_layerc', 'itm_layerb']);
      await expect.poll(() => apiOrder(api, production, sceneId)).toEqual(['itm_layerb', 'itm_layerc', 'itm_layera']);
      expect(regie.problems.pageErrors).toEqual([]);
    },
  );

  test(
    'E2E-SCENE-33 [regie] Auto grid: dragging a row moves the source to another grid cell, and the dock says that the order is the position',
    t.p1,
    async ({ regie, api, production }) => {
      const { sceneId } = await seedOverlappingLayers(api, production);
      const page = regie.page;
      expect((await api.updateScene(production.id, sceneId, { layoutMode: 'autoGrid' })).status).toBe(200);
      await regie.waitForConvergence(production.id);
      const rows = sourceRows(page);
      await expect(page.locator('sf-sources-dock .c-src-dock__hint')).toBeVisible();
      const cellOf = async (id: string) =>
        (await renderedItems(page, 'program')).find((entry) => entry.id === id)!;
      await expect.poll(async () => (await cellOf('itm_layera')).x).toBeLessThan((await cellOf('itm_layerc')).x);
      const firstX = (await cellOf('itm_layera')).x;
      const lastX = (await cellOf('itm_layerc')).x;

      // Drag the first item (bottom row) to the top of the list: it becomes the last cell.
      const topBox = (await rows.first().boundingBox())!;
      await dragRowTo(page, rowOf(rows, 'itm_layera'), topBox.y + 4);
      await expect.poll(() => apiOrder(api, production, sceneId)).toEqual(['itm_layerb', 'itm_layerc', 'itm_layera']);
      await expect.poll(async () => (await cellOf('itm_layera')).x, { message: 'red moved to the last cell' }).toBe(lastX);
      expect((await cellOf('itm_layerb')).x, 'green is the first cell now').toBe(firstX);
      expect((await getScene(api, production, sceneId)).layoutMode, 'still an Auto grid').toBe('autoGrid');
      expect(regie.problems.pageErrors).toEqual([]);
    },
  );

  test(
    'E2E-SCENE-34 [regie] the Scenes dock reorders by dragging too: the API order, the keys 1-3 and the other operator follow, and the dragged scene is not switched',
    t.p1,
    async ({ regie, openRegie, api, production }) => {
      await production.seed(SCENE_NAMES);
      const [sceneA, , sceneC] = production.sceneIds as [string, string, string];
      const page = regie.page;
      await regie.waitForConvergence(production.id);
      const operatorB = await openRegie();
      const rows = sceneRows(page);
      const names = (target: Page) =>
        target.locator('sf-scenes-dock .c-scene .c-scene__name').allTextContents();
      const apiScenes = async () => (await api.getSnapshot(production.id)).body.scenes.map((scene) => scene.id);
      await expect.poll(() => names(page)).toEqual(SCENE_NAMES);

      const orderRequests = recordRequests(page, (path, method) => method === 'PUT' && /\/scenes\/order$/.test(path));
      const takeRequests = recordRequests(page, (path) => /\/(program|take|preview)$/.test(path));
      const topBox = (await rows.first().boundingBox())!;
      await dragRowTo(page, rows.nth(2), topBox.y + 4);
      await expect.poll(() => names(page)).toEqual(['Scene C', 'Scene A', 'Scene B']);
      await expect.poll(apiScenes).toEqual([sceneC, sceneA, production.sceneIds[1]!]);
      expect(orderRequests, 'one request on drop').toHaveLength(1);
      expect(takeRequests, 'dragging does not switch the scene').toEqual([]);
      expect((await api.getSnapshot(production.id)).body.production.programSceneId).toBe(sceneA);
      await expect.poll(() => names(operatorB.page), { timeout: 4000 }).toEqual(['Scene C', 'Scene A', 'Scene B']);
      await expect(page.locator('sf-scenes-dock .c-scene .c-keycap').first()).toHaveText('1');

      // Key 1 now puts the new first scene live.
      await page.locator('body').click({ position: { x: 5, y: 5 } });
      await page.keyboard.press('1');
      await expect
        .poll(async () => (await api.getSnapshot(production.id)).body.production.programSceneId)
        .toBe(sceneC);
      expect(regie.problems.pageErrors).toEqual([]);
    },
  );
});
