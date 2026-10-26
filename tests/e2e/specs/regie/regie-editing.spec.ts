import { pairLaptopByLink, pairPhone, type PairedDevice } from '../../support/production';
import { DeviceHub } from '../../support/hubs';
import { sleep } from '../../support/shell';
import { t } from '../../support/tags';
import { uniqueIp } from '../../support/fixtures';
import { expect, test } from '../../support/ui/fixtures';
import {
  CANVAS,
  COLOR,
  Gesture,
  SCENES,
  addItems,
  canvasSpace,
  centerOf,
  dragBetween,
  expectScene,
  expectStableScene,
  expectToast,
  field,
  getScene,
  hex,
  inset,
  inspector,
  inspectorSub,
  inspectorTitle,
  item,
  monitorOf,
  monitorPixels,
  near,
  overlayBoxes,
  overlayOf,
  radiusField,
  recordRequests,
  renderedItems,
  replaceItems,
  selectViaRow,
  sourceRow,
  sourcesDock,
  toastOf,
  uploadSolid,
} from '../../support/regie/kit';

/**
 * Editing in the monitor and the inspector (docs/testing.md 2.3: E2E-SCENE-05 ... 19): templates, drag with snapping, resize,
 * Alt+drag crop, arrow nudge, inspector fields, undo/redo, layers, hide and lock, remove, fit/mirror/corners/hold, two
 * operators, coalesced requests and the live-scene lock. K1 ... are REST-paired phones (offline: no media needed), M1 ... are
 * flat-colour images, so geometry, DOM and pixels are known.
 */

test.use({ viewport: { width: 1440, height: 900 } });

const ZERO_CROP = { top: 0, right: 0, bottom: 0, left: 0 };

/** Slot rectangles of the eight templates, copied from the prototype (prototype/regie.html, PRESETS) and docs/testing.md. */
const GRID3 = [40, 378, 716].flatMap((y) => [86, 674, 1262].map((x) => [x, y, 572, 322] as const));
const SLOTS: Record<string, ReadonlyArray<readonly [number, number, number, number]> | null> = {
  full: [[0, 0, 1920, 1080]],
  two: [
    [40, 287, 900, 506],
    [980, 287, 900, 506],
  ],
  pip: [
    [0, 0, 1920, 1080],
    [1400, 772, 480, 270],
  ],
  col: [
    [40, 158, 1360, 765],
    [1440, 283, 440, 248],
    [1440, 551, 440, 248],
  ],
  onetwo: [
    [40, 196, 1225, 689],
    [1285, 196, 595, 335],
    [1285, 551, 595, 335],
  ],
  grid: [
    [79, 40, 871, 490],
    [970, 40, 871, 490],
    [79, 550, 871, 490],
    [970, 550, 871, 490],
  ],
  grid3: GRID3,
  auto: null,
};
const NAMES: Record<string, string> = {
  full: 'Full screen',
  two: 'Side by side',
  pip: 'Picture in picture',
  col: 'Screen + camera column',
  onetwo: 'One plus two',
  grid: '2 × 2',
  grid3: '3 × 3',
  auto: 'Auto grid',
};

async function phones(
  pairContext: Parameters<typeof pairPhone>[0],
  names: string[],
): Promise<PairedDevice[]> {
  const result: PairedDevice[] = [];
  for (const name of names) result.push(await pairPhone(pairContext, { name }));
  return result;
}

test.describe('REGIE editing: templates', () => {
  // Per template: the sources that go into the scene, in the order they are added (cameras before the screen on purpose).
  const SETUPS: Record<string, string[]> = {
    full: ['S1'],
    two: ['K1', 'S1'],
    pip: ['K1', 'S1'],
    col: ['K1', 'K2', 'S1'],
    onetwo: ['K1', 'S1', 'K2'],
    grid: ['K1', 'S1', 'K2', 'K3'],
    grid3: ['K1', 'S1', 'K2', 'K3', 'M1'],
    auto: ['M1', 'M2', 'M3', 'M4'],
  };
  const KIND_RANK: Record<string, number> = { S: 0, M: 1, K: 2 };

  for (const templateId of Object.keys(SETUPS)) {
    const smoke = ['full', 'two', 'pip'].includes(templateId);
    test(
      `E2E-SCENE-05 [${templateId}] “${NAMES[templateId]}” through the inspector: rectangles, order, fit and radius in the API, in the monitor DOM and in the X/Y/B/H fields`,
      smoke ? t.smoke : t.p0,
      async ({ regie, api, production, pairContext }) => {
        await production.seed([...SCENES]);
        const sceneA = production.sceneIds[0]!;
        const page = regie.page;
        const [one, two, three] = await phones(pairContext, [
          'Phone One',
          'Phone Two',
          'Phone Three',
        ]);
        const laptop = await pairLaptopByLink(pairContext, { name: 'Laptop Lea' });
        const images = await Promise.all(
          [COLOR.red, COLOR.green, COLOR.blue, COLOR.yellow].map((rgb, index) =>
            uploadSolid(api, production, `Image${index + 1}`, rgb),
          ),
        );
        // codes: K1..K3 phones, S1 laptop, M1..M4 images
        const byCode: Record<string, string> = {
          K1: one!.sourceId(),
          K2: two!.sourceId(),
          K3: three!.sourceId(),
          S1: laptop.sourceId(),
          M1: images[0]!.id,
          M2: images[1]!.id,
          M3: images[2]!.id,
          M4: images[3]!.id,
        };
        const codes = SETUPS[templateId]!;
        const scene = await addItems(
          api,
          production,
          sceneA,
          codes.map((code) => byCode[code]!),
          { x: 300, y: 300, w: 400, h: 225, radius: 12 },
        );
        const idOfCode = new Map(codes.map((code, index) => [code, scene.items[index]!.id]));
        await regie.waitForConvergence(production.id);
        await expect(sourcesDock(page).locator('.c-src')).toHaveCount(codes.length);

        await inspector(page)
          .getByRole('button', { name: NAMES[templateId]!, exact: true })
          .click();
        await expectToast(page, `Template “${NAMES[templateId]}” applied`);
        await expect(toastOf(page).getByRole('button', { name: 'Undo' })).toBeVisible();

        const slots = SLOTS[templateId];
        if (slots === null) {
          // Auto grid: the mode changes, the items stay (order and geometry); the renderer arranges the four images in a 2 x 2 grid.
          const after = await expectScene(
            api,
            production,
            sceneA,
            (entry) => entry.layoutMode === 'autoGrid',
            'the scene is in Auto grid mode',
          );
          expect(after.items.map((entry) => entry.id)).toEqual(
            scene.items.map((entry) => entry.id),
          );
          expect(after.items.map((entry) => [entry.x, entry.y, entry.w, entry.h])).toEqual(
            scene.items.map((entry) => [entry.x, entry.y, entry.w, entry.h]),
          );
          await expect(inspector(page)).toContainText('Auto grid active');
          await expect(inspector(page).getByRole('button', { name: 'Auto grid' })).toHaveAttribute(
            'aria-pressed',
            'true',
          );
          const grid = SLOTS['grid']!;
          await expect
            .poll(
              async () =>
                (await renderedItems(page, 'program')).map((entry) => [
                  entry.x,
                  entry.y,
                  entry.w,
                  entry.h,
                ]),
              { message: 'the Program monitor arranges four items as 2 x 2' },
            )
            .toEqual(grid.map((slot) => [...slot]));
          return;
        }

        // The expected order: the placed items first in slot order (kind rank screen < media < camera, stable), then the rest.
        const ranked = codes
          .map((code, index) => ({ code, index }))
          .sort((a, b) => KIND_RANK[a.code[0]!]! - KIND_RANK[b.code[0]!]! || a.index - b.index);
        const placed = ranked.slice(0, slots.length);
        const leftover = ranked.slice(slots.length).sort((a, b) => a.index - b.index);
        const expectedOrder = [...placed, ...leftover].map((entry) => idOfCode.get(entry.code)!);
        const after = await expectScene(
          api,
          production,
          sceneA,
          (entry) =>
            entry.items.map((i) => i.id).join() === expectedOrder.join() &&
            [entry.items[0]!.x, entry.items[0]!.y, entry.items[0]!.w, entry.items[0]!.h].join() ===
              slots[0]!.join(),
          'the template is applied',
        );
        expect(after.layoutMode).toBe('free');
        expect(
          after.items.map((entry) => entry.id),
          'z-order: placed items in slot order, then the rest',
        ).toEqual(expectedOrder);
        placed.forEach((entry, slotIndex) => {
          const actual = after.items[slotIndex]!;
          const slot = slots[slotIndex]!;
          expect(
            [actual.x, actual.y, actual.w, actual.h],
            `slot ${slotIndex} of ${entry.code}`,
          ).toEqual([...slot]);
          const screenLead =
            entry.code.startsWith('S') &&
            slotIndex === 0 &&
            templateId !== 'two' &&
            !templateId.startsWith('grid');
          expect(actual.fit, `fit of ${entry.code} in slot ${slotIndex}`).toBe(
            screenLead ? 'contain' : 'cover',
          );
          expect(actual.radius, `radius of slot ${slotIndex}`).toBe(slot[2] === CANVAS.w ? 0 : 12);
        });
        leftover.forEach((entry, position) => {
          const actual = after.items[placed.length + position]!;
          expect(
            [actual.x, actual.y, actual.w, actual.h],
            `${entry.code} beyond the slots keeps its geometry`,
          ).toEqual([300, 300, 400, 225]);
        });

        // The Program monitor draws exactly that.
        await expect
          .poll(
            async () =>
              (await renderedItems(page, 'program')).map((entry) =>
                [entry.id, entry.x, entry.y, entry.w, entry.h, entry.z].join(','),
              ),
            { message: 'monitor DOM equals the slots' },
          )
          .toEqual(
            after.items.map((entry, index) =>
              [entry.id, entry.x, entry.y, entry.w, entry.h, index].join(','),
            ),
          );

        // The inspector shows the numbers of the first and the last placed item.
        for (const slotIndex of [0, placed.length - 1]) {
          const code = placed[slotIndex]!.code;
          const row = sourcesDock(page).getByRole('button', {
            name: new RegExp(`^Select: ${code} `),
          });
          await row.click();
          await expect(inspectorTitle(page)).toHaveText('Item');
          const slot = slots[slotIndex]!;
          await expect(field(page, 'x')).toHaveValue(String(slot[0]));
          await expect(field(page, 'y')).toHaveValue(String(slot[1]));
          await expect(field(page, 'w')).toHaveValue(String(slot[2]));
          await expect(field(page, 'h')).toHaveValue(String(slot[3]));
          await row.click(); // a second click clears the selection again
          await expect(inspectorTitle(page)).toHaveText('Scene');
        }

        // “Undo” of the toast restores the previous rectangles and order.
        await page.keyboard.press('Control+z');
        await expectScene(
          api,
          production,
          sceneA,
          (entry) =>
            entry.items.map((i) => i.id).join() === scene.items.map((i) => i.id).join() &&
            entry.items.every((i) => i.x === 300 && i.w === 400),
          'undo restores the old geometry and order',
        );
        expect(regie.problems.pageErrors).toEqual([]);
      },
    );
  }

  test(
    'E2E-SCENE-05 [empty, locked] a scene without visible elements says “Add a source first”; in Studio Mode on the live scene the templates are disabled',
    t.p0,
    async ({ regie, api, production, pairContext }) => {
      await production.seed([...SCENES]);
      const page = regie.page;
      await inspector(page).getByRole('button', { name: 'Full screen', exact: true }).click();
      await expectToast(page, 'Add a source first');
      expect((await getScene(api, production, production.sceneIds[0]!)).items).toEqual([]);

      const [phone] = await phones(pairContext, ['Phone One']);
      await addItems(api, production, production.sceneIds[0]!, [phone!.sourceId()]);
      await regie.setStudioMode(true);
      await regie.clickScene('Scene A'); // preview = program: the live scene is locked
      await expect(monitorOf(page, 'preview')).toContainText(
        'This scene is live right now. Editing is possible once another scene is on Program.',
      );
      for (const name of Object.values(NAMES))
        await expect(inspector(page).getByRole('button', { name, exact: true })).toBeDisabled();
      // Another scene in the preview: not live, so the templates are usable again (empty scene: “Add a source first”).
      await regie.clickScene('Scene B');
      await expect(regie.scene('Scene B')).toHaveAttribute('aria-pressed', 'true');
      await expect(
        inspector(page).getByRole('button', { name: 'Full screen', exact: true }),
      ).toBeEnabled();
      await expect(monitorOf(page, 'preview').locator('.c-monitor__live-note')).toHaveCount(0);
    },
  );
});

test.describe('REGIE editing: monitor gestures', () => {
  test(
    'E2E-SCENE-07 [regie] drag moves by the pointer distance and snaps to the canvas edges, the safe margin, the centre and other elements; Alt switches snapping off; one undo step per drag',
    t.smoke,
    async ({ regie, api, production, pairContext }) => {
      await production.seed([...SCENES]);
      const sceneA = production.sceneIds[0]!;
      const page = regie.page;
      const [one, two] = await phones(pairContext, ['Phone One', 'Phone Two']);
      const scene = await replaceItems(api, production, sceneA, [
        item('itm_dragone', one!.sourceId(), { x: 200, y: 150, w: 600, h: 338 }),
        item('itm_dragtwo', two!.sourceId(), { x: 1500, y: 700, w: 300, h: 169 }),
      ]);
      await regie.waitForConvergence(production.id);
      const overlay = overlayOf(page);
      await expect(overlay.locator('.c-edit-box')).toHaveCount(2);

      const read = async () =>
        (await getScene(api, production, sceneA)).items.find(
          (entry) => entry.id === 'itm_dragone',
        )!;
      const dragTo = async (
        dx: number,
        dy: number,
        options: { modifiers?: Array<'Alt'>; holdCheck?: () => Promise<void> } = {},
      ) => {
        const space = await canvasSpace(page);
        const current = await read();
        const start = centerOf(space, current);
        const gesture = new Gesture(page, options.modifiers ?? []);
        await gesture.begin(start);
        await gesture.to(
          space.client(current.x + current.w / 2 + dx, current.y + current.h / 2 + dy),
          10,
        );
        await options.holdCheck?.();
        await gesture.end();
      };

      // Free move by (+320, +130): no line near the new position, so x/y = start + delta (rounding of one pixel).
      await dragTo(320, 130, {
        holdCheck: async () => {
          await expect(overlay, 'the dot raster shows while dragging').toHaveClass(/is-dragging/);
          await expect(
            overlay.locator('.c-edit-overlay__guide'),
            'no guide for a free move',
          ).toHaveCount(0);
        },
      });
      await expect(overlay, 'the raster is gone after the release').not.toHaveClass(/is-dragging/);
      let moved = await expectScene(
        api,
        production,
        sceneA,
        (entry) => near(entry.items[0]!.x, 520, 2) && near(entry.items[0]!.y, 280, 2),
        'the element moved by the pointer distance',
      );
      expect(moved.items[0]).toMatchObject({ w: 600, h: 338 });
      // The whole drag is one undo step.
      await page.keyboard.press('Control+z');
      await expectScene(
        api,
        production,
        sceneA,
        (entry) => entry.items[0]!.x === 200 && entry.items[0]!.y === 150,
        'one Ctrl+Z reverts the whole drag',
      );
      await expectToast(page, 'Undone');

      // Snap to the left canvas edge: target x = 8 is within 7 screen px (20 canvas px) of 0 -> exactly 0, blue guide while held.
      await dragTo(-192, 0, {
        holdCheck: async () => {
          await expect(
            overlay.locator('.c-edit-overlay__guide--v'),
            'blue guide while snapped',
          ).toHaveCount(1);
          const left = await overlay
            .locator('.c-edit-overlay__guide--v')
            .evaluate((element) => (element as HTMLElement).style.left);
          expect(parseFloat(left), 'the guide sits on the canvas edge').toBeCloseTo(0, 1);
        },
      });
      await expect(
        overlay.locator('.c-edit-overlay__guide'),
        'guides are gone after the release',
      ).toHaveCount(0);
      await expectScene(
        api,
        production,
        sceneA,
        (entry) => entry.items[0]!.x === 0,
        'snapped exactly to x = 0',
      );
      // Safe margin: left edge about 44 -> 40.
      await dragTo(44, 0);
      await expectScene(
        api,
        production,
        sceneA,
        (entry) => entry.items[0]!.x === 40,
        'snapped exactly to the safe margin 40',
      );
      // Centre: element centre about 968 -> 960 (x = 660).
      await dragTo(628, 0);
      await expectScene(
        api,
        production,
        sceneA,
        (entry) => entry.items[0]!.x === 660,
        'snapped exactly to the canvas centre',
      );
      // The edge of another element: right edge about 1508 -> 1500 (x = 900).
      await dragTo(248, 0);
      await expectScene(
        api,
        production,
        sceneA,
        (entry) => entry.items[0]!.x === 900,
        "snapped exactly to the other element's edge",
      );
      // Alt: no snapping and no guide - 8 px from the edge stays 8 px.
      await dragTo(-892, 0, {
        modifiers: ['Alt'],
        holdCheck: async () => {
          await expect(overlay.locator('.c-edit-overlay__guide'), 'no guide with Alt').toHaveCount(
            0,
          );
        },
      });
      moved = await expectScene(
        api,
        production,
        sceneA,
        (entry) => near(entry.items[0]!.x, 8, 2),
        'with Alt the element stays where it was dropped',
      );
      expect(moved.items[0]!.x, 'not snapped to 0').not.toBe(0);
      expect(scene.items).toHaveLength(2);
      expect(regie.problems.pageErrors).toEqual([]);
    },
  );

  test(
    'E2E-SCENE-08 [regie] corner resize keeps the aspect ratio, Shift frees it; the minimum is honoured, the label shows the size live; values stay inside the bounds',
    t.p1,
    async ({ regie, api, production, pairContext }) => {
      await production.seed([...SCENES]);
      const sceneA = production.sceneIds[0]!;
      const page = regie.page;
      const [one] = await phones(pairContext, ['Phone One']);
      await replaceItems(api, production, sceneA, [
        item('itm_resize1', one!.sourceId(), { x: 200, y: 150, w: 600, h: 338 }),
      ]);
      await regie.waitForConvergence(production.id);
      const overlay = overlayOf(page);
      const space0 = await canvasSpace(page);
      await page.mouse.click(
        ...(Object.values(centerOf(space0, { x: 200, y: 150, w: 600, h: 338 })) as [
          number,
          number,
        ]),
      );
      const handle = overlay.locator('.c-edit-box.is-sel [data-handle="se"]');
      await expect(handle).toBeVisible();
      const label = overlay.locator('.c-edit-box.is-sel .c-edit-box__label');
      await expect(label).toHaveText('K1 · 600 × 338');

      const resize = async (
        to: (
          corner: { x: number; y: number },
          space: Awaited<ReturnType<typeof canvasSpace>>,
        ) => { x: number; y: number },
        options: { modifiers?: Array<'Shift'>; check?: () => Promise<void> } = {},
      ) => {
        const space = await canvasSpace(page);
        const box = (await handle.boundingBox())!;
        const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
        const gesture = new Gesture(page, options.modifiers ?? []);
        await gesture.begin(start);
        await gesture.to(to(start, space), 10);
        await options.check?.();
        await gesture.end();
      };

      // Default: the ratio is kept. +200 canvas px wide -> 800 x 451.
      await resize((start, space) => ({ x: start.x + 200 * space.scale, y: start.y }), {
        check: async () => {
          await expect(label, 'the label shows the size while dragging').toHaveText(
            /^K1 · 8\d\d × 4[45]\d$/,
          );
        },
      });
      let current = await expectScene(
        api,
        production,
        sceneA,
        (scene) => near(scene.items[0]!.w, 800, 2),
        'the element is 800 wide',
      );
      expect(
        Math.abs(current.items[0]!.w / current.items[0]!.h - 600 / 338),
        'aspect ratio kept (±0.01)',
      ).toBeLessThan(0.01);
      expect(current.items[0]).toMatchObject({ x: 200, y: 150 });

      // Shift frees the ratio: +200 wide only.
      await page.keyboard.press('Control+z');
      await expectScene(api, production, sceneA, (scene) => scene.items[0]!.w === 600, 'undo');
      await resize((start, space) => ({ x: start.x + 200 * space.scale, y: start.y }), {
        modifiers: ['Shift'],
      });
      current = await expectScene(
        api,
        production,
        sceneA,
        (scene) => near(scene.items[0]!.w, 800, 2),
        'the width changed with Shift',
      );
      expect(current.items[0]!.h, 'with Shift the height stays').toBe(338);

      // The drag minimum is 96 x 54 (GAP-11): pull the corner far past the opposite corner.
      await page.keyboard.press('Control+z');
      await resize((start, space) => ({
        x: start.x - 900 * space.scale,
        y: start.y - 600 * space.scale,
      }));
      current = await expectScene(
        api,
        production,
        sceneA,
        (scene) => scene.items[0]!.w < 200,
        'the element shrank to its minimum',
      );
      expect(current.items[0]).toMatchObject({ w: 96, h: 54, x: 200, y: 150 });
      await page.keyboard.press('Control+z');
      await expectScene(api, production, sceneA, (scene) => scene.items[0]!.w === 600, 'undo');

      // Beyond the canvas: the corner may go past 1920 (up to 3840 wide); the server bound holds.
      const space = await canvasSpace(page);
      const farRight = { x: 1430, y: space.client(0, 700).y };
      await resize(() => farRight);
      current = await expectScene(
        api,
        production,
        sceneA,
        (scene) => scene.items[0]!.w > 1500,
        'the element grew beyond the canvas',
      );
      expect(
        current.items[0]!.x + current.items[0]!.w,
        'its right edge is outside the canvas',
      ).toBeGreaterThan(CANVAS.w);
      expect(current.items[0]!.w).toBeLessThanOrEqual(3840);
      expect(regie.problems.pageErrors).toEqual([]);
    },
  );

  test(
    'E2E-SCENE-09 [regie] Alt+drag on an edge or corner crops: crop values, shrinking visible box with the picture kept in place, 0.45 limit, undo',
    t.p1,
    async ({ regie, api, production, pairContext }) => {
      await production.seed([...SCENES]);
      const sceneA = production.sceneIds[0]!;
      const page = regie.page;
      const [one] = await phones(pairContext, ['Phone One']);
      await replaceItems(api, production, sceneA, [
        item('itm_crop1', one!.sourceId(), { x: 200, y: 150, w: 600, h: 338 }),
      ]);
      await regie.waitForConvergence(production.id);
      const overlay = overlayOf(page);
      const space0 = await canvasSpace(page);
      await page.mouse.click(
        ...(Object.values(centerOf(space0, { x: 200, y: 150, w: 600, h: 338 })) as [
          number,
          number,
        ]),
      );
      await expect(overlay.locator('.c-edit-box.is-sel')).toHaveCount(1);

      const cropDrag = async (edge: string, dx: number, dy: number) => {
        const space = await canvasSpace(page);
        const handle = overlay.locator(`.c-edit-box.is-sel [data-handle="${edge}"]`);
        const box = (await handle.boundingBox())!;
        const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
        const gesture = new Gesture(page, ['Alt']);
        await gesture.begin(start);
        await gesture.to({ x: start.x + dx * space.scale, y: start.y + dy * space.scale }, 10);
        await gesture.end();
      };
      const now = async () => (await getScene(api, production, sceneA)).items[0]!;

      // Right edge inwards by 20 % of the width (120 px): crop.right = 0.2, the visible box is 480 wide, the picture keeps its size.
      await cropDrag('e', -120, 0);
      let current = await expectStableScene(
        api,
        production,
        sceneA,
        (scene) => scene.items[0]!.crop.right > 0.15,
        'the right edge is cropped',
      );
      expect(current.items[0]!.crop.right).toBeCloseTo(0.2, 1);
      expect(current.items[0]).toMatchObject({ x: 200, y: 150, h: 338 });
      expect(near(current.items[0]!.w, 480, 3), `visible width ${current.items[0]!.w}`).toBe(true);
      await expect(overlay.locator('.c-edit-box.is-sel .c-edit-box__label')).toContainText(
        'Crop R 20%',
      );
      // The renderer draws the cropped part at the same picture size: the uncropped box stays 600 wide.
      const cropBox = await page
        .locator(
          `${'sf-monitor.c-monitor--program'} .sf-r-item[data-item-id="itm_crop1"] .sf-r-crop`,
        )
        .evaluate((element) => ({
          width: parseFloat((element as HTMLElement).style.width),
          left: parseFloat((element as HTMLElement).style.left),
        }));
      expect(near(cropBox.width, 600, 3), `picture box width ${cropBox.width}`).toBe(true);
      expect(cropBox.left).toBeCloseTo(0, 0);

      // Top edge inwards by 20 % of the height.
      await cropDrag('n', 0, 68);
      current = await expectStableScene(
        api,
        production,
        sceneA,
        (scene) => scene.items[0]!.crop.top > 0.15,
        'the top edge is cropped',
      );
      expect(current.items[0]!.crop.top).toBeCloseTo(0.2, 1);
      expect(current.items[0]).toMatchObject({ x: 200 });
      expect(near(current.items[0]!.y, 218, 3)).toBe(true);

      // A corner crops two sides at once.
      await cropDrag('se', -48, -27);
      current = await expectStableScene(
        api,
        production,
        sceneA,
        (scene) => scene.items[0]!.crop.bottom > 0.05,
        'the south-east corner is cropped',
      );
      expect(current.items[0]!.crop.right, 'right grew beyond 0.2').toBeGreaterThan(0.25);
      expect(current.items[0]!.crop.bottom).toBeGreaterThan(0.05);

      // Undo brings the crop and the box back step by step (one undo per drag).
      await page.keyboard.press('Control+z');
      await page.keyboard.press('Control+z');
      await page.keyboard.press('Control+z');
      await expectScene(
        api,
        production,
        sceneA,
        (scene) =>
          JSON.stringify(scene.items[0]!.crop) === JSON.stringify(ZERO_CROP) &&
          scene.items[0]!.w === 600 &&
          scene.items[0]!.y === 150,
        'three undos restore the uncropped element',
      );
      expect(await now()).toMatchObject({ x: 200, y: 150, w: 600, h: 338 });

      // The crop stops at 0.45 per side: pull the right edge far inwards.
      await cropDrag('e', -590, 0);
      current = await expectStableScene(
        api,
        production,
        sceneA,
        (scene) => scene.items[0]!.crop.right > 0.4,
        'the crop reached its limit',
      );
      expect(current.items[0]!.crop.right, 'never above 0.45').toBeLessThanOrEqual(0.4501);
      expect(current.items[0]!.crop.right).toBeGreaterThan(0.44);
      await page.keyboard.press('Control+z');
      await expectScene(
        api,
        production,
        sceneA,
        (scene) => scene.items[0]!.crop.right === 0 && scene.items[0]!.w === 600,
        'undo restores the crop',
      );
      expect(regie.problems.pageErrors).toEqual([]);
    },
  );

  test(
    'E2E-SCENE-10 [regie] arrow keys nudge by 1 px (Shift 10 px); a key-repeat burst is one undo step; Escape and a click on empty space deselect',
    t.p1,
    async ({ regie, api, production, pairContext }) => {
      await production.seed([...SCENES]);
      const sceneA = production.sceneIds[0]!;
      const page = regie.page;
      const [one] = await phones(pairContext, ['Phone One']);
      await replaceItems(api, production, sceneA, [
        item('itm_nudge1', one!.sourceId(), { x: 600, y: 300, w: 600, h: 338 }),
      ]);
      await regie.waitForConvergence(production.id);
      const space = await canvasSpace(page);
      await page.mouse.click(
        ...(Object.values(centerOf(space, { x: 600, y: 300, w: 600, h: 338 })) as [number, number]),
      );
      await expect(inspectorTitle(page)).toHaveText('Item');
      const read = async () => (await getScene(api, production, sceneA)).items[0]!;

      for (let index = 0; index < 3; index++) await page.keyboard.press('ArrowRight');
      await expectScene(
        api,
        production,
        sceneA,
        (scene) => scene.items[0]!.x === 603,
        'three presses move x by 3',
      );
      await page.keyboard.press('Shift+ArrowDown');
      await expectScene(
        api,
        production,
        sceneA,
        (scene) => scene.items[0]!.y === 310,
        'Shift+ArrowDown moves y by 10',
      );
      await page.keyboard.press('ArrowLeft');
      await page.keyboard.press('ArrowUp');
      await expectScene(
        api,
        production,
        sceneA,
        (scene) => scene.items[0]!.x === 602 && scene.items[0]!.y === 309,
        'ArrowLeft / ArrowUp move by 1',
      );

      // A key-repeat burst (key held down) is one undo step.
      const before = await read();
      await page.keyboard.down('ArrowRight');
      await page.keyboard.down('ArrowRight');
      await page.keyboard.down('ArrowRight');
      await page.keyboard.up('ArrowRight');
      await expectScene(
        api,
        production,
        sceneA,
        (scene) => scene.items[0]!.x === before.x + 3,
        'the burst moved by 3',
      );
      await page.keyboard.press('Control+z');
      await expectScene(
        api,
        production,
        sceneA,
        (scene) => scene.items[0]!.x === before.x,
        'one Ctrl+Z undoes the whole burst',
      );

      // Escape deselects (inspector back to “Scene”); a click on the empty monitor area deselects as well.
      await page.keyboard.press('Escape');
      await expect(inspectorTitle(page)).toHaveText('Scene');
      await page.mouse.click(
        ...(Object.values(centerOf(space, { x: 600, y: 300, w: 600, h: 338 })) as [number, number]),
      );
      await expect(inspectorTitle(page)).toHaveText('Item');
      const empty = space.client(80, 1000);
      await page.mouse.click(empty.x, empty.y);
      await expect(inspectorTitle(page)).toHaveText('Scene');
      expect(regie.problems.pageErrors).toEqual([]);
    },
  );

  test(
    'E2E-SCENE-11 [regie] inspector number fields clamp to the server bounds, ignore text, round decimals, restore on empty, update the label while typing and persist',
    t.p1,
    async ({ regie, api, production, pairContext }) => {
      await production.seed([...SCENES]);
      const sceneA = production.sceneIds[0]!;
      const page = regie.page;
      const [one] = await phones(pairContext, ['Phone One']);
      await replaceItems(api, production, sceneA, [
        item('itm_fields1', one!.sourceId(), { x: 300, y: 200, w: 600, h: 338 }, { radius: 12 }),
      ]);
      await regie.waitForConvergence(production.id);
      await selectViaRow(page, 'K1 Phone One');
      const read = async () => (await getScene(api, production, sceneA)).items[0]!;
      const label = overlayOf(page).locator('.c-edit-box.is-sel .c-edit-box__label');

      const enter = async (target: ReturnType<typeof field>, text: string) => {
        await target.fill(text);
        await target.blur();
      };
      // X: 5000 -> 3840, -5000 -> -3840; Y: 5000 -> 2160, -5000 -> -2160; B/H: 0 -> 16, 5000 -> 3840 / 2160.
      await enter(field(page, 'x'), '5000');
      await expectScene(
        api,
        production,
        sceneA,
        (scene) => scene.items[0]!.x === 3840,
        'x clamps to 3840',
      );
      await expect(field(page, 'x')).toHaveValue('3840');
      await enter(field(page, 'x'), '-5000');
      await expectScene(
        api,
        production,
        sceneA,
        (scene) => scene.items[0]!.x === -3840,
        'x clamps to -3840',
      );
      await enter(field(page, 'y'), '-5000');
      await expectScene(
        api,
        production,
        sceneA,
        (scene) => scene.items[0]!.y === -2160,
        'y clamps to -2160',
      );
      await enter(field(page, 'y'), '5000');
      await expectScene(
        api,
        production,
        sceneA,
        (scene) => scene.items[0]!.y === 2160,
        'y clamps to 2160',
      );
      await enter(field(page, 'w'), '0');
      await expectScene(
        api,
        production,
        sceneA,
        (scene) => scene.items[0]!.w === 16,
        'w clamps to 16',
      );
      await enter(field(page, 'h'), '0');
      await expectScene(
        api,
        production,
        sceneA,
        (scene) => scene.items[0]!.h === 16,
        'h clamps to 16',
      );
      await enter(field(page, 'w'), '5000');
      await expectScene(
        api,
        production,
        sceneA,
        (scene) => scene.items[0]!.w === 3840,
        'w clamps to 3840',
      );
      await enter(field(page, 'h'), '5000');
      await expectScene(
        api,
        production,
        sceneA,
        (scene) => scene.items[0]!.h === 2160,
        'h clamps to 2160',
      );
      await enter(radiusField(page), '300');
      await expectScene(
        api,
        production,
        sceneA,
        (scene) => scene.items[0]!.radius === 200,
        'the corner radius clamps to 200 (not 80)',
      );
      await enter(field(page, 'x'), '99999999999');
      await expectScene(
        api,
        production,
        sceneA,
        (scene) => scene.items[0]!.x === 3840,
        'a huge number clamps',
      );

      // Decimals are rounded; text is ignored; empty restores the previous value.
      await enter(field(page, 'x'), '300');
      await enter(field(page, 'y'), '200');
      await enter(field(page, 'w'), '600');
      await enter(field(page, 'h'), '338');
      await expectScene(
        api,
        production,
        sceneA,
        (scene) => scene.items[0]!.x === 300 && scene.items[0]!.h === 338,
        'back to normal values',
      );
      await enter(field(page, 'x'), '1.5');
      await expectScene(
        api,
        production,
        sceneA,
        (scene) => Number.isInteger(scene.items[0]!.x) && scene.items[0]!.x !== 300,
        'a decimal is rounded to a whole pixel',
      );
      expect([1, 2]).toContain((await read()).x);
      await field(page, 'x').fill('');
      await field(page, 'x').pressSequentially('abc');
      await field(page, 'x').blur();
      await expect(field(page, 'x'), 'text and empty input restore the previous value').toHaveValue(
        String((await read()).x),
      );
      const before = await read();
      await field(page, 'y').fill('');
      await field(page, 'y').blur();
      await expect(field(page, 'y')).toHaveValue(String(before.y));

      // The label tab updates while typing (before the field loses the focus).
      await field(page, 'w').fill('777');
      await expect(label).toContainText('777 ×');
      await field(page, 'w').blur();
      await expectScene(api, production, sceneA, (scene) => scene.items[0]!.w === 777, 'w saved');

      // After a reload the fields show what the server holds.
      const saved = await read();
      await page.reload();
      await regie.waitReady();
      await selectViaRow(page, 'K1 Phone One');
      await expect(field(page, 'x')).toHaveValue(String(saved.x));
      await expect(field(page, 'y')).toHaveValue(String(saved.y));
      await expect(field(page, 'w')).toHaveValue(String(saved.w));
      await expect(field(page, 'h')).toHaveValue(String(saved.h));
      await expect(radiusField(page)).toHaveValue(String(saved.radius));
      expect(regie.problems.pageErrors).toEqual([]);
    },
  );
});

test.describe('REGIE editing: undo, layers, hide, lock, remove, look', () => {
  test(
    'E2E-SCENE-12 [regie] undo and redo: move, resize, template, fit, delete; empty stack message; 60 steps per scene; per scene; the stack is gone after a reload',
    t.smoke,
    async ({ regie, api, production, pairContext }) => {
      await production.seed([...SCENES]);
      const [sceneA] = production.sceneIds as [string, string, string];
      const page = regie.page;
      const [one] = await phones(pairContext, ['Phone One']);
      const image = await uploadSolid(api, production, 'Logo', COLOR.violet);
      await replaceItems(api, production, sceneA, [
        item('itm_undo01', one!.sourceId(), { x: 300, y: 200, w: 600, h: 338 }),
        item('itm_undo02', image.id, { x: 1000, y: 500, w: 400, h: 225 }),
      ]);
      await regie.waitForConvergence(production.id);
      const items = async () => JSON.stringify((await getScene(api, production, sceneA)).items);
      const states: string[] = [await items()];
      const settle = async (change: () => Promise<void>) => {
        const before = states[states.length - 1]!;
        await change();
        await expectStableScene(
          api,
          production,
          sceneA,
          (scene) => JSON.stringify(scene.items) !== before,
          'the edit reached the server',
        );
        states.push(await items());
      };

      const space = await canvasSpace(page);
      // 1 move
      await settle(async () => {
        await page.mouse.click(
          ...(Object.values(centerOf(space, { x: 300, y: 200, w: 600, h: 338 })) as [
            number,
            number,
          ]),
        );
        await dragBetween(
          page,
          centerOf(space, { x: 300, y: 200, w: 600, h: 338 }),
          space.client(300 + 300 + 100, 200 + 169 + 50),
        );
      });
      // 2 resize (southeast corner)
      await settle(async () => {
        const handle = overlayOf(page).locator('.c-edit-box.is-sel [data-handle="se"]');
        const box = (await handle.boundingBox())!;
        await dragBetween(
          page,
          { x: box.x + box.width / 2, y: box.y + box.height / 2 },
          { x: box.x + box.width / 2 + 60, y: box.y + box.height / 2 },
        );
      });
      // 3 template (scene view: deselect first)
      await settle(async () => {
        await page.keyboard.press('Escape');
        await inspector(page).getByRole('button', { name: 'Picture in picture', exact: true }).click();
      });
      // 4 fit
      await settle(async () => {
        await sourceRow(page, 'M1 Logo').click();
        await inspector(page).getByRole('button', { name: 'Show all' }).click();
      });
      // 5 delete the element
      await settle(async () => {
        await inspector(page).getByRole('button', { name: 'Remove from scene' }).click();
      });
      expect(new Set(states).size, 'five different states').toBe(6);

      // Undo five times: each Ctrl+Z restores the previous server state through one PUT.
      for (let step = states.length - 2; step >= 0; step--) {
        await page.keyboard.press('Control+z');
        await expect.poll(items, { message: `undo to state ${step}` }).toBe(states[step]);
        await expectToast(page, 'Undone');
      }
      // The stack is empty: the message, and the undo button is disabled.
      await page.keyboard.press('Control+z');
      await expectToast(page, 'Nothing to undo');
      await expect(page.getByRole('button', { name: 'Undo (Ctrl+Z)' })).toBeDisabled();
      // Redo goes forward again (Ctrl+Shift+Z and Ctrl+Y).
      await page.keyboard.press('Control+Shift+z');
      await expect.poll(items).toBe(states[1]);
      await expectToast(page, 'Redone');
      await page.keyboard.press('Control+y');
      await expect.poll(items).toBe(states[2]);
      // Redo once more, then a new edit clears the redo stack.
      await page.keyboard.press('Control+Shift+z');
      await expect.poll(items).toBe(states[3]);
      await sourceRow(page, /^Select: K1 /).click();
      await field(page, 'x').fill('123');
      await field(page, 'x').blur();
      await expect.poll(items).not.toBe(states[3]);
      await page.keyboard.press('Control+Shift+z');
      await expectToast(page, 'Nothing to redo');
    },
  );

  test(
    'E2E-SCENE-12 [regie, limit] 65 edits, 70 undos: only the last 60 revert; undo belongs to the scene it was recorded for; a reload empties the stack',
    t.p0,
    async ({ regie, api, production, pairContext }) => {
      await production.seed([...SCENES]);
      const [sceneA] = production.sceneIds as [string, string, string];
      const page = regie.page;
      const [one] = await phones(pairContext, ['Phone One']);
      await replaceItems(api, production, sceneA, [
        item('itm_limit1', one!.sourceId(), { x: 400, y: 300, w: 600, h: 338 }),
      ]);
      await regie.waitForConvergence(production.id);
      await regie.transitionOption('Cut').click();
      const space = await canvasSpace(page);
      await page.mouse.click(
        ...(Object.values(centerOf(space, { x: 400, y: 300, w: 600, h: 338 })) as [number, number]),
      );
      await expect(inspectorTitle(page)).toHaveText('Item');
      const x = async () => (await getScene(api, production, sceneA)).items[0]!.x;

      for (let index = 0; index < 65; index++) await page.keyboard.press('ArrowRight');
      await expect.poll(x, { timeout: 20_000 }).toBe(465);
      for (let index = 0; index < 70; index++) await page.keyboard.press('Control+z');
      await expect.poll(x, { message: 'only the last 60 edits revert', timeout: 20_000 }).toBe(405);
      await expectToast(page, 'Nothing to undo');

      // Undo is per scene: an edit in scene A, then scene B becomes the edit scene; Ctrl+Z there changes nothing in A.
      await page.keyboard.press('Shift+ArrowDown');
      await expect
        .poll(async () => (await getScene(api, production, sceneA)).items[0]!.y)
        .toBe(310);
      await regie.clickScene('Scene B');
      await expect(regie.scene('Scene B')).toHaveAttribute('aria-pressed', 'true');
      await page.keyboard.press('Control+z');
      await expectToast(page, 'Nothing to undo');
      expect((await getScene(api, production, sceneA)).items[0]!.y, 'scene A is untouched').toBe(
        310,
      );
      await regie.clickScene('Scene A');
      await expect(regie.scene('Scene A')).toHaveAttribute('aria-pressed', 'true');
      await page.keyboard.press('Control+z');
      await expect
        .poll(async () => (await getScene(api, production, sceneA)).items[0]!.y, {
          message: 'the undo of scene A still works after switching back',
        })
        .toBe(300);

      // The stack is held in the browser: a reload starts empty.
      await page.reload();
      await regie.waitReady();
      await page.keyboard.press('Control+z');
      await expectToast(page, 'Nothing to undo');
    },
  );

  test(
    'E2E-SCENE-13 [regie] layers: “Bring forward” / “Send backward” move one place, clamped at the ends; list, DOM order and the overlap pixels follow',
    t.p1,
    async ({ regie, api, production }) => {
      await production.seed([...SCENES]);
      const sceneA = production.sceneIds[0]!;
      const page = regie.page;
      const [red, green, blue] = await Promise.all([
        uploadSolid(api, production, 'Red', COLOR.red),
        uploadSolid(api, production, 'Green', COLOR.green),
        uploadSolid(api, production, 'Blue', COLOR.blue),
      ]);
      const scene = await replaceItems(api, production, sceneA, [
        item('itm_layera', red.id, { x: 100, y: 100, w: 600, h: 338 }),
        item('itm_layerb', green.id, { x: 300, y: 200, w: 600, h: 338 }),
        item('itm_layerc', blue.id, { x: 500, y: 300, w: 600, h: 338 }),
      ]);
      expect(scene.items.map((entry) => entry.id)).toEqual([
        'itm_layera',
        'itm_layerb',
        'itm_layerc',
      ]);
      await regie.waitForConvergence(production.id);
      const order = async () =>
        (await getScene(api, production, sceneA)).items.map((entry) => entry.id.slice(-1));
      const overlap = { x: 560, y: 340, width: 60, height: 60 }; // inside the middle (green) and the front (blue) element, clear of the red one
      const colorAtOverlap = async () => {
        const pixels = await monitorPixels(page);
        return {
          green: pixels.share(hex(COLOR.green), overlap),
          blue: pixels.share(hex(COLOR.blue), overlap),
        };
      };

      await expect
        .poll(async () => (await colorAtOverlap()).blue, { message: 'blue is in front first' })
        .toBeGreaterThan(0.9);
      await selectViaRow(page, /^Select: M\d Green/);
      const front = inspector(page).getByRole('button', { name: 'Bring forward', exact: true });
      const back = inspector(page).getByRole('button', { name: 'Send backward', exact: true });
      await front.click();
      await expect.poll(order).toEqual(['a', 'c', 'b']);
      await expect(front, 'at the front the button is disabled').toBeDisabled();
      // The Sources list shows the front element first.
      await expect
        .poll(() =>
          sourcesDock(page)
            .locator('.c-src__select')
            .evaluateAll((rows) =>
              rows.map((row) => row.getAttribute('aria-label')?.split(' ').pop()),
            ),
        )
        .toEqual(['Green', 'Blue', 'Red']);
      await expect
        .poll(async () =>
          (await renderedItems(page, 'program')).map((entry) => `${entry.id.slice(-1)}${entry.z}`),
        )
        .toEqual(['a0', 'c1', 'b2']);
      await expect
        .poll(async () => (await colorAtOverlap()).green, { message: 'green is in front now' })
        .toBeGreaterThan(0.9);
      await back.click();
      await expect.poll(order).toEqual(['a', 'b', 'c']);
      await back.click();
      await expect.poll(order).toEqual(['b', 'a', 'c']);
      await expect(back, 'at the back the button is disabled').toBeDisabled();
      await expect.poll(async () => (await colorAtOverlap()).blue).toBeGreaterThan(0.9);
      expect(regie.problems.pageErrors).toEqual([]);
    },
  );

  test(
    'E2E-SCENE-14 [regie] hide and lock: a hidden element leaves the monitor and the output and gives no tally; a locked one is selectable but neither dragged nor nudged; both persist for the other operator',
    t.p1,
    async ({ regie, openRegie, openOutput, api, production, pairContext, stack }) => {
      await production.seed([...SCENES]);
      const sceneA = production.sceneIds[0]!;
      const page = regie.page;
      const [one, two] = await phones(pairContext, ['Phone One', 'Phone Two']);
      await replaceItems(api, production, sceneA, [
        item('itm_hideone', one!.sourceId(), { x: 200, y: 150, w: 600, h: 338 }),
        item('itm_hidetwo', two!.sourceId(), { x: 1000, y: 500, w: 500, h: 281 }),
      ]);
      await regie.waitForConvergence(production.id);
      const operatorB = await openRegie();
      const output = await openOutput(production);
      await output.stage();
      expect((await api.startBroadcast(production.id)).status).toBe(200);
      // K1 as a device on the hub: its tally follows the element.
      const hub = DeviceHub.connect(stack.anonymousBase, one!.credentials, {
        headers: stack.forwardedForWorks ? { 'X-Forwarded-For': uniqueIp() } : {},
      });
      try {
        const hello = await hub.open();
        const overall = () => hub.tallies().at(-1)?.overall ?? hello.tally.overall;
        await expect
          .poll(overall, { message: 'K1 is in the program scene of a live broadcast' })
          .toBe('program');

        const eye = page.getByRole('button', { name: 'Hide: Phone One' });
        await eye.click();
        await expect(page.getByRole('button', { name: 'Show: Phone One' })).toHaveAttribute(
          'aria-pressed',
          'false',
        );
        await expect
          .poll(
            async () =>
              (await renderedItems(page, 'program')).find((entry) => entry.id === 'itm_hideone')
                ?.visible,
            { message: 'hidden in the Regie monitor' },
          )
          .toBe(false);
        await expect
          .poll(
            async () =>
              (await renderedItems(output.page, '#output')).find(
                (entry) => entry.id === 'itm_hideone',
              )?.visible,
            { message: 'hidden on the output' },
          )
          .toBe(false);
        await expect.poll(overall, { message: 'a hidden element gives no tally' }).toBe('off');
        await expect(
          overlayOf(page).locator('.c-edit-box[data-item-id="itm_hideone"]'),
          'no selection box for a hidden element',
        ).toHaveCount(0);
        // The row is greyed and not selectable.
        const hiddenRow = sourcesDock(page).getByRole('button', {
          name: 'Select: K1 Phone One',
        });
        await expect(hiddenRow).toHaveAttribute('aria-disabled', 'true');
        await hiddenRow.click({ force: true });
        await expect(inspectorTitle(page)).toHaveText('Scene');
        await expect(
          operatorB.page.getByRole('button', { name: 'Show: Phone One' }),
          'the other operator sees it hidden',
        ).toBeVisible({ timeout: 2000 });
        await page.getByRole('button', { name: 'Show: Phone One' }).click();
        await expect.poll(overall).toBe('program');
        await expect
          .poll(
            async () =>
              (await renderedItems(output.page, '#output')).find(
                (entry) => entry.id === 'itm_hideone',
              )?.visible,
          )
          .toBe(true);

        // Lock K2: selectable, but no drag, no nudge; the inspector still works.
        await page.getByRole('button', { name: 'Lock: Phone Two' }).click();
        await expect(page.getByRole('button', { name: 'Unlock: Phone Two' })).toHaveAttribute(
          'aria-pressed',
          'true',
        );
        await expect(
          operatorB.page.getByRole('button', { name: 'Unlock: Phone Two' }),
        ).toBeVisible({ timeout: 2000 });
        await selectViaRow(page, 'K2 Phone Two');
        const box = overlayOf(page).locator('.c-edit-box[data-item-id="itm_hidetwo"]');
        await expect(box).toHaveClass(/is-locked/);
        const space = await canvasSpace(page);
        await dragBetween(
          page,
          centerOf(space, { x: 1000, y: 500, w: 500, h: 281 }),
          space.client(1250 - 200, 640 - 100),
        );
        await page.keyboard.press('ArrowRight');
        await page.keyboard.press('Shift+ArrowDown');
        await sleep(400);
        const two2 = (await getScene(api, production, sceneA)).items.find(
          (entry) => entry.id === 'itm_hidetwo',
        )!;
        expect([two2.x, two2.y], 'a locked element is neither dragged nor nudged').toEqual([
          1000, 500,
        ]);
        expect(two2.locked).toBe(true);
        await field(page, 'x').fill('1111');
        await field(page, 'x').blur();
        await expectScene(
          api,
          production,
          sceneA,
          (s) => s.items.find((entry) => entry.id === 'itm_hidetwo')!.x === 1111,
          'the inspector still edits a locked element',
        );
      } finally {
        await hub.stop();
      }
    },
  );

  test(
    'E2E-SCENE-15 [regie] “Remove from scene” with the undo toast: the element returns with the same id, position and z-order',
    t.p1,
    async ({ regie, api, production }) => {
      await production.seed([...SCENES]);
      const sceneA = production.sceneIds[0]!;
      const page = regie.page;
      const [red, green, blue] = await Promise.all([
        uploadSolid(api, production, 'Red', COLOR.red),
        uploadSolid(api, production, 'Green', COLOR.green),
        uploadSolid(api, production, 'Blue', COLOR.blue),
      ]);
      const before = await replaceItems(api, production, sceneA, [
        item('itm_removea', red.id, { x: 100, y: 100, w: 600, h: 338 }),
        item('itm_removeb', green.id, { x: 300, y: 200, w: 600, h: 338 }),
        item('itm_removec', blue.id, { x: 500, y: 300, w: 600, h: 338 }),
      ]);
      await regie.waitForConvergence(production.id);
      await selectViaRow(page, /^Select: M\d Green/);
      await inspector(page).getByRole('button', { name: 'Remove from scene' }).click();
      await expectToast(page, /M\d removed from “Scene A”/);
      await expectScene(
        api,
        production,
        sceneA,
        (scene) => scene.items.length === 2,
        'the element is gone',
      );
      await expect(inspectorTitle(page)).toHaveText('Scene');
      await toastOf(page).getByRole('button', { name: 'Undo' }).click();
      const after = await expectScene(
        api,
        production,
        sceneA,
        (scene) => scene.items.length === 3,
        'the element is back',
      );
      expect(after.items, 'same id, position and z-order').toEqual(before.items);
    },
  );

  test(
    'E2E-SCENE-16 [regie] fit, mirror, corner radius and “On failure” reach the API, the Program monitor and the output',
    t.p1,
    async ({ regie, openOutput, api, production }) => {
      await production.seed([...SCENES]);
      const sceneA = production.sceneIds[0]!;
      const page = regie.page;
      const image = await uploadSolid(api, production, 'Red', COLOR.red);
      await replaceItems(api, production, sceneA, [
        item('itm_look1', image.id, { x: 300, y: 200, w: 600, h: 338 }, { radius: 12 }),
      ]);
      await regie.waitForConvergence(production.id);
      const output = await openOutput(production);
      await output.stage();
      await selectViaRow(page, /^Select: M1 Red/);
      const itemApi = async () => (await getScene(api, production, sceneA)).items[0]!;
      const outputItem = async () =>
        (await renderedItems(output.page, '#output')).find((entry) => entry.id === 'itm_look1');

      await inspector(page).getByRole('button', { name: 'Show all' }).click();
      await expectScene(
        api,
        production,
        sceneA,
        (scene) => scene.items[0]!.fit === 'contain',
        'fit contain',
      );
      await expect.poll(async () => (await renderedItems(page, 'program'))[0]!.fit).toBe('contain');
      await expect.poll(async () => (await outputItem())?.fit).toBe('contain');
      await inspector(page).getByRole('button', { name: 'Fill' }).click();
      await expectScene(
        api,
        production,
        sceneA,
        (scene) => scene.items[0]!.fit === 'cover',
        'fit cover',
      );
      await expect.poll(async () => (await outputItem())?.fit).toBe('cover');

      await inspector(page).getByLabel('Mirror').check();
      await expectScene(api, production, sceneA, (scene) => scene.items[0]!.mirror, 'mirror');
      await expect.poll(async () => (await renderedItems(page, 'program'))[0]!.mirrored).toBe(true);
      await expect.poll(async () => (await outputItem())?.mirrored).toBe(true);
      await inspector(page).getByLabel('Mirror').uncheck();
      await expect.poll(async () => (await outputItem())?.mirrored).toBe(false);

      for (const radius of [0, 24, 200]) {
        await radiusField(page).fill(String(radius));
        await radiusField(page).blur();
        await expectScene(
          api,
          production,
          sceneA,
          (scene) => scene.items[0]!.radius === radius,
          `radius ${radius}`,
        );
        await expect
          .poll(async () => (await renderedItems(page, 'program'))[0]!.radius)
          .toBe(radius === 0 ? '' : `${radius}px`);
        await expect
          .poll(async () => (await outputItem())?.radius)
          .toBe(radius === 0 ? '' : `${radius}px`);
      }

      const hold = inspector(page).getByLabel('On failure');
      await expect(hold.locator('option')).toHaveText([
        'Freeze frame 3 s, then dim',
        'Freeze frame 10 s, then dim',
        'Hold freeze frame',
      ]);
      await hold.selectOption({ label: 'Freeze frame 10 s, then dim' });
      expect(
        (
          await expectScene(
            api,
            production,
            sceneA,
            (scene) => scene.items[0]!.onLost.holdMs === 10000,
            'holdMs 10000',
          )
        ).items[0]!.onLost.holdMs,
      ).toBe(10000);
      await hold.selectOption({ label: 'Hold freeze frame' });
      await expectScene(
        api,
        production,
        sceneA,
        (scene) => scene.items[0]!.onLost.holdMs === null,
        'holdMs null (hold the frame)',
      );
      await hold.selectOption({ label: 'Freeze frame 3 s, then dim' });
      await expectScene(
        api,
        production,
        sceneA,
        (scene) => scene.items[0]!.onLost.holdMs === 3000,
        'holdMs 3000',
      );
      expect((await itemApi()).fit).toBe('cover');
      expect(regie.problems.pageErrors).toEqual([]);
    },
  );
});

test.describe('REGIE editing: two operators, requests, live scene', () => {
  test(
    'E2E-SCENE-17 [regie] two operators edit the same scene: different elements both survive; the same element ends at one value, equal to the API, in both UIs',
    t.smoke,
    async ({ regie, openRegie, api, production, pairContext }) => {
      await production.seed([...SCENES]);
      const sceneA = production.sceneIds[0]!;
      const pageA = regie.page;
      const [one, two] = await phones(pairContext, ['Phone One', 'Phone Two']);
      await replaceItems(api, production, sceneA, [
        item('itm_twoone', one!.sourceId(), { x: 200, y: 150, w: 600, h: 338 }),
        item('itm_twotwo', two!.sourceId(), { x: 1100, y: 500, w: 500, h: 281 }),
      ]);
      await regie.waitForConvergence(production.id);
      const operatorB = await openRegie();
      await operatorB.waitForConvergence(production.id);
      const pageB = operatorB.page;
      const tell = async (page: typeof pageA, id: string) =>
        (await renderedItems(page, 'program')).find((entry) => entry.id === id)!;

      // A drags element 1 while B types a new X for element 2.
      const spaceA = await canvasSpace(pageA);
      await selectViaRow(pageB, 'K2 Phone Two');
      await pageA.mouse.click(
        ...(Object.values(centerOf(spaceA, { x: 200, y: 150, w: 600, h: 338 })) as [
          number,
          number,
        ]),
      );
      await Promise.all([
        dragBetween(
          pageA,
          centerOf(spaceA, { x: 200, y: 150, w: 600, h: 338 }),
          spaceA.client(200 + 300 + 220, 150 + 169 + 60),
          { steps: 30 },
        ),
        (async () => {
          await field(pageB, 'x').fill('1234');
          await field(pageB, 'x').blur();
        })(),
      ]);
      // A's drag ended where the Regie of A shows the element; the server follows with the last coalesced request.
      const dragged = (await tell(pageA, 'itm_twoone')).x;
      expect(dragged, 'the element followed the pointer').toBeGreaterThan(300);
      const settled = await expectScene(
        api,
        production,
        sceneA,
        (scene) => scene.items[0]!.x === dragged && scene.items[1]!.x === 1234,
        'both changes reached the server',
      );
      expect(settled.items[0]).toMatchObject({ w: 600, h: 338 });
      for (const page of [pageA, pageB]) {
        await expect
          .poll(
            async () => [(await tell(page, 'itm_twoone')).x, (await tell(page, 'itm_twotwo')).x],
            { timeout: 1500, message: 'both UIs show both changes within 1 s' },
          )
          .toEqual([dragged, 1234]);
      }

      // The same element: A types 100, B types 200 at the same moment.
      await selectViaRow(pageA, 'K2 Phone Two');
      await Promise.all([
        (async () => {
          await field(pageA, 'x').fill('100');
          await field(pageA, 'x').blur();
        })(),
        (async () => {
          await field(pageB, 'x').fill('200');
          await field(pageB, 'x').blur();
        })(),
      ]);
      const final = await expectScene(
        api,
        production,
        sceneA,
        (scene) => scene.items[1]!.x === 100 || scene.items[1]!.x === 200,
        'one of the two values won',
      );
      const winner = final.items[1]!.x;
      await sleep(600);
      expect((await getScene(api, production, sceneA)).items[1]!.x, 'the server value stays').toBe(
        winner,
      );
      for (const page of [pageA, pageB]) {
        await expect
          .poll(async () => (await tell(page, 'itm_twotwo')).x, {
            timeout: 1500,
            message: 'both UIs end at the server value',
          })
          .toBe(winner);
        await expect(field(page, 'x')).toHaveValue(String(winner));
        await expect(toastOf(page), 'no error toast').toHaveCount(0);
      }
      expect(regie.problems.pageErrors).toEqual([]);
      expect(operatorB.problems.pageErrors).toEqual([]);
    },
  );

  test(
    'E2E-SCENE-18 [regie] a drag sends at most one request per element in flight, in order, ends at the release position and never goes back',
    t.p0,
    async ({ regie, api, production, pairContext }) => {
      await production.seed([...SCENES]);
      const sceneA = production.sceneIds[0]!;
      const page = regie.page;
      const [one] = await phones(pairContext, ['Phone One']);
      await replaceItems(api, production, sceneA, [
        item('itm_coalesce', one!.sourceId(), { x: 100, y: 200, w: 500, h: 281 }),
      ]);
      await regie.waitForConvergence(production.id);
      // Every PUT of an element takes 0-400 ms (random) before it reaches the server.
      await page.route('**/api/productions/*/scenes/*/items/itm_coalesce', async (route) => {
        if (route.request().method() === 'PUT') await sleep(Math.floor(Math.random() * 400));
        await route.fallback();
      });
      const puts = recordRequests(
        page,
        (path, method) => method === 'PUT' && path.endsWith('/items/itm_coalesce'),
      );
      const space = await canvasSpace(page);
      const start = centerOf(space, { x: 100, y: 200, w: 500, h: 281 });
      const gesture = new Gesture(page);
      await gesture.begin(start);
      const dragStarted = Date.now();
      const steps = 120;
      for (let step = 1; step <= steps; step++) {
        await page.mouse.move(
          start.x + (step / steps) * 520 * space.scale,
          start.y + (step / steps) * 300 * space.scale,
        );
        await sleep(16);
      }
      const dragMs = Date.now() - dragStarted;
      await gesture.end();
      const release = (await renderedItems(page, 'program')).find(
        (entry) => entry.id === 'itm_coalesce',
      )!;
      expect(release.x, 'the element followed the pointer').toBeGreaterThan(500);

      await expect
        .poll(async () => (await getScene(api, production, sceneA)).items[0]!.x, {
          message: 'the server reached the release position',
          timeout: 10_000,
        })
        .toBe(release.x);
      expect((await getScene(api, production, sceneA)).items[0]!.y).toBe(release.y);
      await expect
        .poll(() => puts.every((entry) => entry.endedAt !== null), { timeout: 10_000 })
        .toBe(true);

      const ordered = [...puts].sort((a, b) => a.startedAt - b.startedAt);
      for (let index = 1; index < ordered.length; index++)
        expect(
          ordered[index]!.startedAt,
          `PUT ${index} starts after PUT ${index - 1} ended`,
        ).toBeGreaterThanOrEqual(ordered[index - 1]!.endedAt! - 5);
      const minDuration = Math.max(
        1,
        Math.min(...ordered.map((entry) => entry.endedAt! - entry.startedAt)),
      );
      test.info().annotations.push({
        type: 'measurement',
        description: `${ordered.length} PUTs for a ${dragMs} ms drag (${steps} pointer moves), request duration ${minDuration}-${Math.max(...ordered.map((entry) => entry.endedAt! - entry.startedAt))} ms`,
      });
      expect(ordered.length).toBeGreaterThanOrEqual(2);
      expect(ordered.length, 'intermediate states are skipped').toBeLessThanOrEqual(
        Math.ceil(dragMs / minDuration) + 2,
      );
      expect(ordered.length, 'far fewer requests than pointer moves').toBeLessThan(steps);
      const xs = ordered.map((entry) => (entry.body as { x: number }).x);
      expect(xs, 'positions never go back').toEqual([...xs].sort((a, b) => a - b));
      expect(
        (ordered.at(-1)!.body as { x: number; y: number }).x,
        'the last request carries the release position',
      ).toBe(release.x);
      expect((ordered.at(-1)!.body as { y: number }).y).toBe(release.y);
      expect(ordered.at(-1)!.startedAt).toBeGreaterThan(dragStarted);
      expect(regie.problems.pageErrors).toEqual([]);
    },
  );

  test(
    'E2E-SCENE-19 [regie] live scene: Studio Mode with preview = program locks editing (banner, inert overlay, disabled controls, toast); without it a drag is live and the output follows',
    t.p1,
    async ({ regie, openOutput, api, production, pairContext }) => {
      await production.seed([...SCENES]);
      const [sceneA] = production.sceneIds as [string, string, string];
      const page = regie.page;
      const [one] = await phones(pairContext, ['Phone One']);
      await replaceItems(api, production, sceneA, [
        item('itm_live1', one!.sourceId(), { x: 200, y: 150, w: 600, h: 338 }),
      ]);
      await regie.waitForConvergence(production.id);
      const output = await openOutput(production);
      await output.stage();
      const outputItem = async () =>
        (await renderedItems(output.page, '#output')).find((entry) => entry.id === 'itm_live1');
      await expect.poll(async () => (await outputItem())?.x).toBe(200);

      // Studio Mode with the program scene in the preview: locked.
      await regie.setStudioMode(true);
      await regie.clickScene('Scene A');
      const preview = monitorOf(page, 'preview');
      await expect(preview.locator('.c-monitor__live-note')).toHaveText(
        'This scene is live right now. Editing is possible once another scene is on Program.',
      );
      await expect(overlayOf(page, 'preview')).toHaveClass(/is-locked/);
      await expect(
        inspector(page).getByRole('button', { name: 'Full screen', exact: true }),
      ).toBeDisabled();
      await expect(sourcesDock(page).getByRole('button', { name: /^Source$/ })).toBeVisible();
      const space = await canvasSpace(page, 'preview');
      await page.mouse.click(
        ...(Object.values(centerOf(space, { x: 200, y: 150, w: 600, h: 338 })) as [number, number]),
      );
      await expectToast(page, 'This scene is live. Switch another scene to Program first.');
      await page.keyboard.press('ArrowRight');
      await sleep(300);
      expect((await getScene(api, production, sceneA)).items[0]!.x, 'locked: nothing changed').toBe(
        200,
      );

      // Without Studio Mode the Program monitor edits live: “Changes go live immediately”, and the output follows the drag.
      await regie.setStudioMode(false);
      await expect(monitorOf(page, 'program').locator('.c-monitor__live-edit')).toHaveText(
        'Changes go live immediately',
      );
      const space2 = await canvasSpace(page, 'program');
      await page.mouse.click(
        ...(Object.values(centerOf(space2, { x: 200, y: 150, w: 600, h: 338 })) as [
          number,
          number,
        ]),
      );
      const gesture = new Gesture(page);
      await gesture.begin(centerOf(space2, { x: 200, y: 150, w: 600, h: 338 }));
      const releasedBefore = Date.now();
      await gesture.to(space2.client(500 + 300, 150 + 169 + 100), 20);
      await gesture.end();
      const released = Date.now();
      await expect
        .poll(async () => (await outputItem())?.x, {
          timeout: 3000,
          message: 'the output follows the drag',
        })
        .toBeGreaterThan(400);
      const reachedOutput = Date.now() - released;
      test.info().annotations.push({
        type: 'measurement',
        description: `output followed the release after ${reachedOutput} ms (drag took ${released - releasedBefore} ms)`,
      });
      expect(reachedOutput, 'T-SWITCH plus one request round trip').toBeLessThan(1500);
      expect(overlayBoxes).toBeDefined();
      expect(regie.problems.pageErrors).toEqual([]);
    },
  );
});
