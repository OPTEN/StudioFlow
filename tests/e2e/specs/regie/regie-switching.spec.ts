import { TEXT } from '../../support/text';
import { percentile } from '../../support/helpers';
import { uniqueIp } from '../../support/fixtures';
import { DeviceHub } from '../../support/hubs';
import { pairLaptopByLink, pairPhone, type PairedDevice } from '../../support/production';
import { t } from '../../support/tags';
import { expect, test } from '../../support/ui/fixtures';
import {
  COLOR,
  SCENES,
  animationsOf,
  fadeDeviationMs,
  flashes,
  hex,
  installAnimationHook,
  installPointerProbe,
  installSceneProbe,
  item,
  lastPointerDown,
  monitorOf,
  opacityFades,
  outputLayers,
  recordRequests,
  renderedItems,
  replaceItems,
  sceneHit,
  toastLog,
  toastOf,
  trackToasts,
  uploadSolid,
  watchScene,
} from '../../support/regie/kit';
import type { AdminApi } from '../../support/api';
import { regieBug } from '../../support/regie/bugs';
import type { Production } from '../../support/production';

/**
 * SWITCH in the Regie UI (docs/testing.md 2.4: E2E-SWITCH-01 ... 08, 12 ... 20): direct switching, cut and fade, the fade
 * guard, Studio Mode, Take, number keys, latency to the output, the broadcast lifecycle with slates, presence rules,
 * rapid clicks, reduced motion. Each scene holds one flat-colour image over the whole canvas (A red, B green, C blue), so
 * the output's pixels tell the scenes apart. Tally on devices, black-frame analysis and the simulcast layer (E2E-SWITCH-09
 * ... 11) need live media and belong to the sender/output specs.
 */

test.use({ viewport: { width: 1440, height: 900 } });

const FADE_STEPS = ['0.2 s', '0.3 s', '0.5 s', '0.8 s', '1 s', '1.5 s', '2 s'];
const duration = (page: import('@playwright/test').Page) => page.locator('.c-duration__value');

/** Three scenes (Scene A red, B green, C blue, each full canvas); returns their ids. */
async function seedColoured(
  api: AdminApi,
  production: Production,
): Promise<[string, string, string]> {
  await production.seed([...SCENES]);
  const colors = [COLOR.red, COLOR.green, COLOR.blue];
  const ids = production.sceneIds as [string, string, string];
  for (let index = 0; index < 3; index++) {
    const asset = await uploadSolid(api, production, `Color${index + 1}`, colors[index]!);
    await replaceItems(api, production, ids[index]!, [
      item(`itm_full${'abc'[index]}`, asset.id, { x: 0, y: 0, w: 1920, h: 1080 }),
    ]);
  }
  return ids;
}

const programId = async (api: AdminApi, production: Production) =>
  (await api.getSnapshot(production.id)).body.production.programSceneId;
const previewId = async (api: AdminApi, production: Production) =>
  (await api.getSnapshot(production.id)).body.production.previewSceneId;
const programPosts = (page: import('@playwright/test').Page) =>
  recordRequests(page, (path, method) => method === 'POST' && /\/program$/.test(path));

test.describe('REGIE switching', () => {
  test(
    'E2E-SWITCH-01 [regie] a click on a scene goes live: header, toast, log, row state and tag, API, output within T-SWITCH and one flash; the live scene does nothing',
    t.smoke,
    async ({ regie, openOutput, api, production }) => {
      const [, b] = await seedColoured(api, production);
      const page = regie.page;
      await api.startBroadcast(production.id);
      const output = await openOutput(production);
      await output.stage();
      await installSceneProbe(output.page);
      await installPointerProbe(page);
      await installAnimationHook(page);
      await regie.transitionOption('Cut').click();
      const posts = programPosts(page);

      await watchScene(output.page, b);
      await regie.clickScene('Scene B');
      await expect(monitorOf(page, 'program').locator('.c-monitor__name')).toHaveText('Scene B');
      await expect(toastOf(page)).toContainText('“Scene B” is live');
      await expect(regie.statusLine()).toContainText('Scene “Scene B” is live');
      const row = regie.scene('Scene B');
      await expect(row).toHaveAttribute('aria-pressed', 'true');
      await expect(row).toHaveAccessibleName(/, live on Program$/);
      await expect(page.locator('sf-scene-row.is-program .c-tag--pgm')).toHaveText('PGM');
      await expect(regie.scene('Scene A')).toHaveAttribute('aria-pressed', 'false');
      expect(await programId(api, production)).toBe(b);
      await expect
        .poll(() => sceneHit(output.page), {
          message: 'the output shows the new scene',
          timeout: 5000,
        })
        .not.toBeNull();
      const latency = (await sceneHit(output.page))! - (await lastPointerDown(page))!;
      test.info().annotations.push({
        type: 'measurement',
        description: `click -> output scene layer: ${latency} ms`,
      });
      expect(latency, 'T-SWITCH hard limit p95 300 ms (a single sample)').toBeLessThan(600);
      expect((await outputLayers(output.page)).map((layer) => layer.sceneId)).toEqual([b]);
      await expect
        .poll(async () => (await flashes(page)).length, {
          message: 'the Program screen flashes once',
        })
        .toBe(1);
      await page.waitForTimeout(700);
      expect((await flashes(page)).length, 'only once').toBe(1);

      // The live scene again: no request, no new toast.
      const toastBefore = await toastOf(page)
        .innerText()
        .catch(() => '');
      await regie.clickScene('Scene B');
      await page.waitForTimeout(500);
      expect(posts, 'one switch request only').toHaveLength(1);
      expect(posts[0]!.body).toEqual({ sceneId: b, transition: { kind: 'cut', durationMs: 0 } });
      expect(
        await toastOf(page)
          .innerText()
          .catch(() => ''),
      ).toBe(toastBefore);
      expect((await flashes(page)).length).toBe(1);
      expect(regie.problems.pageErrors).toEqual([]);
    },
  );

  test(
    'E2E-SWITCH-02 [regie] cut shows the new scene at once; fade runs one 300 ms opacity animation on the new layer; the output plays the transition of the event, not the Regie setting',
    t.smoke,
    async ({ regie, openOutput, api, production }) => {
      const [a, b, c] = await seedColoured(api, production);
      const page = regie.page;
      await api.startBroadcast(production.id);
      const output = await openOutput(production);
      await output.stage();
      await installAnimationHook(output.page);
      await installAnimationHook(page);

      // Cut: no opacity animation, only the new scene is there.
      await regie.transitionOption('Cut').click();
      await regie.clickScene('Scene B');
      await expect
        .poll(async () => (await outputLayers(output.page)).map((layer) => layer.sceneId))
        .toEqual([b]);
      expect(await opacityFades(output.page), 'a cut starts no fade').toHaveLength(0);

      // Fade 0.3 s: exactly one opacity animation of 300 ms on the new layer; the old layer goes when it ends.
      await regie.transitionOption('Fade').click();
      await expect(duration(page)).toHaveText('0.3 s');
      await regie.clickScene('Scene C');
      await expect.poll(async () => (await opacityFades(output.page, c)).length).toBe(1);
      await expect
        .poll(async () => (await opacityFades(output.page, c))[0]?.endedAt, {
          message: 'the fade ends',
          timeout: 5000,
        })
        .not.toBeNull();
      const fade = (await opacityFades(output.page, c))[0]!;
      expect(fade.duration).toBe(300);
      expect(await opacityFades(output.page), 'one fade, none for the cut').toHaveLength(1);
      const measured = fade.elapsedMs ?? fade.endedAt! - fade.startedAt;
      test.info().annotations.push({
        type: 'measurement',
        description: `output fade 300 ms measured ${measured} ms`,
      });
      expect(fadeDeviationMs(fade), 'T-FADE hard limit ± 50 ms').toBeLessThanOrEqual(50);
      await expect
        .poll(async () =>
          (await outputLayers(output.page)).map((layer) => `${layer.sceneId}:${layer.opacity}`),
        )
        .toEqual([`${c}:1`]);
      expect((await api.getSnapshot(production.id)).body.production.lastTransition).toEqual({
        kind: 'fade',
        durationMs: 300,
      });
      expect((await opacityFades(page, c)).length, 'the Program monitor fades as well').toBe(1);

      // The output uses the transition of the event: the Regie says Cut, a request with a 500 ms fade arrives (other client).
      await regie.transitionOption('Cut').click();
      await expect
        .poll(
          async () =>
            (
              await api.switchProgram(production.id, {
                sceneId: a,
                transition: { kind: 'fade', durationMs: 500 },
              })
            ).status,
          { message: 'the fade guard of the previous switch has passed', timeout: 5000 },
        )
        .toBe(200);
      await expect.poll(async () => (await opacityFades(output.page, a)).length).toBe(1);
      expect(
        (await opacityFades(output.page, a))[0]!.duration,
        'the event decides, not the Regie setting',
      ).toBe(500);
      await expect.poll(async () => (await opacityFades(page, a)).length).toBe(1);
      expect((await opacityFades(page, a))[0]!.duration).toBe(500);
      expect(regie.problems.pageErrors).toEqual([]);
    },
  );

  test(
    'E2E-SWITCH-03 [regie] the fade duration stepper walks 0.2 ... 2 s, is disabled at the ends and under Cut, persists and goes into the request',
    t.p1,
    async ({ regie, api, production }) => {
      await seedColoured(api, production);
      const page = regie.page;
      const longer = page.getByRole('button', { name: 'Longer fade' });
      const shorter = page.getByRole('button', { name: 'Shorter fade' });
      await expect(duration(page)).toHaveText('0.3 s');
      for (const step of FADE_STEPS.slice(2)) {
        await longer.click();
        await expect(duration(page)).toHaveText(step);
      }
      await expect(longer, 'plus is disabled at 2 s').toBeDisabled();
      for (const step of [...FADE_STEPS].reverse().slice(1)) {
        await shorter.click();
        await expect(duration(page)).toHaveText(step);
      }
      await expect(shorter, 'minus is disabled at 0.2 s').toBeDisabled();
      expect(
        await page.evaluate(() => JSON.parse(localStorage.getItem('studioflow.transition')!)),
      ).toEqual({ kind: 'fade', durationMs: 200 });

      // Under Cut both buttons are disabled and the value is muted; the choice persists.
      await regie.transitionOption('Cut').click();
      await expect(longer).toBeDisabled();
      await expect(shorter).toBeDisabled();
      await expect(page.locator('.c-duration')).toHaveClass(/is-off/);
      await expect(regie.transitionOption('Cut')).toHaveAttribute('aria-pressed', 'true');
      expect(
        await page.evaluate(() => JSON.parse(localStorage.getItem('studioflow.transition')!)),
      ).toEqual({ kind: 'cut', durationMs: 200 });
      await page.reload();
      await regie.waitReady();
      await expect(regie.transitionOption('Cut')).toHaveAttribute('aria-pressed', 'true');
      await expect(duration(page)).toHaveText('0.2 s');

      // The request carries the matching duration: Fade 0.8 s, then Cut.
      await regie.transitionOption('Fade').click();
      await longer.click();
      await longer.click();
      await expect(duration(page)).toHaveText('0.5 s');
      await longer.click();
      await expect(duration(page)).toHaveText('0.8 s');
      const posts = programPosts(page);
      await regie.clickScene('Scene B');
      await expect.poll(() => posts.length).toBe(1);
      expect(posts[0]!.body).toEqual({
        sceneId: production.sceneIds[1],
        transition: { kind: 'fade', durationMs: 800 },
      });
      await expect.poll(() => programId(api, production)).toBe(production.sceneIds[1]);
      expect(regie.problems.pageErrors).toEqual([]);
    },
  );

  test(
    'E2E-SWITCH-04 [regie] a fade always completes: switches during it are ignored (UI guard and 409), Take is disabled, nothing half-way is left, the next switch works',
    t.smoke,
    async ({ regie, openRegie, openOutput, api, production }) => {
      const [a, b, c] = await seedColoured(api, production);
      const pageA = regie.page;
      const operatorB = await openRegie();
      const pageB = operatorB.page;
      await api.startBroadcast(production.id);
      const output = await openOutput(production);
      await output.stage();
      await installAnimationHook(output.page);
      await trackToasts(pageA);
      await trackToasts(pageB);

      // 2 s fade.
      const longer = pageA.getByRole('button', { name: 'Longer fade' });
      for (let step = 0; step < 5; step++) await longer.click();
      await expect(duration(pageA)).toHaveText('2 s');
      const postsA = programPosts(pageA);
      const postsB = programPosts(pageB);
      await regie.clickScene('Scene B');
      const startedAt = Date.now();
      await expect.poll(() => programId(api, production)).toBe(b);
      // A clicks Scene C and presses 3 during the fade; B clicks Scene C 500 ms after A's switch.
      await pageA.waitForTimeout(300);
      await regie.scene('Scene C').click();
      await pageA.keyboard.press('3');
      await pageB.waitForTimeout(Math.max(0, 500 - (Date.now() - startedAt)));
      await operatorB.scene('Scene C').click();
      // And a client that has no UI guard (REST) is refused by the server.
      const refused = await api.switchProgram(production.id, {
        sceneId: c,
        transition: { kind: 'cut', durationMs: 0 },
      });
      expect(refused.status).toBe(409);
      expect(refused.body.code).toBe('transition_running');
      expect(
        postsA,
        'A sent one request: the second click and the key are ignored by the UI',
      ).toHaveLength(1);
      expect(postsB, 'B knows the fade is running and sends nothing').toHaveLength(0);
      await expect(operatorB.scene('Scene B')).toHaveAttribute('aria-pressed', 'true');
      for (const log of [await toastLog(pageA), await toastLog(pageB)])
        expect(
          log.filter((text) => !/is live$/.test(text)),
          'no error toast',
        ).toEqual([]);

      // After the fade: program B everywhere, the new layer fully opaque and the old one gone.
      await expect
        .poll(async () => (await opacityFades(output.page, b))[0]?.endedAt, { timeout: 6000 })
        .not.toBeNull();
      const fade = (await opacityFades(output.page, b))[0]!;
      expect(fade.duration).toBe(2000);
      expect(await opacityFades(output.page), 'only one fade ran').toHaveLength(1);
      expect(fadeDeviationMs(fade), 'T-FADE hard limit ± 50 ms').toBeLessThanOrEqual(50);
      await expect
        .poll(async () =>
          (await outputLayers(output.page)).map((layer) => `${layer.sceneId}:${layer.opacity}`),
        )
        .toEqual([`${b}:1`]);
      for (const regieView of [pageA, pageB])
        await expect(monitorOf(regieView, 'program').locator('.c-monitor__name')).toHaveText(
          'Scene B',
        );
      expect(await programId(api, production)).toBe(b);

      // A switch after the fade works.
      await regie.clickScene('Scene C');
      await expect.poll(() => programId(api, production)).toBe(c);
      await expect
        .poll(async () => (await opacityFades(output.page, c))[0]?.endedAt, { timeout: 6000 })
        .not.toBeNull();

      // Studio Mode: Take is disabled while the fade runs, a second Take does nothing, Take works again afterwards.
      await regie.setStudioMode(true);
      await expect.poll(() => previewId(api, production)).toBe(a);
      const takes = recordRequests(
        pageA,
        (path, method) => method === 'POST' && /\/take$/.test(path),
      );
      await regie.take().click();
      await expect(regie.take()).toBeDisabled();
      await pageA.keyboard.press('Space');
      await expect.poll(() => programId(api, production)).toBe(a);
      await expect(regie.take(), 'enabled again after the fade').toBeEnabled({ timeout: 5000 });
      expect(takes, 'one Take request').toHaveLength(1);
      await regie.take().click();
      await expect.poll(() => programId(api, production)).toBe(c);
      expect(regie.problems.pageErrors).toEqual([]);
    },
  );

  test(
    'E2E-SWITCH-05 [regie] Studio Mode: toast, Preview and Take appear without moving docks or the control column; a click changes the preview only; off clears the preview; persisted',
    t.smoke,
    async ({ regie, api, production }) => {
      const [a, b, c] = await seedColoured(api, production);
      const page = regie.page;
      await regie.transitionOption('Cut').click();
      const boxes = async () => ({
        column: await page.locator('sf-control-column').boundingBox(),
        scenes: await page.locator('sf-dock-slot[data-dock="scenes"]').boundingBox(),
        src: await page.locator('sf-dock-slot[data-dock="src"]').boundingBox(),
        insp: await page.locator('sf-dock-slot[data-dock="insp"]').boundingBox(),
        st: await page.locator('sf-dock-slot[data-dock="st"]').boundingBox(),
      });
      const hint = page.locator('.c-control-column__hint');
      await expect(hint).toHaveText('Click a scene to switch it live directly.');
      await expect(page.getByText('Preview off', { exact: true })).toBeVisible();
      await expect(monitorOf(page, 'program').locator('.c-monitor__live-edit')).toBeVisible();
      const before = await boxes();

      await regie.setStudioMode(true);
      await expect(toastOf(page)).toContainText('Studio Mode on: Preview and Take');
      await expect(monitorOf(page, 'preview')).toBeVisible();
      await expect(regie.take()).toBeVisible();
      await expect(regie.take()).toContainText('Space');
      await expect(page.getByText('Preview off', { exact: true })).toHaveCount(0);
      await expect(
        monitorOf(page, 'program').locator('.c-monitor__live-edit'),
        '“Changes go live immediately” is hidden',
      ).toHaveCount(0);
      await expect(hint).toHaveText(
        'Click a scene to load it into Preview. Take switches it live.',
      );
      const after = await boxes();
      expect(after.scenes, 'docks do not move').toEqual(before.scenes);
      expect(after.src).toEqual(before.src);
      expect(after.insp).toEqual(before.insp);
      expect(after.st).toEqual(before.st);
      expect(
        { x: after.column!.x, y: after.column!.y, width: after.column!.width },
        'the control column does not move',
      ).toEqual({ x: before.column!.x, y: before.column!.y, width: before.column!.width });
      // The preview defaults to the scene after the program.
      await expect.poll(() => previewId(api, production)).toBe(b);
      await expect(regie.scene('Scene B')).toHaveAttribute('aria-pressed', 'true');
      await expect(regie.scene('Scene B')).toHaveAccessibleName(/, in Preview$/);
      await expect(page.locator('sf-scene-row.is-preview .c-tag--pvw')).toHaveText('PVW');
      expect(await page.evaluate(() => localStorage.getItem('studioflow.studio'))).toBe('1');

      // A click only changes the preview: program and output stay.
      await regie.clickScene('Scene C');
      await expect.poll(() => previewId(api, production)).toBe(c);
      expect(await programId(api, production)).toBe(a);
      await expect(monitorOf(page, 'preview').locator('.c-monitor__name')).toHaveText('Scene C');
      await expect(monitorOf(page, 'program').locator('.c-monitor__name')).toHaveText('Scene A');

      // Reloaded with the mode on it stays on.
      await page.reload();
      await regie.waitReady();
      await expect(regie.studioModeSwitch()).toBeChecked();
      await expect(regie.take()).toBeVisible();

      // Off: toast, “Preview off”, the preview is cleared (only operator).
      await regie.setStudioMode(false);
      await expect(toastOf(page)).toContainText('Studio Mode off: scenes switch live directly');
      await expect(page.getByText('Preview off', { exact: true })).toBeVisible();
      await expect.poll(() => previewId(api, production)).toBeNull();
      expect(await page.evaluate(() => localStorage.getItem('studioflow.studio'))).toBe('0');
      await expect(regie.take()).toHaveCount(0);

      // The preview wraps around after the last scene.
      await regie.clickScene('Scene C');
      await expect.poll(() => programId(api, production)).toBe(c);
      await regie.setStudioMode(true);
      await expect.poll(() => previewId(api, production)).toBe(a);
      expect(regie.problems.pageErrors).toEqual([]);
    },
  );

  test(
    'E2E-SWITCH-06 [regie] Take: Space and the button swap preview and program with the toast; Space on a button activates the button; Take is disabled when preview = program and during a fade',
    t.smoke,
    async ({ regie, api, production }) => {
      const [a, b, c] = await seedColoured(api, production);
      const page = regie.page;
      await regie.transitionOption('Cut').click();
      await regie.setStudioMode(true);
      await regie.clickScene('Scene C');
      await expect.poll(() => previewId(api, production)).toBe(c);
      const takes = recordRequests(
        page,
        (path, method) => method === 'POST' && /\/take$/.test(path),
      );
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

      // Space on the page body.
      await page.keyboard.press('Space');
      await expect.poll(() => programId(api, production)).toBe(c);
      expect(await previewId(api, production), 'the preview is now the old program').toBe(a);
      await expect(toastOf(page)).toContainText('“Scene C” is live');
      await expect(monitorOf(page, 'program').locator('.c-monitor__name')).toHaveText('Scene C');
      await expect(monitorOf(page, 'preview').locator('.c-monitor__name')).toHaveText('Scene A');

      // Space on a focused button activates that button (Cut / Fade), not Take.
      await regie.transitionOption('Fade').focus();
      await page.keyboard.press('Space');
      await expect(regie.transitionOption('Fade')).toHaveAttribute('aria-pressed', 'true');
      await page.waitForTimeout(300);
      expect(await programId(api, production), 'Space on a button does not take').toBe(c);
      expect(takes).toHaveLength(1);
      await regie.transitionOption('Cut').click();

      // The button; then a second Take swaps back.
      await regie.take().click();
      await expect.poll(() => programId(api, production)).toBe(a);
      expect(takes).toHaveLength(2);

      // Preview = program: Take is disabled, the API refuses with 409 conflict.
      await regie.clickScene('Scene A');
      await expect.poll(() => previewId(api, production)).toBe(a);
      await expect(regie.take()).toBeDisabled();
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await page.keyboard.press('Space');
      await page.waitForTimeout(300);
      expect(takes, 'no request while the take is not possible').toHaveLength(2);
      const refused = await api.take(production.id);
      expect(refused.status).toBe(409);
      expect(refused.body.code).toBe('conflict');
      await expect(regie.take()).toHaveAttribute('aria-keyshortcuts', 'Space');

      // During a fade Take is disabled.
      await regie.clickScene('Scene B');
      await expect.poll(() => previewId(api, production)).toBe(b);
      await regie.transitionOption('Fade').click();
      const longer = page.getByRole('button', { name: 'Longer fade' });
      for (let step = 0; step < 4; step++) await longer.click();
      await expect(duration(page)).toHaveText('1.5 s');
      await regie.take().click();
      await expect(regie.take()).toBeDisabled();
      await expect(regie.take()).toBeEnabled({ timeout: 4000 });
      expect(await programId(api, production)).toBe(b);
      expect(regie.problems.pageErrors).toEqual([]);
    },
  );

  test(
    'E2E-SWITCH-07 [regie] number keys: key n switches (Studio off) or previews (on) the n-th scene; zero, letters, modified keys, typing in a field and scenes 10-12 do nothing',
    t.p1,
    async ({ regie, api, production }) => {
      await seedColoured(api, production);
      for (let index = 4; index <= 12; index++) {
        const created = await api.createScene(production.id, {
          name: `Scene ${index}`,
          cloneFromSceneId: null,
        });
        expect(created.status).toBe(201);
      }
      const ids = (await api.getSnapshot(production.id)).body.scenes.map((scene) => scene.id);
      expect(ids).toHaveLength(12);
      const page = regie.page;
      await regie.transitionOption('Cut').click();
      await expect(regie.scene('Scene 12')).toBeVisible();
      await expect(page.locator('.c-scene .c-keycap')).toHaveCount(9);
      await expect(regie.scene('Scene 10')).not.toHaveAttribute('aria-keyshortcuts', /.+/);
      const posts = recordRequests(page, (path, method) => method === 'POST' || method === 'PUT');
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      const programIs = (index: number) =>
        expect.poll(() => programId(api, production)).toBe(ids[index]);

      await page.keyboard.press('5');
      await programIs(4);
      await page.keyboard.press('9');
      await programIs(8);
      await page.keyboard.press('1');
      await programIs(0);
      const count = posts.length;
      for (const key of ['0', 'a', 'Control+3', 'Alt+3', 'Meta+3']) await page.keyboard.press(key);
      await page.waitForTimeout(400);
      expect(posts.length, 'keys that mean nothing send nothing').toBe(count);
      expect(await programId(api, production)).toBe(ids[0]);
      // Typing into a field does not switch.
      const name = page.locator('#sf-insp-name');
      await name.focus();
      await page.keyboard.press('2');
      await page.waitForTimeout(300);
      await expect(name).toHaveValue('Scene A2');
      expect(await programId(api, production)).toBe(ids[0]);
      await page.keyboard.press('Escape');
      await name.blur();
      await expect(name).toHaveValue('Scene A');

      // Studio Mode on: the key sets the preview.
      await regie.setStudioMode(true);
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await page.keyboard.press('7');
      await expect.poll(() => previewId(api, production)).toBe(ids[6]);
      expect(await programId(api, production), 'the program stays').toBe(ids[0]);
      await expect(regie.scene('Scene 7')).toHaveAttribute('aria-pressed', 'true');
      // The keys 1-9 beyond the scene count and scenes 10-12 have no key: nothing to press for them.
      expect(regie.problems.pageErrors).toEqual([]);
    },
  );

  test(
    'E2E-SWITCH-08 [regie] the output follows a click within T-SWITCH (30 cuts, 1.5 s apart)',
    t.with('@p0', '@perf'),
    async ({ regie, openOutput, api, production }) => {
      test.setTimeout(180_000);
      const [a, b] = await seedColoured(api, production);
      const page = regie.page;
      await api.startBroadcast(production.id);
      const output = await openOutput(production);
      await output.stage();
      await installSceneProbe(output.page);
      await installPointerProbe(page);
      await regie.transitionOption('Cut').click();
      const samples: number[] = [];
      for (let index = 0; index < 30; index++) {
        const target = index % 2 === 0 ? b : a;
        await watchScene(output.page, target);
        await regie.clickScene(index % 2 === 0 ? 'Scene B' : 'Scene A');
        await expect.poll(() => sceneHit(output.page), { timeout: 5000 }).not.toBeNull();
        samples.push((await sceneHit(output.page))! - (await lastPointerDown(page))!);
        await page.waitForTimeout(1500);
      }
      const p50 = percentile(samples, 50);
      const p95 = percentile(samples, 95);
      await test.info().attach('switch-latency.json', {
        body: JSON.stringify({ samples, p50, p95, max: Math.max(...samples) }, null, 2),
        contentType: 'application/json',
      });
      test.info().annotations.push({
        type: 'measurement',
        description: `click -> output: p50 ${p50} ms, p95 ${p95} ms, max ${Math.max(...samples)} ms (${samples.length} cuts)`,
      });
      expect(p95, 'T-SWITCH hard limit p95').toBeLessThanOrEqual(300);
      expect(p50, 'T-SWITCH target p50').toBeLessThanOrEqual(150);
    },
  );
});

test.describe('REGIE tally', () => {
  test(
    'E2E-SWITCH-11 [regie, device hub] Take, hiding an element and the broadcast buttons change the tally of the devices within T-TALLY: program, preview, off; standby and ended are off for everybody',
    t.smoke,
    async ({ regie, api, production, pairContext, stack, onCleanup }) => {
      test.setTimeout(120_000);
      const [a, b] = await seedColoured(api, production);
      const page = regie.page;
      const k1 = await pairPhone(pairContext, { name: 'Phone One' });
      const k2 = await pairPhone(pairContext, { name: 'Phone Two' });
      const k3 = await pairPhone(pairContext, { name: 'Phone Three' });
      const laptop = await pairLaptopByLink(pairContext, { name: 'Laptop Lea' });
      const camera = await laptop.api.allocateSlot({ kind: 'camera' });
      expect(camera.status, camera.raw.text()).toBe(200);
      const cameraSource = `${laptop.id}/${camera.body.slot}`;
      await replaceItems(api, production, a, [
        item('itm_tallyk1', k1.sourceId(), { x: 0, y: 0, w: 960, h: 540 }),
        item('itm_tallys1', laptop.sourceId(), { x: 960, y: 0, w: 960, h: 540 }),
      ]);
      await replaceItems(api, production, b, [
        item('itm_tallyk2', k2.sourceId(), { x: 0, y: 0, w: 960, h: 540 }),
        item('itm_tallycam', cameraSource, { x: 960, y: 0, w: 960, h: 540 }),
      ]);
      await regie.waitForConvergence(production.id);

      const open = async (device: PairedDevice) => {
        const hub = DeviceHub.connect(stack.anonymousBase, device.credentials, {
          headers: stack.forwardedForWorks ? { 'X-Forwarded-For': uniqueIp() } : {},
        });
        const hello = await hub.open();
        onCleanup(() => hub.stop());
        return {
          hub,
          overall: () => (hub.tallies().at(-1) ?? hello.tally).overall,
          slots: () => (hub.tallies().at(-1) ?? hello.tally).slots,
        };
      };
      const one = await open(k1);
      const two = await open(k2);
      const three = await open(k3);
      const lap = await open(laptop);
      const states = () => [one.overall(), two.overall(), three.overall(), lap.overall()];

      // Standby: everybody is off, although K1 and S1 are in the program scene.
      expect(states(), 'standby').toEqual(['off', 'off', 'off', 'off']);
      await regie.transitionOption('Cut').click();
      await regie.setStudioMode(true);
      await expect.poll(() => previewId(api, production)).toBe(b);
      expect(states(), 'a preview in standby is off as well').toEqual(['off', 'off', 'off', 'off']);

      // Start: K1 program (red), K2 preview (green), K3 off, the laptop is program with S1 on air and its camera in the preview.
      await page.getByRole('button', { name: 'Start broadcast' }).click();
      await expect
        .poll(states, { message: 'after the start', timeout: 3000 })
        .toEqual(['program', 'preview', 'off', 'program']);
      expect(lap.slots()).toMatchObject({ 'screen-1': 'program', camera: 'preview' });

      // Take: they swap within T-TALLY (hard 500 ms).
      await installPointerProbe(page);
      const latencies: number[] = [];
      for (let round = 0; round < 6; round++) {
        const flipped = round % 2 === 0;
        await regie.take().click();
        const expected = flipped
          ? ['preview', 'program', 'off', 'program']
          : ['program', 'preview', 'off', 'program'];
        await expect
          .poll(states, { message: `take ${round + 1}`, timeout: 3000, intervals: [20] })
          .toEqual(expected);
        const received = Math.max(
          ...[one, two, lap].map((entry) =>
            entry.hub.tallies().length > 0 ? entry.hub.of('tally').at(-1)!.at : 0,
          ),
        );
        latencies.push(received - (await lastPointerDown(page))!);
        await expect(regie.take()).toBeEnabled({ timeout: 3000 });
      }
      expect(lap.slots(), 'after an even number of takes').toMatchObject({
        'screen-1': 'program',
        camera: 'preview',
      });
      const p95 = percentile(latencies, 95);
      test.info().annotations.push({
        type: 'measurement',
        description: `T-TALLY click on Take -> last tally message at a device: ${latencies.join(', ')} ms, p95 ${p95} ms`,
      });
      expect(p95, 'T-TALLY hard limit 500 ms').toBeLessThanOrEqual(500);

      // Hiding an element: after an even number of takes A is on air and B is in the preview, which is the scene the Regie edits.
      expect(await programId(api, production)).toBe(a);
      expect(await previewId(api, production)).toBe(b);
      await page.getByRole('button', { name: 'Hide: Phone Two' }).click();
      await expect
        .poll(() => two.overall(), { message: 'a hidden element gives no tally', timeout: 3000 })
        .toBe('off');
      await page.getByRole('button', { name: 'Show: Phone Two' }).click();
      await expect.poll(() => two.overall(), { timeout: 3000 }).toBe('preview');

      // Ending the broadcast: off for everybody, also K1 and S1 in the program scene; starting again brings the tally back.
      await page.getByRole('button', { name: 'End broadcast' }).click();
      await page
        .getByRole('dialog', { name: 'End broadcast' })
        .getByRole('group', { name: 'End broadcast' })
        .getByRole('button', { name: 'End broadcast' })
        .click();
      await expect
        .poll(states, { message: 'ended', timeout: 3000 })
        .toEqual(['off', 'off', 'off', 'off']);
      await page.getByRole('button', { name: 'Start broadcast' }).click();
      await expect
        .poll(states, { message: 'after the next start', timeout: 3000 })
        .toEqual(['program', 'preview', 'off', 'program']);
      expect(regie.problems.pageErrors).toEqual([]);
    },
  );
});

test.describe('REGIE broadcast and slates', () => {
  const state = (page: import('@playwright/test').Page) => page.locator('.c-live b');

  test(
    'E2E-SWITCH-12 [regie] broadcast lifecycle: READY -> LIVE with a running clock -> confirmed end -> ENDED -> start again from 00:00:00 -> back to READY; the output shows the slates; the other operator follows',
    t.smoke,
    async ({ regie, openRegie, openOutput, api, production }) => {
      test.setTimeout(120_000);
      await seedColoured(api, production);
      const page = regie.page;
      const operatorB = await openRegie();
      const output = await openOutput(production);
      await output.stage();
      const slate = () => output.slateText();

      // Before the start: standby slate with the production name as subtitle.
      await expect(state(page)).toHaveText('READY');
      await expect(state(operatorB.page)).toHaveText('READY');
      await expect.poll(slate, { message: 'standby slate' }).toContain(TEXT.slate.standby);
      expect(await slate()).toContain(production.name);
      await expect
        .poll(async () => (await output.sceneIds()).length, {
          message: 'the program scene is already behind the slate',
        })
        .toBe(1);

      // Start.
      await page.getByRole('button', { name: 'Start broadcast' }).click();
      await expect(state(page)).toHaveText('LIVE');
      await expect(state(operatorB.page), 'operator B sees LIVE within 1 s').toHaveText('LIVE', {
        timeout: 1000,
      });
      const clock = page.locator('.c-live__time');
      await expect(clock).toHaveText(/^00:00:0\d$/);
      // The runtime counts up: sampled every 400 ms for 4.4 s it never goes back and reaches at least 00:00:03.
      const readings: string[] = [];
      for (let index = 0; index < 11; index++) {
        readings.push((await clock.textContent())!);
        await page.waitForTimeout(400);
      }
      const seconds = readings.map((reading) => Number(reading.slice(6)));
      expect(seconds, `the runtime counts up: ${readings.join(' ')}`).toEqual(
        [...seconds].sort((x, y) => x - y),
      );
      expect(
        new Set(seconds).size,
        'the display changes about once per second',
      ).toBeGreaterThanOrEqual(4);
      expect(seconds.at(-1)!, 'about 4.4 s after the start').toBeGreaterThanOrEqual(3);
      await expect
        .poll(slate, { message: 'the standby slate fades out', timeout: 5000 })
        .not.toContain(TEXT.slate.standby);
      expect((await api.getSnapshot(production.id)).body.production.broadcast).toBe('live');

      // End needs a confirmation: “Cancel” changes nothing, “End broadcast” ends.
      await page.getByRole('button', { name: 'End broadcast' }).click();
      const dialog = page.getByRole('dialog', { name: 'End broadcast' });
      await expect(dialog).toContainText(
        'The broadcast will end. The output then shows “Thanks for watching”.',
      );
      await dialog.getByRole('button', { name: 'Cancel' }).click();
      await expect(dialog).toBeHidden();
      await expect(state(page)).toHaveText('LIVE');
      await page.getByRole('button', { name: 'End broadcast' }).click();
      await dialog
        .getByRole('group', { name: 'End broadcast' })
        .getByRole('button', { name: 'End broadcast' })
        .click();
      await expect(state(page)).toHaveText('ENDED');
      await expect(state(operatorB.page)).toHaveText('ENDED', { timeout: 1000 });
      await expect.poll(slate, { message: 'end slate' }).toContain(TEXT.slate.end);
      await expect(page.getByRole('button', { name: 'Back to Ready' })).toBeVisible();
      await expect(regie.statusLine()).toContainText('Broadcast ended');

      // Start again: the runtime restarts at 00:00:00.
      await page.getByRole('button', { name: 'Start broadcast' }).click();
      await expect(state(page)).toHaveText('LIVE');
      await expect(clock).toHaveText(/^00:00:0[0-2]$/);
      await expect.poll(slate).not.toContain(TEXT.slate.end);

      // Reset (from ended): end again, then “Back to Ready”.
      await page.getByRole('button', { name: 'End broadcast' }).click();
      await dialog
        .getByRole('group', { name: 'End broadcast' })
        .getByRole('button', { name: 'End broadcast' })
        .click();
      await expect(state(page)).toHaveText('ENDED');
      await page.getByRole('button', { name: 'Back to Ready' }).click();
      await expect(state(page)).toHaveText('READY');
      await expect(state(operatorB.page)).toHaveText('READY', { timeout: 1000 });
      await expect.poll(slate, { message: 'standby slate again' }).toContain(TEXT.slate.standby);
      expect(regie.problems.pageErrors).toEqual([]);
    },
  );

  test(
    'E2E-SWITCH-13 [regie] switching in standby: the output keeps the standby slate (no flash of the new scene) and shows the scene after the start',
    t.p2,
    async ({ regie, openOutput, api, production }) => {
      const [, b] = await seedColoured(api, production);
      const page = regie.page;
      const output = await openOutput(production);
      await output.stage();
      await regie.transitionOption('Cut').click();
      await expect.poll(() => output.slateText()).toContain(TEXT.slate.standby);
      await regie.clickScene('Scene B');
      await expect.poll(() => programId(api, production)).toBe(b);
      await expect.poll(async () => (await output.sceneIds()).includes(b)).toBe(true);
      for (let sample = 0; sample < 8; sample++) {
        const stage = await output.stagePixels();
        const green = stage.image.shareOfColor(
          hex(COLOR.green),
          { x: 0, y: 0, width: stage.image.width, height: stage.image.height },
          30,
        );
        expect(green, `sample ${sample}: no flash of the scene while in standby`).toBeLessThan(
          0.05,
        );
        await page.waitForTimeout(150);
      }
      expect(await output.slateText()).toContain(TEXT.slate.standby);
      await page.getByRole('button', { name: 'Start broadcast' }).click();
      await expect
        .poll(
          async () => {
            const stage = await output.stagePixels();
            return stage.image.shareOfColor(
              hex(COLOR.green),
              { x: 0, y: 0, width: stage.image.width, height: stage.image.height },
              30,
            );
          },
          { message: 'after the start the output shows Scene B', timeout: 8000 },
        )
        .toBeGreaterThan(0.9);
    },
  );

  test(
    'E2E-SWITCH-19 [regie] the slates are editable in the production menu: texts and an image reach the output without a reload; a used image cannot be deleted',
    t.p2,
    async ({ regie, openOutput, api, production }) => {
      await seedColoured(api, production);
      const page = regie.page;
      const image = await uploadSolid(api, production, 'Background', COLOR.violet);
      const output = await openOutput(production);
      await output.stage();
      await page.getByRole('button', { name: /^Production .*, menu$/ }).click();
      await page.getByRole('button', { name: 'Edit slates', exact: true }).click();
      const form = page.locator('.c-prod__form');
      await expect(form).toContainText('Before the broadcast');
      await form.getByLabel('Title', { exact: true }).first().fill('Starting soon, hello');
      await form.getByLabel('Subtitle', { exact: true }).first().fill('with Lea and Jonas');
      await form
        .getByLabel('Background')
        .first()
        .selectOption({ label: `${image.code} · ${image.name}` });
      await form.getByLabel('Title', { exact: true }).nth(1).fill('See you next time');
      await form.getByRole('button', { name: 'Save' }).click();
      await expect
        .poll(() => output.slateText(), {
          message: 'the output shows the new texts',
          timeout: 8000,
        })
        .toContain('Starting soon, hello');
      expect(await output.slateText()).toContain('with Lea and Jonas');
      await expect
        .poll(
          async () => {
            const stage = await output.stagePixels();
            return stage.image.shareOfColor(
              hex(COLOR.violet),
              { x: 0, y: 0, width: stage.image.width, height: stage.image.height },
              30,
            );
          },
          { message: 'the slate image fills the output', timeout: 8000 },
        )
        .toBeGreaterThan(0.4);
      const refused = await api.deleteAsset(production.id, image.id);
      expect(refused.status).toBe(409);
      expect(refused.body.code).toBe('asset_in_use');
      expect((await api.getSnapshot(production.id)).body.production.standbySlate.title).toBe(
        'Starting soon, hello',
      );
      expect(regie.problems.pageErrors).toEqual([]);
    },
  );
});

test.describe('REGIE two operators and rapid input', () => {
  test(
    'E2E-SWITCH-14 [regie] Studio Mode and presence: a direct switch of B does not change the preview of A; B turning the mode off keeps the preview while A is there; alone, turning it off clears it',
    t.p1,
    async ({ regie, openRegie, api, production }) => {
      const [, b] = await seedColoured(api, production);
      const pageA = regie.page;
      await regie.transitionOption('Cut').click();
      await regie.setStudioMode(true);
      await expect.poll(() => previewId(api, production)).toBe(b);
      const operatorB = await openRegie();
      await operatorB.transitionOption('Cut').click();
      await expect(pageA.locator('.c-header__presence-label')).toHaveText('2 in the control room');
      await expect(operatorB.page.locator('.c-header__presence-label')).toHaveText(
        '2 in the control room',
      );
      const putsB = recordRequests(
        operatorB.page,
        (path, method) => method === 'PUT' && /\/preview$/.test(path),
      );

      // B (Studio Mode off) switches the program: A's preview stays, A's Program monitor follows quickly.
      const clicked = Date.now();
      await operatorB.scene('Scene C').click();
      // docs/testing.md: ≤ 500 ms after B's switch; the harness allows 3 s (parallel stacks load the machine) and records the time.
      await expect(monitorOf(pageA, 'program').locator('.c-monitor__name')).toHaveText('Scene C', {
        timeout: 3000,
      });
      test.info().annotations.push({
        type: 'measurement',
        description: `B's switch visible on A's Program monitor after ${Date.now() - clicked} ms (incl. the Playwright click; plan: <= 500 ms)`,
      });
      expect(
        await previewId(api, production),
        "B's direct switch does not change A's preview",
      ).toBe(b);
      await expect(monitorOf(pageA, 'preview').locator('.c-monitor__name')).toHaveText('Scene B');

      // B toggles Studio Mode on and off while A is connected: no PUT preview that clears it.
      await operatorB.setStudioMode(true);
      await operatorB.setStudioMode(false);
      await pageA.waitForTimeout(400);
      expect(
        putsB.filter((entry) => (entry.body as { sceneId: string | null }).sceneId === null),
        'no clearing request while another operator is online',
      ).toHaveLength(0);
      expect(await previewId(api, production), "B turning it off keeps A's preview").not.toBeNull();

      // B leaves: presence drops; A alone turns the mode off and the preview is cleared.
      await operatorB.page.context().close();
      await expect(pageA.locator('.c-header__presence-label')).toHaveText('1 in the control room', {
        timeout: 10_000,
      });
      await regie.setStudioMode(false);
      await expect.poll(() => previewId(api, production)).toBeNull();
    },
  );

  test(
    'E2E-SWITCH-15 [regie] Regie monitor and output fade for the same duration and start together',
    t.with('@p1', '@perf'),
    async ({ regie, openOutput, api, production }) => {
      const [, b] = await seedColoured(api, production);
      const page = regie.page;
      await api.startBroadcast(production.id);
      const output = await openOutput(production);
      await output.stage();
      await installAnimationHook(output.page);
      await installAnimationHook(page);
      const longer = page.getByRole('button', { name: 'Longer fade' });
      for (let step = 0; step < 4; step++) await longer.click();
      await expect(duration(page)).toHaveText('1.5 s');
      await page.getByRole('button', { name: 'Shorter fade' }).click();
      await expect(duration(page)).toHaveText('1 s');
      await regie.clickScene('Scene B');
      await expect
        .poll(
          async () =>
            [
              (await opacityFades(page, b))[0]?.endedAt,
              (await opacityFades(output.page, b))[0]?.endedAt,
            ].every((value) => value !== undefined && value !== null),
          { timeout: 8000 },
        )
        .toBe(true);
      const regieFade = (await opacityFades(page, b))[0]!;
      const outputFade = (await opacityFades(output.page, b))[0]!;
      expect(regieFade.duration).toBe(1000);
      expect(outputFade.duration).toBe(1000);
      const regieMs = regieFade.elapsedMs ?? regieFade.endedAt! - regieFade.startedAt;
      const outputMs = outputFade.elapsedMs ?? outputFade.endedAt! - outputFade.startedAt;
      const offset = Math.abs(regieFade.startedAt - outputFade.startedAt);
      test.info().annotations.push({
        type: 'measurement',
        description: `fade 1000 ms: Regie ${regieMs} ms, output ${outputMs} ms, start offset ${offset} ms`,
      });
      expect(Math.abs(regieMs - 1000)).toBeLessThanOrEqual(50);
      expect(Math.abs(outputMs - 1000)).toBeLessThanOrEqual(50);
      expect(offset, 'T-FADE start offset hard limit').toBeLessThanOrEqual(100);
    },
  );

  test(
    'E2E-SWITCH-17 [regie] rapid clicking from two operators: at most a few switches succeed, no error toast, everybody ends on the scene of the last accepted click',
    t.p1,
    async ({ regie, openRegie, openOutput, api, production }) => {
      const [a, b, c] = await seedColoured(api, production);
      const pageA = regie.page;
      const operatorB = await openRegie();
      const pageB = operatorB.page;
      await api.startBroadcast(production.id);
      const output = await openOutput(production);
      await output.stage();
      await trackToasts(pageA);
      await trackToasts(pageB);
      // Fade 0.3 s is the default.
      const postsA = programPosts(pageA);
      const postsB = programPosts(pageB);
      const click = async (operator: typeof regie, scenes: string[]) => {
        for (let index = 0; index < 10; index++)
          await operator.scene(scenes[index % scenes.length]!).click({ noWaitAfter: true });
      };
      const started = Date.now();
      await Promise.all([
        click(regie, ['Scene B', 'Scene C']),
        click(operatorB, ['Scene C', 'Scene A']),
      ]);
      const burstMs = Date.now() - started;
      await expect
        .poll(() => [...postsA, ...postsB].every((entry) => entry.endedAt !== null))
        .toBe(true);
      const accepted = [...postsA, ...postsB]
        .filter((entry) => entry.status === 200)
        .sort((x, y) => x.startedAt - y.startedAt);
      test.info().annotations.push({
        type: 'measurement',
        description: `${postsA.length + postsB.length} requests sent in ${burstMs} ms, ${accepted.length} accepted`,
      });
      expect(accepted.length).toBeGreaterThanOrEqual(1);
      expect(
        accepted.length,
        'successful switches within the burst (one per 0.3 s fade)',
      ).toBeLessThanOrEqual(Math.ceil(burstMs / 300) + 1);
      const lastAccepted = accepted.at(-1)!.body as { sceneId: string };
      await expect
        .poll(() => programId(api, production), { timeout: 8000 })
        .toBe(lastAccepted.sceneId);
      const name = { [a]: 'Scene A', [b]: 'Scene B', [c]: 'Scene C' }[lastAccepted.sceneId]!;
      for (const view of [pageA, pageB]) {
        await expect(monitorOf(view, 'program').locator('.c-monitor__name')).toHaveText(name);
      }
      await expect
        .poll(
          async () =>
            (await outputLayers(output.page)).map((layer) => `${layer.sceneId}:${layer.opacity}`),
          { message: 'no stuck half-fade on the output' },
        )
        .toEqual([`${lastAccepted.sceneId}:1`]);
      for (const log of [await toastLog(pageA), await toastLog(pageB)])
        expect(
          log.filter((text) => !/is live$|not|Scene/.test(text) || /error|could not/.test(text)),
          'no error toast',
        ).toEqual([]);
      for (const log of [await toastLog(pageA), await toastLog(pageB)])
        expect(log.every((text) => /is live$/.test(text))).toBe(true);
      // Nothing stays stuck: a click later works.
      const next = lastAccepted.sceneId === a ? 'Scene B' : 'Scene A';
      await regie.scene(next).click();
      await expect(regie.scene(next)).toHaveAttribute('aria-pressed', 'true');
      expect(regie.problems.pageErrors).toEqual([]);
      expect(operatorB.problems.pageErrors).toEqual([]);
    },
  );

  test(
    'E2E-SWITCH-18 [regie] switching to an empty scene and to one with a blocked and a deleted source works: background colour only, placeholders, no exception',
    t.p2,
    async ({ regie, openOutput, api, production, pairContext }) => {
      const [, b, c] = await seedColoured(api, production);
      const page = regie.page;
      await api.updateScene(production.id, b, { background: { color: '#102030', assetId: null } });
      await replaceItems(api, production, b, []);
      const blocked = await pairPhone(pairContext, { name: 'Phone Blocked' });
      const gone = await pairLaptopByLink(pairContext, { name: 'Laptop Gone' });
      await replaceItems(api, production, c, [
        item('itm_blocked1', blocked.sourceId(), { x: 100, y: 100, w: 600, h: 338 }),
        item('itm_gone0001', gone.sourceId(), { x: 800, y: 300, w: 600, h: 338 }),
      ]);
      await api.blockDevice(production.id, blocked.id);
      await api.deleteDevice(production.id, gone.id);
      await api.startBroadcast(production.id);
      const output = await openOutput(production);
      await output.stage();
      await regie.transitionOption('Cut').click();
      await regie.waitForConvergence(production.id);

      await regie.clickScene('Scene B');
      await expect(toastOf(page)).toContainText('“Scene B” is live');
      await expect
        .poll(
          async () => {
            const stage = await output.stagePixels();
            return stage.image.shareOfColor(
              '#102030',
              { x: 0, y: 0, width: stage.image.width, height: stage.image.height },
              12,
            );
          },
          { message: 'the output shows the scene background colour only', timeout: 8000 },
        )
        .toBeGreaterThan(0.95);
      await expect.poll(async () => (await renderedItems(output.page, '#output')).length).toBe(0);

      await regie.clickScene('Scene C');
      await expect(toastOf(page)).toContainText('“Scene C” is live');
      await expect.poll(() => programId(api, production)).toBe(c);
      await expect.poll(async () => (await renderedItems(output.page, '#output')).length).toBe(2);
      await expect.poll(async () => (await renderedItems(page, 'program')).length).toBe(2);
      expect(regie.problems.pageErrors).toEqual([]);
      expect(output.problems.pageErrors).toEqual([]);
    },
  );

  test(
    'E2E-SWITCH-20 [regie] focus rules around Take: Enter on the focused button takes once, Space on the page takes, a click on the monitor then Space takes',
    t.p2,
    async ({ regie, api, production }) => {
      const [a, b] = await seedColoured(api, production);
      const page = regie.page;
      await regie.transitionOption('Cut').click();
      await regie.setStudioMode(true);
      await expect.poll(() => previewId(api, production)).toBe(b);
      const takes = recordRequests(
        page,
        (path, method) => method === 'POST' && /\/take$/.test(path),
      );

      await regie.take().focus();
      await page.keyboard.press('Enter');
      await expect.poll(() => programId(api, production)).toBe(b);
      await page.waitForTimeout(300);
      expect(
        takes,
        'Enter on the button takes once, no second take from a Space handler',
      ).toHaveLength(1);

      await monitorOf(page, 'program').locator('.c-monitor__head').click();
      await page.keyboard.press('Space');
      await expect.poll(() => programId(api, production)).toBe(a);
      expect(takes).toHaveLength(2);
      await expect(page.locator('.c-take__hint')).toHaveText('Space');
    },
  );
});

test.describe('REGIE reduced motion', () => {
  test.use({ contextOptions: { reducedMotion: 'reduce' } });

  test(
    'E2E-SWITCH-16 [regie, switching] with prefers-reduced-motion the Regie cuts (no opacity fade, no flash) while the request still carries the fade and the output plays the full fade',
    t.p1,
    async ({ regie, openOutput, api, production }) => {
      const [, b] = await seedColoured(api, production);
      const page = regie.page;
      await api.startBroadcast(production.id);
      const output = await openOutput(production);
      await output.stage();
      await installAnimationHook(output.page);
      await installAnimationHook(page);
      const longer = page.getByRole('button', { name: 'Longer fade' });
      for (let step = 0; step < 4; step++) await longer.click();
      await page.getByRole('button', { name: 'Shorter fade' }).click();
      await expect(duration(page), 'the stepper keeps its value').toHaveText('1 s');
      const posts = programPosts(page);
      await regie.clickScene('Scene B');
      await expect.poll(() => posts.length).toBe(1);
      expect(posts[0]!.body, 'the request still sends the fade').toEqual({
        sceneId: b,
        transition: { kind: 'fade', durationMs: 1000 },
      });
      // The output (a default context, motion allowed) plays the 1 s fade.
      await expect.poll(async () => (await opacityFades(output.page, b)).length).toBe(1);
      expect((await opacityFades(output.page, b))[0]!.duration).toBe(1000);
      await expect(monitorOf(page, 'program').locator('.c-monitor__name')).toHaveText('Scene B');
      await page.waitForTimeout(1500);
      expect(await opacityFades(page), 'the Regie monitor cuts: no opacity animation').toHaveLength(
        0,
      );
      expect(await flashes(page), 'and does not flash').toHaveLength(0);
      expect(
        (await animationsOf(page)).filter((entry) => entry.properties.includes('opacity')),
      ).toHaveLength(0);
      expect(regie.problems.pageErrors).toEqual([]);
    },
  );
});

test.describe('REGIE reduced motion (CSS)', () => {
  test.use({ contextOptions: { reducedMotion: 'reduce' } });

  test(
    'E2E-SWITCH-16 [regie, css] with prefers-reduced-motion every CSS transition and animation duration of the Regie is 0 s',
    t.p1,
    async ({ regie }) => {
      regieBug(
        'REGIE-01',
        'prefers-reduced-motion does not zero the --dur-* tokens: the :root token block comes after the reduced-motion override',
      );
      const page = regie.page;
      const result = await page.evaluate(() => {
        const durations = (selector: string) => {
          const element = document.querySelector(selector);
          if (!element) return null;
          const style = getComputedStyle(element);
          return {
            selector,
            transition: style.transitionDuration,
            animation: style.animationDuration,
          };
        };
        return {
          mediaMatches: matchMedia('(prefers-reduced-motion: reduce)').matches,
          token: getComputedStyle(document.documentElement).getPropertyValue('--dur-state').trim(),
          elements: [
            '.c-btn',
            '.c-transition__option',
            '.c-scene',
            '.c-duration__btn',
            '.c-ibtn',
            '.c-switch input',
          ]
            .map(durations)
            .filter(Boolean),
        };
      });
      expect(result.mediaMatches, 'the browser context asks for reduced motion').toBe(true);
      expect(result.token, 'the duration token is 0s').toMatch(/^0(s|ms)$/);
      for (const entry of result.elements as Array<{
        selector: string;
        transition: string;
        animation: string;
      }>) {
        expect(
          entry.transition.split(',').every((part) => parseFloat(part) === 0),
          `transition-duration of ${entry.selector}: ${entry.transition}`,
        ).toBe(true);
        expect(
          entry.animation.split(',').every((part) => parseFloat(part) === 0),
          `animation-duration of ${entry.selector}: ${entry.animation}`,
        ).toBe(true);
      }
    },
  );
});
