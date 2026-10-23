import { LIMITS } from '../../support/constants';
import { pairLaptopByLink, pairPhone } from '../../support/production';
import { t } from '../../support/tags';
import { expect, test } from '../../support/ui/fixtures';
import {
  SCENES,
  COLOR,
  addItems,
  expectScene,
  getScene,
  inspector,
  inspectorSub,
  inspectorTitle,
  monitorOf,
  recordRequests,
  renderedItems,
  scenesDock,
  sourceRow,
  sourcesDock,
  toastOf,
  uploadSolid,
} from '../../support/regie/kit';

/**
 * SCENE (scenes list and sources) in the Regie UI: rename, create, duplicate, delete, add a source, reorder, missing
 * source, thumbnails and inspector context, limits (docs/testing.md 2.3: E2E-SCENE-01 ... 04, 20 ... 23). The sources are
 * REST-paired devices (K1, S1: offline, no media needed) and flat-colour images (M1 ...), so codes and pixels are known.
 */

test.use({ viewport: { width: 1440, height: 900 } });

const sceneNames = async (
  api: { getSnapshot: (id: string) => Promise<{ body: { scenes: Array<{ name: string }> } }> },
  id: string,
) => (await api.getSnapshot(id)).body.scenes.map((scene) => scene.name);

test.describe('REGIE scenes', () => {
  test(
    'E2E-SCENE-01 [regie] rename through the inspector and the row menu: row, monitor header, thumbnail and API follow; invalid names are not saved',
    t.p1,
    async ({ regie, api, production }) => {
      await production.seed([...SCENES]);
      const [sceneA] = production.sceneIds;
      const page = regie.page;
      await expect(regie.scene('Szene A')).toBeVisible();
      await expect(inspectorTitle(page)).toHaveText('Szene');

      const name = page.locator('#sf-insp-name');
      await expect(name).toHaveValue('Szene A');
      await name.fill('Moderation');
      await name.blur();
      // Within 1 s: row, Program monitor header, thumbnail label and API.
      await expect(regie.scene('Moderation')).toBeVisible({ timeout: 1500 });
      await expect(monitorOf(page, 'program').locator('.c-monitor__name')).toHaveText(
        'Moderation',
        { timeout: 1500 },
      );
      await expect(scenesDock(page).locator('.sf-r-stage[aria-label="Moderation"]')).toHaveCount(
        1,
        { timeout: 1500 },
      );
      await expectScene(
        api,
        production,
        sceneA!,
        (scene) => scene.name === 'Moderation',
        'the API has the new name',
        1500,
      );
      await expect(inspectorSub(page)).toHaveText('Moderation');

      await page.reload();
      await regie.waitReady();
      await expect(regie.scene('Moderation')).toBeVisible();

      // Invalid names are never sent: empty and whitespace only.
      const requests = recordRequests(
        page,
        (path, method) => method === 'PATCH' && /\/scenes\//.test(path),
      );
      for (const bad of ['', '   ']) {
        await name.fill(bad);
        await name.blur();
        await expect(
          name,
          `the field shows the current name again after «${bad.slice(0, 10)}»`,
        ).toHaveValue('Moderation');
      }
      expect(requests, 'no request for an invalid name').toHaveLength(0);
      // 81 characters: the field has maxlength 80, so the text is cut (never 81 saved), typed or pasted.
      await name.fill('x'.repeat(81));
      await expect(name).toHaveValue('x'.repeat(80));
      await name.fill('');
      await name.pressSequentially('y'.repeat(85));
      await name.blur();
      await expectScene(
        api,
        production,
        sceneA!,
        (scene) => scene.name.length === 80,
        'a typed name is cut to 80 characters',
      );
      expect((await getScene(api, production, sceneA!)).name).toBe('y'.repeat(80));

      // The row menu «Umbenennen» (F2) edits the name in place: Enter saves, Escape cancels.
      await page.getByRole('button', { name: /^Aktionen für Szene y+/ }).click();
      await page.getByRole('menuitem', { name: /Umbenennen/ }).click();
      const inline = page.getByRole('textbox', { name: 'Name der Szene' });
      await expect(inline).toBeFocused();
      await inline.fill('Gespräch');
      await inline.press('Enter');
      await expect(regie.scene('Gespräch')).toBeVisible();
      await regie.scene('Gespräch').focus();
      await page.keyboard.press('F2');
      await expect(inline).toBeFocused();
      await inline.fill('Verworfen');
      await inline.press('Escape');
      await expect(regie.scene('Gespräch')).toBeVisible();
      expect((await getScene(api, production, sceneA!)).name).toBe('Gespräch');
      expect(regie.problems.pageErrors).toEqual([]);
    },
  );

  test(
    'E2E-SCENE-02 [regie] «+ Szene» appends «Neue Szene N» and opens its name; «Duplizieren» copies items with new ids; the second operator sees both; at 99 scenes the controls are disabled',
    t.p1,
    async ({ regie, openRegie, api, production }) => {
      await production.seed([...SCENES]);
      const page = regie.page;
      const m = await Promise.all([
        uploadSolid(api, production, 'Rot', COLOR.red),
        uploadSolid(api, production, 'Gruen', COLOR.green),
        uploadSolid(api, production, 'Blau', COLOR.blue),
      ]);
      const sceneA = production.sceneIds[0]!;
      await addItems(
        api,
        production,
        sceneA,
        m.map((asset) => asset.id),
        { x: 100, y: 100, w: 500, h: 281, radius: 6 },
      );
      const operatorB = await openRegie();
      await expect(operatorB.scene('Szene A')).toBeVisible();

      // Create: appended with a default name, its name field is open and selected.
      await page.getByRole('button', { name: 'Szene hinzufügen' }).click();
      await expect(toastOf(page)).toContainText('Szene «Neue Szene 4» erstellt');
      const inline = page.getByRole('textbox', { name: 'Name der Szene' });
      await expect(inline).toBeFocused();
      await expect(inline).toHaveValue('Neue Szene 4');
      await inline.fill('Gäste');
      await inline.press('Enter');
      await expect(regie.scene('Gäste')).toBeVisible();
      await expect(
        operatorB.scene('Gäste'),
        'the other operator sees the new scene within 1 s',
      ).toBeVisible({ timeout: 1500 });
      expect(await sceneNames(api, production.id)).toEqual([
        'Szene A',
        'Szene B',
        'Szene C',
        'Gäste',
      ]);

      // Duplicate «Szene A» (three items): «Szene A (Kopie)», same items, new item ids, appended at the end.
      await page.getByRole('button', { name: 'Aktionen für Szene Szene A' }).click();
      await page.getByRole('menuitem', { name: 'Duplizieren' }).click();
      await expect(toastOf(page)).toContainText('Szene «Szene A (Kopie)» erstellt');
      await expect(regie.scene('Szene A (Kopie)')).toBeVisible();
      await expect(operatorB.scene('Szene A (Kopie)')).toBeVisible({ timeout: 1500 });
      const scenes = (await api.getSnapshot(production.id)).body.scenes;
      expect(scenes.map((scene) => scene.name)).toEqual([
        'Szene A',
        'Szene B',
        'Szene C',
        'Gäste',
        'Szene A (Kopie)',
      ]);
      const [original, , , , copy] = scenes;
      expect(copy!.items.map((entry) => ({ ...entry, id: '' }))).toEqual(
        original!.items.map((entry) => ({ ...entry, id: '' })),
      );
      const originalIds = new Set(original!.items.map((entry) => entry.id));
      expect(
        copy!.items.every((entry) => !originalIds.has(entry.id)),
        'the copy has item ids of its own',
      ).toBe(true);
      // Editable independently.
      await api.updateSceneItem(production.id, copy!.id, copy!.items[0]!.id, {
        ...copy!.items[0]!,
        x: 777,
      });
      expect(
        (await getScene(api, production, original!.id)).items[0]!.x,
        'the original keeps its geometry',
      ).toBe(100);

      // 99 scenes: the controls are disabled (the API answers 409 limit_reached for the 100th).
      const missing = LIMITS.scenes - scenes.length;
      for (let index = 0; index < missing; index++) {
        const created = await api.createScene(production.id, {
          name: `Fuell ${index + 1}`,
          cloneFromSceneId: null,
        });
        expect(created.status, created.raw.text()).toBe(201);
      }
      // The Regie follows the 94 new scenes live: «+ Szene» is already disabled, and stays so after a reload.
      await expect(page.getByRole('button', { name: 'Szene hinzufügen' })).toBeDisabled();
      await page.reload();
      await regie.waitReady();
      await expect(page.getByRole('button', { name: 'Szene hinzufügen' })).toBeDisabled();
      await expect(page.getByRole('button', { name: 'Szene hinzufügen' })).toHaveAttribute(
        'title',
        'Höchstens 99 Szenen',
      );
      await page.getByRole('button', { name: 'Aktionen für Szene Szene A', exact: true }).click();
      await expect(page.getByRole('menuitem', { name: 'Duplizieren' })).toBeDisabled();
      await page.keyboard.press('Escape');
      const over = await api.createScene(production.id, { name: 'Nr 100', cloneFromSceneId: null });
      expect(over.status).toBe(409);
      expect(over.body.code).toBe('limit_reached');
      expect(regie.problems.pageErrors).toEqual([]);
    },
  );

  test(
    'E2E-SCENE-03 [regie] delete a scene in Studio-Modus: confirmation, «Abbrechen» keeps it, keys re-map; the live scene cannot be deleted',
    t.smoke,
    async ({ regie, openRegie, api, production }) => {
      await production.seed([...SCENES]);
      const [sceneA, sceneB, sceneC] = production.sceneIds as [string, string, string];
      const page = regie.page;
      const operatorB = await openRegie();
      await expect(operatorB.scene('Szene B')).toBeVisible();

      // The inspector edits the preview scene in Studio-Modus: «Szene B» (the scene after the program).
      await regie.setStudioMode(true);
      await expect(toastOf(page)).toContainText('Studio-Modus an: Preview und Take');
      await expect(inspectorSub(page)).toHaveText('Szene B');
      await inspector(page).getByRole('button', { name: 'Szene löschen' }).click();
      const confirm = inspector(page).getByRole('group', { name: 'Szene löschen' });
      await expect(confirm).toContainText(
        '«Szene B» wird gelöscht. Das lässt sich nicht rückgängig machen.',
      );
      await confirm.getByRole('button', { name: 'Abbrechen' }).click();
      await expect(confirm).toBeHidden();
      expect(await sceneNames(api, production.id), '«Abbrechen» keeps the scene').toEqual([
        'Szene A',
        'Szene B',
        'Szene C',
      ]);

      await inspector(page).getByRole('button', { name: 'Szene löschen' }).click();
      await inspector(page)
        .getByRole('group', { name: 'Szene löschen' })
        .getByRole('button', { name: 'Szene löschen' })
        .click();
      await expect(toastOf(page)).toContainText('Szene «Szene B» gelöscht');
      await expect(regie.scene('Szene B')).toHaveCount(0);
      await expect(operatorB.scene('Szene B'), 'gone for the other operator').toHaveCount(0, {
        timeout: 1500,
      });
      expect(await sceneNames(api, production.id)).toEqual(['Szene A', 'Szene C']);
      await expect(regie.statusLine()).toContainText('Szene «Szene B» gelöscht');
      // The preview moved to the neighbour before the delete (prototype), so it never points at a vanished scene.
      const snapshot = (await api.getSnapshot(production.id)).body;
      expect(snapshot.production.previewSceneId).toBe(sceneC);
      expect(snapshot.production.programSceneId).toBe(sceneA);
      // Keys 1-9 follow the new order: in Studio-Modus they set the preview.
      await page.keyboard.press('1');
      await expect(regie.scene('Szene A')).toHaveAttribute('aria-pressed', 'true');
      await page.keyboard.press('2');
      await expect(regie.scene('Szene C')).toHaveAttribute('aria-pressed', 'true');
      await expect(regie.scene('Szene C')).toHaveAccessibleName(/^Szene C, in der Preview$/);
      expect(sceneB).toBeTruthy();

      // The live scene: Studio-Modus on with preview = program (locked): hint, disabled button; REST says 409.
      await regie.clickScene('Szene A');
      await expect(inspector(page).getByRole('button', { name: 'Szene löschen' })).toBeDisabled();
      await expect(inspector(page)).toContainText('Die Live-Szene lässt sich nicht löschen.');
      await expect(inspector(page)).not.toContainText('Andere Szenen im Studio-Modus bearbeiten');
      // Studio-Modus off: the inspector shows the program scene, the hint says how to edit another one.
      await regie.setStudioMode(false);
      await expect(inspector(page).getByRole('button', { name: 'Szene löschen' })).toBeDisabled();
      await expect(inspector(page)).toContainText(
        'Die Live-Szene lässt sich nicht löschen. Andere Szenen im Studio-Modus bearbeiten.',
      );
      const refused = await api.deleteScene(production.id, sceneA);
      expect(refused.status).toBe(409);
      expect(refused.body.code).toBe('scene_is_live');
      expect(await sceneNames(api, production.id)).toEqual(['Szene A', 'Szene C']);
      expect(regie.problems.pageErrors).toEqual([]);
    },
  );

  test(
    'E2E-SCENE-04 [regie] «+ Quelle»: only sources that are not in the scene and not blocked; defaults 1240/680 600x338 radius 12, selected, toast; empty menu text; empty scene text',
    t.smoke,
    async ({ regie, api, production, pairContext }) => {
      await production.seed([...SCENES]);
      const sceneA = production.sceneIds[0]!;
      const page = regie.page;
      const phone = await pairPhone(pairContext, { name: 'Handy Eins' });
      const blockedPhone = await pairPhone(pairContext, { name: 'Handy Gesperrt' });
      const laptop = await pairLaptopByLink(pairContext, { name: 'Laptop Lea' });
      const image = await uploadSolid(api, production, 'Logo', COLOR.violet);
      expect((await api.blockDevice(production.id, blockedPhone.id)).status).toBe(200);
      await regie.waitForConvergence(production.id);
      expect(phone.codes['camera']).toBe('K1');
      expect(blockedPhone.codes['camera']).toBe('K2');
      expect(laptop.codes['screen-1']).toBe('S1');

      await expect(sourcesDock(page)).toContainText('Diese Szene ist leer.');
      await expect(sourcesDock(page)).toContainText(
        'Füge eine Quelle hinzu oder wende eine Vorlage an.',
      );

      const add = async (code: string) => {
        await sourcesDock(page)
          .getByRole('button', { name: /^Quelle$/ })
          .click();
        const menu = page.getByRole('menu', { name: 'Quelle hinzufügen' });
        await expect(menu).toContainText('Zu «Szene A» hinzufügen');
        return menu;
      };
      const menu = await add('K1');
      const entries = await menu.getByRole('menuitem').allTextContents();
      const codes = entries.map((text) => /^\s*([KSM]\d)/.exec(text)?.[1]).filter(Boolean);
      expect(
        codes,
        'only sources that are not in the scene and not blocked (K2 is blocked), cameras, screens, media',
      ).toEqual(['K1', 'S1', 'M1']);
      expect(menu.getByRole('group', { name: 'Kameras' })).toBeVisible();
      await menu.getByRole('menuitem', { name: /K1/ }).click();
      await expect(toastOf(page)).toContainText('K1 in «Szene A» eingefügt');
      let scene = await expectScene(
        api,
        production,
        sceneA,
        (entry) => entry.items.length === 1,
        'K1 is in the scene',
      );
      expect(scene.items[0]).toMatchObject({
        source: phone.sourceId(),
        x: 1240,
        y: 680,
        w: 600,
        h: 338,
        radius: 12,
        fit: 'cover',
        rotation: 0,
        hidden: false,
        locked: false,
      });
      expect(scene.items[0]!.crop).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
      expect(scene.items[0]!.onLost).toEqual({ holdMs: 3000, fallbackSource: null });
      // The new element is selected: Quellen row pressed, inspector «Element» with «K1 · Handy Eins».
      await expect(sourceRow(page, 'K1 Handy Eins')).toHaveAttribute('aria-pressed', 'true');
      await expect(inspectorTitle(page)).toHaveText('Element');
      await expect(inspectorSub(page)).toHaveText('K1 · Handy Eins');

      // The menu no longer lists K1; the screen gets «contain».
      const menu2 = await add('S1');
      expect(
        (await menu2.getByRole('menuitem').allTextContents()).some((text) => /K1/.test(text)),
      ).toBe(false);
      await menu2.getByRole('menuitem', { name: /S1/ }).click();
      await expect(toastOf(page)).toContainText('S1 in «Szene A» eingefügt');
      scene = await expectScene(
        api,
        production,
        sceneA,
        (entry) => entry.items.length === 2,
        'S1 is in the scene',
      );
      expect(scene.items[1]).toMatchObject({
        source: laptop.sourceId(),
        x: 1240,
        y: 680,
        w: 600,
        h: 338,
        radius: 12,
        fit: 'contain',
      });

      const menu3 = await add('M1');
      await menu3.getByRole('menuitem', { name: /M1/ }).click();
      await expect(toastOf(page)).toContainText('M1 in «Szene A» eingefügt');
      scene = await expectScene(
        api,
        production,
        sceneA,
        (entry) => entry.items.length === 3,
        'M1 is in the scene',
      );
      expect(scene.items[2]).toMatchObject({
        source: image.id,
        x: 1240,
        y: 680,
        w: 600,
        h: 338,
        radius: 12,
        fit: 'cover',
      });

      // Everything is in: the empty-menu text (K2 stays out because it is blocked).
      await sourcesDock(page)
        .getByRole('button', { name: /^Quelle$/ })
        .click();
      const full = page.getByRole('menu', { name: 'Quelle hinzufügen' });
      await expect(full).toContainText('Alle Quellen sind schon in dieser Szene.');
      await expect(full.getByRole('menuitem', { name: /K2/ })).toHaveCount(0);
      await page.keyboard.press('Escape');
      await expect(full).toBeHidden();
      expect(regie.problems.pageErrors).toEqual([]);
    },
  );

  test(
    'E2E-SCENE-20 [regie] limits: the 33rd element and the 100th scene are refused with a message; an element may sit partly outside the canvas',
    t.p2,
    async ({ regie, api, production }) => {
      await production.seed([...SCENES]);
      const sceneA = production.sceneIds[0]!;
      const page = regie.page;
      const first = await uploadSolid(api, production, 'Eins', COLOR.red);
      const second = await uploadSolid(api, production, 'Zwei', COLOR.green);
      await addItems(api, production, sceneA, Array(LIMITS.itemsPerScene).fill(first.id), {
        x: 0,
        y: 0,
        w: 200,
        h: 112,
      });
      expect((await getScene(api, production, sceneA)).items).toHaveLength(32);
      const over = await api.addSceneItem(production.id, sceneA, { source: second.id });
      expect(over.status).toBe(409);
      expect(over.body.code).toBe('limit_reached');
      await regie.waitForConvergence(production.id);
      await expect(sourcesDock(page).locator('.c-dock-frame__count')).toHaveText('32');

      await sourcesDock(page)
        .getByRole('button', { name: /^Quelle$/ })
        .click();
      await page.getByRole('menuitem', { name: /M2/ }).click();
      await expect(toastOf(page)).toContainText(/höchstens 32 Elemente/);
      expect((await getScene(api, production, sceneA)).items, 'no 33rd element').toHaveLength(32);

      // Partly outside the canvas is allowed (the stage clips it): the element is rendered and no error occurs.
      const items = (await getScene(api, production, sceneA)).items;
      expect(
        (
          await api.updateSceneItem(production.id, sceneA, items[0]!.id, {
            ...items[0]!,
            x: 1800,
            y: 1000,
            w: 600,
            h: 338,
          })
        ).status,
      ).toBe(200);
      await expect
        .poll(
          async () =>
            (await renderedItems(page, 'program')).find((entry) => entry.id === items[0]!.id)?.x,
        )
        .toBe(1800);
      expect(regie.problems.pageErrors).toEqual([]);
    },
  );

  test(
    'E2E-SCENE-21 [regie] reorder: row menu and Alt+Arrow keys; API order, the other operator, key 1 and a reload follow',
    t.p1,
    async ({ regie, openRegie, api, production }) => {
      await production.seed([...SCENES]);
      const [sceneA, sceneB, sceneC] = production.sceneIds as [string, string, string];
      const page = regie.page;
      const operatorB = await openRegie();
      const order = async () =>
        (await api.getSnapshot(production.id)).body.scenes.map((scene) => scene.name);
      const rows = (target: typeof page) =>
        target.locator('.c-scenes-dock__list .c-scene .c-scene__name').allTextContents();

      // Via the menu: «Szene C» up, twice.
      await page.getByRole('button', { name: 'Aktionen für Szene Szene C' }).click();
      await expect(page.getByRole('menuitem', { name: /Nach unten/ })).toBeDisabled();
      await page.getByRole('menuitem', { name: /Nach oben/ }).click();
      await expect.poll(order).toEqual(['Szene A', 'Szene C', 'Szene B']);
      await page.getByRole('button', { name: 'Aktionen für Szene Szene C' }).click();
      await page.getByRole('menuitem', { name: /Nach oben/ }).click();
      await expect.poll(order).toEqual(['Szene C', 'Szene A', 'Szene B']);
      await expect
        .poll(() => rows(operatorB.page), {
          message: "the other operator's list reorders",
          timeout: 3000,
        })
        .toEqual(['Szene C', 'Szene A', 'Szene B']);
      const snapshot = (await api.getSnapshot(production.id)).body;
      expect(snapshot.scenes.map((scene) => scene.sortOrder)).toEqual([0, 1, 2]);
      expect(snapshot.scenes.map((scene) => scene.id)).toEqual([sceneC, sceneA, sceneB]);

      // Alt+ArrowDown on the focused row moves it down; Alt+ArrowUp back.
      await regie.scene('Szene C').focus();
      await page.keyboard.press('Alt+ArrowDown');
      await expect.poll(order).toEqual(['Szene A', 'Szene C', 'Szene B']);
      await expect(regie.scene('Szene C'), 'the row keeps the focus after it moved').toBeFocused();
      await page.keyboard.press('Alt+ArrowUp');
      await expect.poll(order).toEqual(['Szene C', 'Szene A', 'Szene B']);
      await page.keyboard.press('Alt+ArrowUp');
      expect(await order(), 'the first scene cannot move up').toEqual([
        'Szene C',
        'Szene A',
        'Szene B',
      ]);

      // Key 1 now selects the new first scene (direct mode: it goes live); a reload keeps the order.
      await page.locator('body').click({ position: { x: 5, y: 5 } });
      await page.keyboard.press('1');
      await expect(regie.scene('Szene C')).toHaveAttribute('aria-pressed', 'true');
      await expect
        .poll(async () => (await api.getSnapshot(production.id)).body.production.programSceneId)
        .toBe(sceneC);
      await page.reload();
      await regie.waitReady();
      expect(await rows(page)).toEqual(['Szene C', 'Szene A', 'Szene B']);
      expect(regie.problems.pageErrors).toEqual([]);
    },
  );

  test(
    'E2E-SCENE-22 [regie] missing source: the element stays as a dark placeholder with «Quelle fehlt» in the Regie, without text on the output; the row is selectable and removable',
    t.p1,
    async ({ regie, openOutput, api, production, pairContext }) => {
      await production.seed([...SCENES]);
      const sceneA = production.sceneIds[0]!;
      const page = regie.page;
      const phone = await pairPhone(pairContext, { name: 'Handy Eins' });
      const laptop = await pairLaptopByLink(pairContext, { name: 'Laptop Lea' });
      const scene = await addItems(api, production, sceneA, [laptop.sourceId(), phone.sourceId()], {
        x: 100,
        y: 100,
        w: 600,
        h: 338,
        radius: 0,
      });
      const [laptopItem, phoneItem] = scene.items;
      await regie.waitForConvergence(production.id);
      const output = await openOutput(production);
      await output.stage();

      expect((await api.deleteDevice(production.id, laptop.id)).status).toBe(204);
      await regie.waitForConvergence(production.id);

      // Program monitor: the item is still drawn, as the dark placeholder (#121821) with the label «Quelle fehlt».
      await expect.poll(async () => (await renderedItems(page, 'program')).length).toBe(2);
      const monitorItem = monitorOf(page, 'program').locator(
        `.sf-r-item[data-item-id="${laptopItem!.id}"]`,
      );
      await expect(monitorItem).toContainText('Quelle fehlt');
      expect(
        await monitorItem.evaluate((element) => getComputedStyle(element).backgroundColor),
      ).toBe('rgb(18, 24, 33)');
      await expect(
        monitorOf(page, 'program').locator(
          `.c-edit-box[data-item-id="${laptopItem!.id}"] .c-edit-box__label`,
        ),
      ).toContainText('Quelle fehlt');
      // The thumbnail of the scene row draws it as well.
      expect(
        (await renderedItems(page, '.c-scenes-dock__list > sf-scene-row:nth-child(1)')).some(
          (entry) => entry.id === laptopItem!.id,
        ),
      ).toBe(true);

      // The output shows the dark placeholder and no text.
      await expect
        .poll(
          async () =>
            (await renderedItems(output.page, '#output')).find(
              (entry) => entry.id === laptopItem!.id,
            )?.visible,
        )
        .toBe(true);
      const outputItem = (await renderedItems(output.page, '#output')).find(
        (entry) => entry.id === laptopItem!.id,
      )!;
      expect(outputItem.text, 'the output shows no «Quelle fehlt»').toBe('');
      expect(
        await output.page
          .locator(`.sf-r-item[data-item-id="${laptopItem!.id}"]`)
          .evaluate((element) => getComputedStyle(element).backgroundColor),
      ).toBe('rgb(18, 24, 33)');

      // The Quellen row is selectable and removable.
      const row = sourcesDock(page).getByRole('button', { name: 'Auswählen: – Quelle fehlt' });
      await row.click();
      await expect(row).toHaveAttribute('aria-pressed', 'true');
      await expect(inspectorSub(page)).toHaveText('Quelle fehlt');
      await inspector(page).getByRole('button', { name: 'Aus Szene entfernen' }).click();
      await expect(toastOf(page)).toContainText('aus «Szene A» entfernt');
      await expectScene(
        api,
        production,
        sceneA,
        (entry) => entry.items.length === 1 && entry.items[0]!.id === phoneItem!.id,
        'only the phone item is left',
      );
      expect(regie.problems.pageErrors).toEqual([]);
      expect(
        regie.problems.consoleErrors.filter((text) => !/Failed to load resource/.test(text)),
      ).toEqual([]);
    },
  );

  test(
    'E2E-SCENE-24 [regie] scene background: the colour field and the image list of the inspector reach the API and the output; the server rejects an invalid colour',
    t.p2,
    async ({ regie, openOutput, api, production }) => {
      await production.seed([...SCENES]);
      const sceneA = production.sceneIds[0]!;
      const page = regie.page;
      const image = await uploadSolid(api, production, 'Hintergrund', COLOR.violet);
      await api.startBroadcast(production.id);
      const output = await openOutput(production);
      await output.stage();
      await regie.waitForConvergence(production.id);
      const share = async (color: string) => {
        const stage = await output.stagePixels();
        return stage.image.shareOfColor(
          color,
          { x: 0, y: 0, width: stage.image.width, height: stage.image.height },
          10,
        );
      };

      await inspector(page).getByLabel('Hintergrundfarbe').fill('#102030');
      await expectScene(
        api,
        production,
        sceneA,
        (scene) => scene.background.color.toLowerCase() === '#102030',
        'the colour is saved',
      );
      await expect
        .poll(() => share('#102030'), { message: 'the output shows the colour', timeout: 8000 })
        .toBeGreaterThan(0.95);
      await inspector(page)
        .getByLabel('Hintergrundbild')
        .selectOption({ label: `${image.code} · Hintergrund` });
      await expectScene(
        api,
        production,
        sceneA,
        (scene) => scene.background.assetId === image.id,
        'the image is saved',
      );
      await expect
        .poll(() => share('#9650c8'), { message: 'the image covers the colour', timeout: 8000 })
        .toBeGreaterThan(0.9);
      await inspector(page).getByLabel('Hintergrundbild').selectOption({ label: 'Kein Bild' });
      await expectScene(
        api,
        production,
        sceneA,
        (scene) => scene.background.assetId === null,
        'no image again',
      );
      await expect.poll(() => share('#102030'), { timeout: 8000 }).toBeGreaterThan(0.95);

      const invalid = await api.updateScene(production.id, sceneA, {
        background: { color: 'red', assetId: null },
      });
      expect(invalid.status).toBe(400);
      expect(invalid.body.code).toBe('validation_failed');
      expect(JSON.stringify(invalid.body.errors)).toMatch(/background/i);
      expect(
        (await getScene(api, production, sceneA)).background.color.toLowerCase(),
        'the colour is unchanged',
      ).toBe('#102030');
      expect(regie.problems.pageErrors).toEqual([]);
    },
  );

  test(
    'E2E-SCENE-23 [regie] thumbnails follow an edit within 1 s; the inspector says «Element» + source while one is selected and «Szene» + name otherwise',
    t.p2,
    async ({ regie, api, production, pairContext }) => {
      await production.seed([...SCENES]);
      const sceneA = production.sceneIds[0]!;
      const page = regie.page;
      const phone = await pairPhone(pairContext, { name: 'Handy Eins' });
      const scene = await addItems(api, production, sceneA, [phone.sourceId()], {
        x: 100,
        y: 100,
        w: 600,
        h: 338,
        radius: 0,
      });
      const itemId = scene.items[0]!.id;
      const thumb = '.c-scenes-dock__list > sf-scene-row:nth-child(1)';
      await expect
        .poll(
          async () => (await renderedItems(page, thumb)).find((entry) => entry.id === itemId)?.x,
        )
        .toBe(100);

      await expect(inspectorTitle(page)).toHaveText('Szene');
      await expect(inspectorSub(page)).toHaveText('Szene A');
      await sourceRow(page, 'K1 Handy Eins').click();
      await expect(inspectorTitle(page)).toHaveText('Element');
      await expect(inspectorSub(page)).toHaveText('K1 · Handy Eins');

      const moved = Date.now();
      expect(
        (
          await api.updateSceneItem(production.id, sceneA, itemId, {
            ...scene.items[0]!,
            x: 900,
            y: 500,
          })
        ).status,
      ).toBe(200);
      await expect
        .poll(
          async () => (await renderedItems(page, thumb)).find((entry) => entry.id === itemId)?.x,
          { timeout: 1500, message: 'the thumbnail follows within 1 s' },
        )
        .toBe(900);
      test
        .info()
        .annotations.push({
          type: 'measurement',
          description: `thumbnail followed an edit after ${Date.now() - moved} ms (incl. the REST call)`,
        });
      await page.keyboard.press('Escape');
      await expect(inspectorTitle(page)).toHaveText('Szene');
      expect(regie.problems.pageErrors).toEqual([]);
    },
  );
});
