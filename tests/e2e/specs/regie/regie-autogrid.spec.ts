import { requireTool } from '../../support/fixtures';
import { net } from '../../support/net';
import { t } from '../../support/tags';
import { expect, test } from '../../support/ui/fixtures';
import { pairViaApi } from '../../support/ui/pairing';
import {
  SCENES,
  expectScene,
  expectToast,
  inspector,
  renderedItems,
} from '../../support/regie/kit';

/**
 * E2E-SCENE-06: Auto-Grid reflow when a camera drops (docs/testing.md 2.3). Four phones publish a camera into an Auto-Grid scene
 * that is on air; one of them goes away. After its hold time the other three fill a 2 + 1 grid, when it is back the grid
 * has four tiles again, and the pictures of the three others never restart (same `<video>` elements, frames keep coming).
 * The output page and the Regie's Program monitor are read through their DOM (the renderer's `.sf-r-item` rectangles in
 * canvas pixels).
 *
 * Two ways for the camera to go away: the sender stops it («Kamera stoppen», the track is unpublished at once: the reflow
 * follows the 3 s hold time), and a cut network (`net.cut`: the browser closes its sockets and peers without a goodbye, so the
 * output only learns about it when LiveKit gives up on the participant - measured 24 s to more than 40 s here).
 */

const GRID4 = [
  [79, 40, 871, 490],
  [970, 40, 871, 490],
  [79, 550, 871, 490],
  [970, 550, 871, 490],
];
const GRID3 = [
  [79, 40, 871, 490],
  [970, 40, 871, 490],
  [525, 550, 871, 490],
];

test.use({ viewport: { width: 1440, height: 900 } });

type Way = 'stop' | 'cut';

test.describe('REGIE auto-grid', () => {
  for (const way of ['stop', 'cut'] as Way[]) {
    test(
      `E2E-SCENE-06 [regie, ${way === 'stop' ? 'camera stopped' : 'network cut'}] Auto-Grid reflow: a camera that drops leaves a 2 + 1 grid after its hold time and returns to its place; the other pictures keep playing`,
      way === 'stop' ? t.p1 : t.p2,
      async ({ regie, openPhone, openOutput, api, production, pairContext }) => {
        test.setTimeout(way === 'stop' ? 180_000 : 300_000);
        if (way === 'cut') requireTool('net.cut');
        await production.seed([...SCENES]);
        const sceneA = production.sceneIds[0]!;
        const page = regie.page;

        // Four phones with a small flat camera picture (the machine runs several browsers).
        const phones = [];
        const devices = [];
        for (let index = 1; index <= 4; index++) {
          const phone = await openPhone({
            camera: { width: 640, height: 360, fps: 15, stamp: false },
          });
          devices.push(await pairViaApi(pairContext, phone, { name: `Handy ${index}` }));
          await phone.waitForCamera('live');
          phones.push(phone);
        }
        for (const device of devices)
          await api.addSceneItem(production.id, sceneA, { source: device.sourceId() });
        await regie.waitForConvergence(production.id);

        // The Auto-Grid template through the inspector, the scene on air, the output open.
        await inspector(page).getByRole('button', { name: 'Auto-Grid', exact: true }).click();
        await expectToast(page, 'Vorlage «Auto-Grid» angewendet');
        await expectScene(
          api,
          production,
          sceneA,
          (scene) => scene.layoutMode === 'autoGrid',
          'the scene is in Auto-Grid mode',
        );
        expect((await api.startBroadcast(production.id)).status).toBe(200);
        const output = await openOutput(production);
        await output.stage();
        const tiles = async (target: typeof output.page, where: string) =>
          (await renderedItems(target, where))
            .filter((entry) => entry.visible)
            .map((entry) => [entry.x, entry.y, entry.w, entry.h]);
        await expect
          .poll(() => tiles(output.page, '#output'), {
            message: 'four tiles of 871 x 490 on the output',
            timeout: 60_000,
          })
          .toEqual(GRID4);
        await output.waitForPlayingVideos(4, { timeout: 60_000 });
        await expect
          .poll(() => tiles(page, 'program'), {
            message: 'the Program monitor shows the same four tiles',
            timeout: 30_000,
          })
          .toEqual(GRID4);

        // Mark the four <video> elements, to see later that nothing was recreated.
        const frame = await output.frame();
        const marked = await frame.evaluate(() => {
          const videos = [...document.querySelectorAll<HTMLVideoElement>('#output video')];
          videos.forEach((video, index) => {
            (video as unknown as { __mark: number }).__mark = index + 1;
          });
          return videos.length;
        });
        expect(marked).toBe(4);
        const ids = (await api.getSnapshot(production.id)).body.scenes[0]!.items.map(
          (entry) => entry.id,
        ) as [string, string, string, string];
        const [firstId, secondId, thirdId, fourthId] = ids;

        // The fourth camera goes away: after the hold time its tile is gone and three tiles fill a 2 + 1 grid.
        const dropped = Date.now();
        if (way === 'stop') await phones[3]!.stopCamera();
        else await net.cut(phones[3]!.context);
        await expect
          .poll(() => tiles(output.page, '#output'), {
            message: 'three tiles (two on top, one centred below) after the hold time',
            timeout: way === 'stop' ? 40_000 : 120_000,
            intervals: [250],
          })
          .toEqual(GRID3);
        const reflowAfter = Date.now() - dropped;
        test.info().annotations.push({
          type: 'measurement',
          description: `${way === 'stop' ? 'camera stopped' : 'network cut'} -> three tiles on the output after ${reflowAfter} ms (hold time 3 s)`,
        });
        if (way === 'stop')
          expect(reflowAfter, 'the hold time (3 s) plus the unpublish of the track').toBeLessThan(
            15_000,
          );
        await expect
          .poll(() => tiles(page, 'program'), {
            message: 'the Program monitor reflows too',
            timeout: 15_000,
          })
          .toEqual(GRID3);
        const surviving = await frame.evaluate(() =>
          [...document.querySelectorAll<HTMLVideoElement>('#output video')].map((video) => ({
            mark: (video as unknown as { __mark?: number }).__mark ?? 0,
            id: video.closest('.sf-r-item')?.getAttribute('data-item-id') ?? '',
            ready: video.readyState,
            playing: !video.paused,
          })),
        );
        for (const id of [firstId, secondId, thirdId]) {
          const entry = surviving.find((candidate) => candidate.id === id);
          expect(entry?.mark, `the original <video> of ${id} is still there`).toBeGreaterThan(0);
          expect(entry!.playing && entry!.ready >= 2, `the picture of ${id} keeps playing`).toBe(
            true,
          );
        }
        // No flicker: the frame counters of the three kept growing.
        const counters = () =>
          frame.evaluate(() =>
            [...document.querySelectorAll<HTMLVideoElement>('#output video')].map((video) => ({
              id: video.closest('.sf-r-item')?.getAttribute('data-item-id') ?? '',
              frames: video.getVideoPlaybackQuality().totalVideoFrames,
            })),
          );
        const before = await counters();
        await expect
          .poll(
            async () => {
              const now = await counters();
              return [firstId, secondId, thirdId].every(
                (id) =>
                  (now.find((entry) => entry.id === id)?.frames ?? 0) >
                  (before.find((entry) => entry.id === id)?.frames ?? 0),
              );
            },
            { message: 'frames keep arriving for the three others', timeout: 10_000 },
          )
          .toBe(true);

        // The camera comes back: four tiles again, the three others are still the same elements.
        if (way === 'stop') await phones[3]!.startCamera();
        else await net.restore(phones[3]!.context);
        await expect
          .poll(() => tiles(output.page, '#output'), {
            message: 'four tiles again when the camera is back',
            timeout: way === 'stop' ? 60_000 : 120_000,
            intervals: [500],
          })
          .toEqual(GRID4);
        const after = await frame.evaluate(() =>
          [...document.querySelectorAll<HTMLVideoElement>('#output video')].map((video) => ({
            mark: (video as unknown as { __mark?: number }).__mark ?? 0,
            id: video.closest('.sf-r-item')?.getAttribute('data-item-id') ?? '',
          })),
        );
        for (const id of [firstId, secondId, thirdId])
          expect(
            after.find((entry) => entry.id === id)?.mark,
            `${id} kept its <video>`,
          ).toBeGreaterThan(0);
        expect(
          after.find((entry) => entry.id === fourthId),
          'the returned camera is in its place',
        ).toBeDefined();
        expect(
          (await renderedItems(output.page, '#output')).map((entry) => entry.id),
          'item order unchanged',
        ).toEqual([firstId, secondId, thirdId, fourthId]);
        expect(regie.problems.pageErrors).toEqual([]);
      },
    );
  }
});
