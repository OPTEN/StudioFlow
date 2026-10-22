import { sleep } from '../../support/shell';
import { THRESHOLD } from '../../support/constants';
import { FULL, LEFT, RIGHT, liveLaptop, logTexts, openStation, putInScene } from '../../support/devices/fleet';
import { readPlaces, waitForOutage, waitForRecovered } from '../../support/devices/places';
import { expect, test } from '../../support/ui/fixtures';
import { t } from '../../support/tags';

/**
 * SRC with a laptop sender: a shared screen that ends («Teilen beendet» in the six places), «Neu teilen lassen» and the
 * return into the same place, «Teilen beenden» on the sender, several screens and the optional camera.
 * Docs/testing.md 2.5 (SRC-06, -07, -08, -14). The screens are the canvas fakes of support/browser/fake-sources.js: a flat
 * colour per screen (S1 red, S2 green, S3 blue), so the pictures tell themselves apart.
 */

test.describe('SRC laptop screens', () => {
  test(
    'E2E-SRC-06 [ui] a screen share that the user ends shows «Teilen beendet» in all six places; the sender offers «Erneut teilen» and does not share again by itself',
    t.smoke,
    async ({ regie, openLaptop, openOutput, pairContext, api, production }, testInfo) => {
      test.setTimeout(180_000);
      const s1 = await liveLaptop({ openLaptop }, pairContext, regie, 'Laptop Lea');
      expect(s1.code).toBe('S1');
      const item = await putInScene(api, production, 0, s1.sourceId, FULL);
      await api.startBroadcast(production.id);
      const output = await openOutput(production);
      await output.waitForPlayingVideos(1);
      await expect.poll(async () => (await readPlaces(regie.page)).stations[0]?.line ?? '', { timeout: 20_000 }).toMatch(/Mbit\/s/);
      expect((await s1.laptop.mediaCalls()).display, 'one getDisplayMedia call so far').toBe(1);

      const startedAt = Date.now();
      expect(await s1.laptop.browserStopsSharing(), 'the browser\'s «Stop sharing»').toBe(true);
      const outage = await waitForOutage(regie, 'S1', 'ended', { source: 'screen', inProgram: true, startedAt, timeoutMs: 15_000 });
      testInfo.annotations.push({ type: 'measurement', description: `T-DETECT-CLEAN (Stop sharing -> six places «Teilen beendet»): ${outage.elapsedMs} ms` });
      await testInfo.attach('detect-ended.json', { body: JSON.stringify({ elapsedMs: outage.elapsedMs, detail: outage.check.detail }, null, 2), contentType: 'application/json' });
      expect(outage.elapsedMs, 'T-DETECT-CLEAN hard limit 3 s').toBeLessThanOrEqual(THRESHOLD.detectCleanHardMs);

      const places = outage.places;
      const strip = places.strip.find((entry) => entry.code === 'S1')!;
      expect(strip.name).toContain('Laptop Lea');
      expect(strip.place).toBe('im Program');
      expect(strip.tone, 'red').toBe('bad');
      expect(strip.actions, 'the direct action').toContain('Neu teilen lassen');
      expect(places.header.lamp, 'red lamp').toBe('is-bad');
      expect(places.header.text).toBe('1 Störung');
      expect(places.program.find((label) => label.text.startsWith('S1'))!.outline, 'red dashed outline').toMatch(/^dashed rgb\(248, 81, 73\)/);
      expect(places.scenes[0]!.meta, 'scene row').toContain('S1');
      expect(places.scenes[0]!.health).toBe('gestört');
      expect(places.sources.find((row) => row.code === 'S1')!.state).toMatch(/Teilen beendet\s*\d\d:\d\d/);
      expect(places.stations[0]!.line).toMatch(/Teilen beendet\s*\d\d:\d\d/);

      // The sender: the large «Erneut teilen»; it did not call getDisplayMedia again.
      const reshare = s1.laptop.slot('screen-1').getByRole('button', { name: 'Erneut teilen' });
      await expect(reshare).toBeVisible();
      await expect(reshare).toHaveClass(/c-button--large/);
      await sleep(1500); // a quiet period: nothing may share by itself
      expect((await s1.laptop.mediaCalls()).display, 'the sender did not ask for the screen again').toBe(1);
      // The output holds the last frame: the item stays on the stage.
      expect((await output.items()).some((candidate) => candidate.id === item.id && candidate.visible), 'the output keeps the item').toBe(true);
      expect(await logTexts(api, production)).toContain('S1 Teilen beendet');
    },
  );

  test(
    'E2E-SRC-07 [ui] «Neu teilen lassen» returns the picture to the same place: same item, no new station, one more browser prompt, no log entry for the request',
    t.smoke,
    async ({ regie, openLaptop, openOutput, pairContext, api, production }) => {
      test.setTimeout(180_000);
      const s1 = await liveLaptop({ openLaptop }, pairContext, regie, 'Laptop Lea');
      const item = await putInScene(api, production, 0, s1.sourceId, { x: 320, y: 90, w: 1280, h: 720, fit: 'contain' });
      await api.startBroadcast(production.id);
      const output = await openOutput(production);
      await output.waitForPlayingVideos(1);
      const sceneBefore = (await production.snapshot()).scenes[0]!;
      const sourcesBefore = (await production.snapshot()).sources.length;
      const stationsBefore = (await readPlaces(regie.page)).stations.length;
      const boxBefore = (await output.items())[0]!.box;

      await s1.laptop.browserStopsSharing();
      await waitForOutage(regie, 'S1', 'ended', { source: 'screen', wide: true });
      const logBefore = await logTexts(api, production);
      await regie.page.locator('fs-status-line').getByRole('button', { name: 'Neu teilen lassen' }).click();
      await expect(regie.toast()).toContainText('Bitte an Laptop Lea · Screen 1 geschickt: «Bildschirm erneut teilen»');
      await expect(s1.laptop.reshareBanner()).toBeVisible();
      const prompt = s1.laptop.page.locator('.c-laptop__reshare').getByRole('button', { name: 'Erneut teilen' });
      await expect(prompt, 'a prominent button').toHaveClass(/c-button--large/);
      expect(await logTexts(api, production), 'the request writes no log entry').toEqual(logBefore);
      expect((await s1.laptop.mediaCalls()).display).toBe(1);

      await prompt.click();
      await s1.laptop.waitForSlot('screen-1', 'live', 30_000);
      expect((await s1.laptop.mediaCalls()).display, 'the browser was asked exactly once more (user gesture)').toBe(2);
      await waitForRecovered(regie, 'S1', { timeoutMs: 30_000 });
      await output.waitForPlayingVideos(1, { timeout: 30_000 });

      const sceneAfter = (await production.snapshot()).scenes[0]!;
      expect(sceneAfter.items, 'the same item: id, rectangle, fit and z-order unchanged').toEqual(sceneBefore.items);
      expect(sceneAfter.items[0]!.id).toBe(item.id);
      expect((await production.snapshot()).sources.length, 'no new source').toBe(sourcesBefore);
      const places = await readPlaces(regie.page);
      expect(places.stations.length, 'no new station').toBe(stationsBefore);
      expect(places.stations[0]!.codes).toEqual(['S1']);
      const boxAfter = (await output.items())[0]!.box;
      for (const key of ['x', 'y', 'width', 'height'] as const) expect(Math.abs(boxAfter[key] - boxBefore[key]), `output rectangle ${key}`).toBeLessThanOrEqual(1.5);
      await expect(s1.laptop.reshareBanner(), 'the banner is gone').toBeHidden();
    },
  );

  test(
    'E2E-SRC-08 [ui] «Teilen beenden» on the laptop is «Teilen beendet» (red); sharing again returns the slot to ok with «wieder da»',
    t.p1,
    async ({ regie, openLaptop, pairContext, api, production }) => {
      test.setTimeout(180_000);
      const s1 = await liveLaptop({ openLaptop }, pairContext, regie, 'Laptop Lea');
      await putInScene(api, production, 0, s1.sourceId, FULL);
      await expect.poll(async () => (await readPlaces(regie.page)).stations[0]?.line ?? '', { timeout: 20_000 }).toMatch(/Mbit\/s/);

      await s1.laptop.endShare('screen-1');
      await waitForOutage(regie, 'S1', 'ended', { source: 'screen' });
      expect(await logTexts(api, production)).toContain('S1 Teilen beendet');
      expect(await s1.laptop.slotState('screen-1')).toBe('ended');
      await s1.laptop.reshare('screen-1');
      await s1.laptop.waitForSlot('screen-1', 'live', 30_000);
      await waitForRecovered(regie, 'S1', { timeoutMs: 30_000 });
      expect((await logTexts(api, production)).some((text) => /^S1 wieder da, war \d+ s weg$/.test(text))).toBe(true);
    },
  );

  test(
    'E2E-SRC-14 [ui] several screens and an optional camera on a laptop: S1-S3, only the ended one raises an incident, a removed screen leaves «Quelle fehlt», the camera gets a K code, a 10th screen is refused',
    t.p1,
    async ({ regie, openLaptop, pairContext, api, production }) => {
      test.setTimeout(240_000);
      const s1 = await liveLaptop({ openLaptop }, pairContext, regie, 'Laptop Lea');
      const laptop = s1.laptop;
      await laptop.addScreen();
      await laptop.waitForSlot('screen-2', 'live', 30_000);
      await laptop.addScreen();
      await laptop.waitForSlot('screen-3', 'live', 30_000);
      expect((await laptop.mediaCalls()).display).toBe(3);
      const sources = (await production.snapshot()).sources.filter((source) => source.deviceId === s1.device.id);
      expect(sources.map((source) => `${source.code} ${source.label}`).sort()).toEqual(['S1 Laptop Lea · Screen 1', 'S2 Laptop Lea · Screen 2', 'S3 Laptop Lea · Screen 3']);
      const s2Id = sources.find((source) => source.code === 'S2')!.id;
      const s3Id = sources.find((source) => source.code === 'S3')!.id;
      await putInScene(api, production, 0, s1.sourceId, LEFT);
      await putInScene(api, production, 0, s2Id, RIGHT);
      await putInScene(api, production, 1, s3Id, FULL);
      await expect.poll(async () => (await readPlaces(regie.page)).stations[0]?.line ?? '', { timeout: 20_000 }).toMatch(/Mbit\/s/);

      // End screen 2 only: one incident, S1 and S3 stay calm.
      await laptop.endShare('screen-2');
      await waitForOutage(regie, 'S2', 'ended', { source: 'screen' });
      const places = await readPlaces(regie.page);
      expect(places.strip.map((entry) => entry.code), 'only S2 raises an incident').toEqual(['S2']);
      expect(places.header.text).toBe('1 Störung');

      // «Entfernen» on screen 3: the source is gone, the scene item shows «Quelle fehlt».
      await laptop.removeSlot('screen-3');
      await expect.poll(async () => (await production.snapshot()).sources.some((source) => source.id === s3Id), { message: 'S3 is removed from the production' }).toBe(false);
      const scene = (await production.snapshot()).scenes[1]!;
      expect(scene.items.map((item) => item.source), 'the scene keeps the item').toEqual([s3Id]);
      await regie.clickScene(scene.name);
      await expect(regie.page.locator('.c-monitor--program .fs-r-missing').first()).toHaveText('Quelle fehlt');

      // The optional camera: a K code and the label «Laptop Lea · Kamera».
      await laptop.addCamera();
      await laptop.waitForSlot('camera', 'live', 30_000);
      const camera = (await production.snapshot()).sources.find((source) => source.deviceId === s1.device.id && source.slot === 'camera')!;
      expect(camera.code).toMatch(/^K\d+$/);
      expect(camera.label).toBe('Laptop Lea · Kamera');

      // The limit: nine screens per device. The sender stops offering «+ weiteren Bildschirm», the API answers 409.
      for (let index = 0; index < 7; index++) {
        const allocated = await s1.device.api.allocateSlot({ kind: 'screen' });
        expect([200, 201], `allocation ${index}: ${allocated.raw.text()}`).toContain(allocated.status);
      }
      const tenth = await s1.device.api.allocateSlot({ kind: 'screen' });
      expect(tenth.status, 'the 10th screen').toBe(409);
      expect(tenth.body.code).toBe('limit_reached');
      await laptop.page.reload();
      await laptop.waitConnected();
      await expect(laptop.page.getByRole('button', { name: '+ weiteren Bildschirm' }), 'no more screens are offered at nine').toHaveCount(0);
      await expect(laptop.page.locator('[data-testid^="slot-screen-"]')).toHaveCount(9);
      const row = await openStation(regie, s1.device.id);
      await expect(row.locator('.c-st__codes .c-code')).toHaveCount(10); // nine screens and the camera
    },
  );
});
