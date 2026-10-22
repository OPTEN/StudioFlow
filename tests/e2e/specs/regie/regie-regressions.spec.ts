import { pairViaApi } from '../../support/ui/pairing';
import { t } from '../../support/tags';
import { expect, test } from '../../support/ui/fixtures';
import {
  COLOR,
  SCENES,
  addItems,
  expectScene,
  expectToast,
  getScene,
  inset,
  inspector,
  inspectorTitle,
  monitorOf,
  monitorPixels,
  overlayOf,
  renderedItems,
  sourcesDock,
  uploadSolid,
} from '../../support/regie/kit';

/**
 * Regression tests of the two GitHub issues found in the Regie.
 *
 *  - Issue #1, E2E-SCENE-25: with the camera added before the screen, applying «Bild-in-Bild» left the small picture
 *    behind the full-canvas one (the template did not re-order the elements). The item order is the z-order (spec 4.3), so
 *    the API order must put the full-canvas element first and the small picture must be visible in front on the Program
 *    monitor and on the output page (pixel check of the bottom-right region).
 *  - Issue #2, E2E-SCENE-26: after «Vollbild» the element fills the whole editable monitor, so the scene inspector with the
 *    templates could not be reached again (nothing on the monitor was left to click). The ways back: «Zur Szene», a second
 *    click on the selected source row, a click on the current scene, a click beside the monitor, Escape.
 */

test.use({ viewport: { width: 1440, height: 900 } });

test.describe('REGIE regressions', () => {
  test(
    'E2E-SCENE-25 [issue #1] camera added before the screen, then «Bild-in-Bild»: the API puts the full-canvas element first and the small camera picture is in front on the Program monitor and on the output',
    t.p0,
    async ({ regie, openPhone, openLaptop, openOutput, api, production, pairContext }) => {
      test.setTimeout(180_000);
      await production.seed([...SCENES]);
      const sceneA = production.sceneIds[0]!;
      const page = regie.page;

      // A webcam with a moving gradient (never red) and a laptop screen that is flat red (S1, #e5484d).
      const phone = await openPhone({ profile: 'desktop', camera: 'stamp' });
      const camera = await pairViaApi(pairContext, phone, { name: 'Kamera Eins' });
      await phone.waitForCamera('live');
      const laptop = await openLaptop();
      const screen = await pairViaApi(pairContext, laptop, { name: 'Laptop Lea' });
      await laptop.shareScreen();
      await laptop.waitForSlot('screen-1', 'live');
      expect(camera.codes['camera']).toBe('K1');
      expect(screen.codes['screen-1']).toBe('S1');
      await regie.waitForConvergence(production.id);

      // Camera first, then the screen: the order that put the camera behind the screen.
      const add = async (code: string) => {
        await sourcesDock(page)
          .getByRole('button', { name: /^Quelle$/ })
          .click();
        await page
          .getByRole('menu', { name: 'Quelle hinzufügen' })
          .getByRole('menuitem', { name: new RegExp(code) })
          .click();
        await expectToast(page, `${code} in «Szene A» eingefügt`);
      };
      await add('K1');
      await expectScene(
        api,
        production,
        sceneA,
        (scene) => scene.items.length === 1,
        'the camera is in the scene',
      );
      await add('S1');
      const before = await expectScene(
        api,
        production,
        sceneA,
        (scene) => scene.items.length === 2,
        'the screen is in the scene',
      );
      expect(
        before.items.map((entry) => entry.source),
        'camera first, screen second',
      ).toEqual([camera.sourceId(), screen.sourceId()]);

      await page.keyboard.press('Escape'); // the new element is selected: back to the scene view
      await expect(inspectorTitle(page)).toHaveText('Szene');
      await inspector(page).getByRole('button', { name: 'Bild-in-Bild', exact: true }).click();
      await expectToast(page, 'Vorlage «Bild-in-Bild» angewendet');

      // API: the full-canvas element (the screen) is first, the small picture (the camera) last.
      const after = await expectScene(
        api,
        production,
        sceneA,
        (scene) => scene.items[0]?.source === screen.sourceId(),
        'the screen is first',
      );
      expect(after.items.map((entry) => entry.source)).toEqual([
        screen.sourceId(),
        camera.sourceId(),
      ]);
      expect(after.items.map((entry) => [entry.x, entry.y, entry.w, entry.h])).toEqual([
        [0, 0, 1920, 1080],
        [1400, 772, 480, 270],
      ]);

      // Program monitor: DOM order (z-index) and pixels. The camera rectangle must not show the red screen (#e5484d; the
      // camera is a gradient whose brightest red is rgb(173,31,31), far outside the tolerance of 40).
      await expect
        .poll(async () => (await renderedItems(page, 'program')).map((entry) => entry.z), {
          message: 'z-index = array position',
        })
        .toEqual([0, 1]);
      const RED = '#e5484d';
      const screenArea = { x: 100, y: 700, width: 400, height: 60 }; // screen only, clear of the moving white box (y from 842)
      const pipArea = inset({ x: 1400, y: 772, w: 480, h: 270 }, 24); // inside the camera rectangle, clear of the rounded corners
      await expect
        .poll(async () => (await monitorPixels(page)).share(RED, screenArea, 40), {
          message: 'the Program monitor plays the screen share (red)',
          timeout: 45_000,
        })
        .toBeGreaterThan(0.85);
      await expect
        .poll(async () => (await monitorPixels(page)).share(RED, pipArea, 40), {
          message:
            'the bottom-right region of the Program monitor shows the camera, not the screen',
          timeout: 45_000,
        })
        .toBeLessThan(0.1);
      const monitor = await monitorPixels(page);
      const mean = monitor.mean(pipArea);
      expect(
        Math.abs(mean[0] - 229) + Math.abs(mean[1] - 72) + Math.abs(mean[2] - 77),
        'the mean colour of the region differs from the screen colour',
      ).toBeGreaterThan(40);

      // Output page: the same pictures, the same order.
      expect((await api.startBroadcast(production.id)).status).toBe(200);
      const output = await openOutput(production);
      await output.waitForPlayingVideos(2, { timeout: 45_000 });
      const outputShare = async (area: { x: number; y: number; width: number; height: number }) => {
        const stage = await output.stagePixels();
        return stage.image.shareOfColor(
          RED,
          {
            x: area.x * stage.scale,
            y: area.y * stage.scale,
            width: area.width * stage.scale,
            height: area.height * stage.scale,
          },
          40,
        );
      };
      await expect
        .poll(() => outputShare(screenArea), {
          message: 'the output plays the screen share',
          timeout: 45_000,
        })
        .toBeGreaterThan(0.85);
      await expect
        .poll(() => outputShare(pipArea), {
          message: 'the bottom-right region of the output shows the camera, not the screen',
          timeout: 30_000,
        })
        .toBeLessThan(0.1);
      const outputItems = await renderedItems(output.page, '#output');
      expect(
        outputItems.map((entry) => entry.id),
        'the output draws the two elements in the API order',
      ).toEqual(after.items.map((entry) => entry.id));
      expect(outputItems.map((entry) => entry.z)).toEqual([0, 1]);
      expect(regie.problems.pageErrors).toEqual([]);
    },
  );

  test(
    'E2E-SCENE-26 [issue #2] «Vollbild» fills the editable monitor: «Zur Szene», a second click on the source row, a click on the current scene, a click beside the monitor and Escape all lead back to the scene inspector with the templates',
    t.p0,
    async ({ regie, api, production }) => {
      await production.seed([...SCENES]);
      const sceneA = production.sceneIds[0]!;
      const page = regie.page;
      const image = await uploadSolid(api, production, 'Logo', COLOR.violet);
      await addItems(api, production, sceneA, [image.id]);
      await regie.waitForConvergence(production.id);

      // «Vollbild»: the element covers the whole editable screen (nothing is left to click on the monitor).
      await inspector(page).getByRole('button', { name: 'Vollbild', exact: true }).click();
      await expectScene(
        api,
        production,
        sceneA,
        (scene) => scene.items[0]!.w === 1920 && scene.items[0]!.h === 1080,
        'the element is full canvas',
      );
      const row = sourcesDock(page).getByRole('button', { name: /^Auswählen: M\d Logo/ });
      const overlay = overlayOf(page, 'program');

      const toSceneInspector = async (way: string) => {
        await expect(inspectorTitle(page), `${way}: the inspector shows the scene`).toHaveText(
          'Szene',
          { timeout: 3000 },
        );
        await expect(
          inspector(page)
            .getByRole('button', { name: 'Vorlage anwenden' })
            .or(inspector(page).getByText('Vorlage anwenden')),
          `${way}: «Vorlage anwenden»`,
        ).toBeVisible();
        await expect(
          inspector(page).getByRole('button', { name: 'Nebeneinander', exact: true }),
          `${way}: the templates are there`,
        ).toBeEnabled();
      };
      const selectElement = async () => {
        // The element fills the monitor: a click anywhere on the editable screen selects it.
        const box = (await overlay.boundingBox())!;
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        await expect(inspectorTitle(page)).toHaveText('Element');
        await expect(row).toHaveAttribute('aria-pressed', 'true');
      };

      // 1. «Zur Szene» in the dock header.
      await selectElement();
      await inspector(page)
        .getByRole('button', { name: 'Auswahl aufheben, zurück zur Szene' })
        .click();
      await toSceneInspector('«Zur Szene»');
      await expect(
        inspector(page).getByRole('button', { name: 'Auswahl aufheben, zurück zur Szene' }),
      ).toHaveCount(0);

      // 2. A second click on the selected source row.
      await selectElement();
      await row.click();
      await toSceneInspector('second click on the source row');

      // 3. A click on the current scene in Szenen.
      await selectElement();
      await regie.scene('Szene A').click();
      await toSceneInspector('click on the current scene');
      await expect(regie.scene('Szene A'), 'still the live scene').toHaveAttribute(
        'aria-pressed',
        'true',
      );

      // 4. A click beside the monitor (the free stage area, here the quiet «Preview aus» space and the monitor header).
      await selectElement();
      const preview = page.locator('.c-stage__preview-off');
      await expect(preview).toBeVisible();
      await preview.click();
      await toSceneInspector('click beside the monitor (Preview aus space)');
      await selectElement();
      await monitorOf(page, 'program').locator('.c-monitor__head').click();
      await toSceneInspector('click on the monitor header');

      // 5. Escape.
      await selectElement();
      await page.keyboard.press('Escape');
      await toSceneInspector('Escape');

      // And from there the templates work again: «Nebeneinander» applies.
      await inspector(page).getByRole('button', { name: 'Nebeneinander', exact: true }).click();
      await expectToast(page, 'Vorlage «Nebeneinander» angewendet');
      const scene = await getScene(api, production, sceneA);
      expect([scene.items[0]!.x, scene.items[0]!.y, scene.items[0]!.w, scene.items[0]!.h]).toEqual([
        40, 287, 900, 506,
      ]);
      expect(regie.problems.pageErrors).toEqual([]);
    },
  );
});
