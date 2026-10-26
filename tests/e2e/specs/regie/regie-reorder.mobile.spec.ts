import type { CDPSession, Locator, Page } from '@playwright/test';
import { t } from '../../support/tags';
import { expect, test } from '../../support/ui/fixtures';
import { COLOR, getScene, item, recordRequests, replaceItems, uploadSolid } from '../../support/regie/kit';

/**
 * Touch reordering in the stacked small-screen layout (issue #19): a finger drags a row from its handle at once, a
 * press and hold drags it from anywhere, and a swipe that starts at once leaves the rows alone (the page scrolls).
 * Playwright has no touch drag, so the finger is a CDP touch stream.
 */

const IDS = ['itm_layera', 'itm_layerb', 'itm_layerc'];

const rows = (page: Page): Locator => page.locator('sf-sources-dock .c-sortable__row');
const idsOf = (list: Locator): Promise<Array<string | null>> =>
  list.evaluateAll((elements) => elements.map((element) => element.getAttribute('data-sortable-id')));

interface Finger {
  down(x: number, y: number): Promise<void>;
  move(x: number, y: number): Promise<void>;
  up(): Promise<void>;
}

function finger(cdp: CDPSession): Finger {
  const point = (x: number, y: number) => [{ x, y, id: 1 }];
  return {
    down: (x, y) => cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point(x, y) }).then(() => undefined),
    move: (x, y) => cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: point(x, y) }).then(() => undefined),
    up: () => cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }).then(() => undefined),
  };
}

async function centreOf(locator: Locator): Promise<{ x: number; y: number }> {
  await locator.scrollIntoViewIfNeeded();
  const box = (await locator.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test.describe('REGIE reorder on a touch screen', () => {
  test(
    'E2E-SCENE-35 [regie, touch] the handle drags at once, a press and hold drags from the row, a swipe leaves the order alone',
    t.p1,
    async ({ regie, api, production }) => {
      await production.seed(['Scene A', 'Scene B', 'Scene C']);
      const sceneId = production.sceneIds[0]!;
      const [red, green, blue] = await Promise.all([
        uploadSolid(api, production, 'Red', COLOR.red),
        uploadSolid(api, production, 'Green', COLOR.green),
        uploadSolid(api, production, 'Blue', COLOR.blue),
      ]);
      await replaceItems(api, production, sceneId, [
        item(IDS[0]!, red.id, { x: 100, y: 100, w: 600, h: 338 }),
        item(IDS[1]!, green.id, { x: 300, y: 200, w: 600, h: 338 }),
        item(IDS[2]!, blue.id, { x: 500, y: 300, w: 600, h: 338 }),
      ]);
      const page = regie.page;
      await regie.waitForConvergence(production.id);
      const list = rows(page);
      const apiOrder = async () => (await getScene(api, production, sceneId)).items.map((entry) => entry.id);
      const touch = finger(await page.context().newCDPSession(page));
      await expect.poll(() => idsOf(list)).toEqual(['itm_layerc', 'itm_layerb', 'itm_layera']);
      const orderRequests = recordRequests(page, (path, method) => method === 'PUT' && /\/items\/order$/.test(path));
      const lifted = page.locator('sf-sources-dock .c-sortable__row.is-lifted');
      const handle = (id: string) => page.locator(`sf-sources-dock [data-sortable-id="${id}"] .c-sortable__handle`);

      // 1. The handle: touch, move, release; no waiting.
      const grip = await centreOf(handle('itm_layera'));
      const top = await centreOf(list.first());
      await touch.down(grip.x, grip.y);
      await touch.move(grip.x, grip.y - 10);
      await touch.move(grip.x, top.y - 10);
      await expect(lifted).toHaveCount(1);
      await touch.up();
      await expect.poll(apiOrder).toEqual(['itm_layerb', 'itm_layerc', 'itm_layera']);
      await expect.poll(() => idsOf(list)).toEqual(['itm_layera', 'itm_layerc', 'itm_layerb']);
      expect(orderRequests).toHaveLength(1);

      // 2. A swipe that starts moving at once is a scroll, not a drag.
      const row = await centreOf(list.nth(2));
      await touch.down(row.x + 60, row.y);
      await touch.move(row.x + 60, row.y - 30);
      await touch.move(row.x + 60, row.y - 60);
      await page.waitForTimeout(600);
      await expect(lifted).toHaveCount(0);
      await touch.up();
      expect(orderRequests, 'the swipe sent nothing').toHaveLength(1);

      // 3. Press and hold on the row, then drag it to the top.
      const hold = await centreOf(list.nth(2));
      const first = await centreOf(list.first());
      await touch.down(hold.x + 60, hold.y);
      await page.waitForTimeout(600);
      await expect(lifted, 'the held row is lifted').toHaveCount(1);
      await touch.move(hold.x + 60, hold.y - 10);
      await touch.move(hold.x + 60, first.y - 10);
      await touch.up();
      await expect.poll(apiOrder).toEqual(['itm_layerc', 'itm_layera', 'itm_layerb']);
      expect(orderRequests).toHaveLength(2);
      expect(regie.problems.pageErrors).toEqual([]);
    },
  );
});
