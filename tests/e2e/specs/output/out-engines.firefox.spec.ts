import { chromium } from '@playwright/test';
import { DE } from '../../support/constants';
import { CHROMIUM_ARGS } from '../../support/fake-media';
import { installInitScript } from '../../support/net';
import { expect, test } from '../../support/ui/fixtures';
import { installUiInit } from '../../support/ui/init';
import { OutputPage } from '../../support/ui/output';
import { LaptopSender, PhoneSender } from '../../support/ui/sender';
import { toneOf } from '../../support/output/analysis';
import { installProbe, OutputProbe } from '../../support/output/probe';
import { addCamera, addScreens, goLive, placeItem } from '../../support/output/world';
import { t } from '../../support/tags';

/**
 * E2E-OUT-17 in Firefox: the output page rendered by Gecko while the sources are published by the real sender in
 * Chromium (Firefox has no stamp camera or canvas capture in the sender; the fake sources of the Chromium senders are
 * the pictures). Video plays, the hold frame and the slates work, the stage letterboxes like in Chromium.
 */

test.describe('OUT other engines (Firefox)', () => {
  test(
    'E2E-OUT-17 [firefox] the output renders and plays a camera and a screen, keeps the last frame when the source goes away, shows the slates and letterboxes a 4:3 frame',
    t.p1,
    async ({ browser, api, production, pairContext, config, browserName, onCleanup }) => {
      test.setTimeout(240_000);
      expect(browserName).toBe('firefox');
      const senders = await chromium.launch({ args: CHROMIUM_ARGS });
      onCleanup(() => senders.close());
      const deps = {
        api,
        production,
        pairContext,
        openPhone: async (options = {}) => {
          const phone = await PhoneSender.open(senders, options);
          onCleanup(() => phone.close());
          return phone;
        },
        openLaptop: async (options = {}) => {
          const laptop = await LaptopSender.open(senders, options);
          onCleanup(() => laptop.close());
          return laptop;
        },
      };
      const camera = await addCamera(deps, 'Kamera Fuchs');
      const screens = await addScreens(deps, 'Laptop Fuchs', 1);
      const scene = production.sceneIds[0]!;
      const cameraItem = await placeItem(api, production, scene, camera.source, { x: 0, y: 0, w: 1280, h: 720, fit: 'cover', radius: 0, holdMs: 1500 });
      await placeItem(api, production, scene, screens.sources[0]!, { x: 1300, y: 0, w: 600, h: 338, fit: 'contain', radius: 0 });

      // Firefox: no camera/microphone permissions in the context options (it rejects them), the probe and the init script as in Chromium.
      const context = await browser.newContext({ baseURL: config.baseURL, ignoreHTTPSErrors: true, locale: 'de-CH', timezoneId: 'Europe/Zurich', viewport: { width: 1280, height: 720 } });
      onCleanup(() => context.close());
      await installInitScript(context);
      await installProbe(context);
      await installUiInit(context, { testHooks: false });
      const output = await OutputPage.open(context, production, {}, { viewport: { width: 1280, height: 720 } });
      const probe = new OutputProbe(output);
      await expect.poll(() => output.slateText(), { timeout: 20_000 }).toContain(DE.slateStandby);
      await goLive(api, production);
      // Firefox reports no frames for MediaStream videos (getVideoPlaybackQuality().totalVideoFrames stays 0): the videos are
      // checked by their size, readiness and a moving clock instead.
      await expect
        .poll(
          async () =>
            (await output.frame()).evaluate(async () => {
              const videos = [...document.querySelectorAll('video')] as HTMLVideoElement[];
              const before = videos.map((video) => video.currentTime);
              await new Promise((resolve) => setTimeout(resolve, 800));
              return videos.length === 2 && videos.every((video, index) => video.videoWidth > 0 && video.readyState >= 2 && !video.paused && video.currentTime - before[index]! > 0.5);
            }),
          { timeout: 60_000, intervals: [500], message: 'two videos with a picture and a moving clock' },
        )
        .toBe(true);
      expect(output.problems.pageErrors, 'no uncaught error in Firefox').toEqual([]);

      // The picture is the one of the sources: the screen's red in its item, a moving camera picture.
      const stage = await output.stagePixels();
      expect(toneOf(stage.mean({ x: 1380, y: 80, width: 440, height: 200 })), 'S1 (red) in the screen item').toBe('red');
      expect(stage.image.meanLuma(), 'not black').toBeGreaterThan(20);

      // Hold frame: the sender goes away, the last frame stays, later it is darkened.
      await camera.phone.page.close();
      await probe.waitForItemState(cameraItem.id, 'hold', 30_000);
      const hold = await probe.snapshot(true);
      expect(hold.items.find((item) => item.id === cameraItem.id)!.luma, 'the hold frame is not black').toBeGreaterThan(15);
      await probe.waitForItemState(cameraItem.id, 'held', 10_000);
      const held = await output.frame().then((frame) => frame.evaluate((id) => {
        const root = document.querySelector(`[data-item-id="${id}"]`)!;
        return { text: root.querySelector('.sf-r-held-text')?.textContent, display: getComputedStyle(root.querySelector('.sf-r-held')!).display };
      }, cameraItem.id));
      expect(held.display).toBe('flex');
      expect(held.text).toBe(DE.holdText);

      // End slate and standby slate.
      expect((await api.endBroadcast(production.id)).status).toBe(200);
      await expect.poll(() => output.slateText(), { timeout: 10_000 }).toContain(DE.slateEnd);
      expect((await api.resetBroadcast(production.id)).status).toBe(200);
      await expect.poll(() => output.slateText(), { timeout: 10_000 }).toContain(DE.slateStandby);

      // Letterboxing: a 4:3 viewport gives a 16:9 stage, black bars, no scrollbars.
      await output.page.setViewportSize({ width: 800, height: 600 });
      await expect
        .poll(async () => {
          const box = await (await output.stage()).boundingBox();
          return box ? [Math.round(box.width), Math.round(box.height)] : null;
        }, { message: 'stage 800 x 450 in an 800 x 600 frame' })
        .toEqual([800, 450]);
      const bar = (await output.viewportPixels()).pixel(400, 20);
      expect([bar[0], bar[1], bar[2]], 'the bar is black').toEqual([0, 0, 0]);
      const scroll = await output.page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, sh: document.documentElement.scrollHeight, ch: document.documentElement.clientHeight }));
      expect(scroll.sw).toBeLessThanOrEqual(scroll.cw);
      expect(scroll.sh).toBeLessThanOrEqual(scroll.ch);
    },
  );
});
