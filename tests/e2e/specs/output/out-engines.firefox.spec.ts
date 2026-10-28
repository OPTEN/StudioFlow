import { chromium, type BrowserContext } from '@playwright/test';
import { TEXT } from '../../support/text';
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

/** Whether this Firefox can receive H.264 over WebRTC (asked on a blank page of the output context). */
async function decodesH264(context: BrowserContext): Promise<boolean> {
  const page = await context.newPage();
  try {
    return await page.evaluate(() => (RTCRtpReceiver.getCapabilities('video')?.codecs ?? []).some((codec) => /\/h264$/i.test(codec.mimeType)));
  } finally {
    await page.close();
  }
}

/**
 * Makes a Chromium sender say that its VP9 encoder is power efficient. A laptop sends its screen as VP9 only then and as
 * H.264 otherwise (packages/media-client/src/screen-codec.ts); the headless Chromium of the harness has no hardware
 * encoder, so its screens are H.264, which a Firefox without OpenH264 cannot show.
 */
async function preferVp9Screens(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    const capabilities = navigator.mediaCapabilities;
    const encodingInfo = capabilities.encodingInfo.bind(capabilities);
    capabilities.encodingInfo = async (configuration) =>
      /vp9/i.test(configuration.video?.contentType ?? '') ? { supported: true, smooth: true, powerEfficient: true, configuration } : encodingInfo(configuration);
  });
}

test.describe('OUT other engines (Firefox)', () => {
  test(
    'E2E-OUT-17 [firefox] the output renders and plays a camera and a screen, keeps the last frame when the source goes away, shows the slates and letterboxes a 4:3 frame',
    t.p1,
    async ({ browser, api, production, pairContext, config, browserName, onCleanup }) => {
      test.setTimeout(240_000);
      expect(browserName).toBe('firefox');
      const senders = await chromium.launch({ args: CHROMIUM_ARGS });
      let vp9Screens = false;
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
          if (vp9Screens) await preferVp9Screens(laptop.context);
          onCleanup(() => laptop.close());
          return laptop;
        },
      };
      // Firefox: no camera/microphone permissions in the context options (it rejects them), the probe and the init script as in Chromium.
      const context = await browser.newContext({ baseURL: config.baseURL, ignoreHTTPSErrors: true, locale: 'en-US', timezoneId: 'Europe/Zurich', viewport: { width: 1280, height: 720 } });
      onCleanup(() => context.close());
      await installInitScript(context);
      await installProbe(context);
      await installUiInit(context, { testHooks: false });

      // Phones publish H.264 only, and so do laptops unless their VP9 encoder is a hardware one (the harness has none). A Firefox
      // without the OpenH264 plugin (the Playwright build on Linux; a desktop Firefox downloads the plugin itself) cannot
      // decode H.264: there both screens are published as VP9 and the moving item is a second laptop screen instead of a phone.
      const h264 = await decodesH264(context);
      vp9Screens = !h264;
      test.info().annotations.push({
        type: 'environment',
        description: h264 ? 'Firefox decodes H.264: the moving item is a phone camera.' : 'Firefox without an H.264 decoder (no OpenH264): both screens are published as VP9 and the moving item is a laptop screen.',
      });
      const moving = h264 ? await addCamera(deps, 'Camera Fox') : await addScreens(deps, 'Laptop Fox 2', 1);
      const movingSource = 'phone' in moving ? moving.source : moving.sources[0]!;
      const movingPage = 'phone' in moving ? moving.phone.page : moving.laptop.page;
      const screens = await addScreens(deps, 'Laptop Fox', 1);
      const scene = production.sceneIds[0]!;
      const cameraItem = await placeItem(api, production, scene, movingSource, { x: 0, y: 0, w: 1280, h: 720, fit: 'cover', radius: 0, holdMs: 1500 });
      await placeItem(api, production, scene, screens.sources[0]!, { x: 1300, y: 0, w: 600, h: 338, fit: 'contain', radius: 0 });
      const output = await OutputPage.open(context, production, {}, { viewport: { width: 1280, height: 720 } });
      const probe = new OutputProbe(output);
      await expect.poll(() => output.slateText(), { timeout: 20_000 }).toContain(TEXT.slate.standby);
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

      // The picture is the one of the sources: the screen's red in its item, a moving picture in the other one.
      const stage = await output.stagePixels();
      expect(toneOf(stage.mean({ x: 1380, y: 80, width: 440, height: 200 })), 'S1 (red) in the screen item').toBe('red');
      expect(stage.image.meanLuma(), 'not black').toBeGreaterThan(20);

      // Hold frame: the sender goes away, the last frame stays, later it is darkened.
      await movingPage.close();
      await probe.waitForItemState(cameraItem.id, 'hold', 30_000);
      const hold = await probe.snapshot(true);
      expect(hold.items.find((item) => item.id === cameraItem.id)!.luma, 'the hold frame is not black').toBeGreaterThan(15);
      await probe.waitForItemState(cameraItem.id, 'held', 10_000);
      const held = await output.frame().then((frame) => frame.evaluate((id) => {
        const root = document.querySelector(`[data-item-id="${id}"]`)!;
        return { text: root.querySelector('.sf-r-held-text')?.textContent, display: getComputedStyle(root.querySelector('.sf-r-held')!).display };
      }, cameraItem.id));
      expect(held.display).toBe('flex');
      expect(held.text).toBe(TEXT.slate.held);

      // End slate and standby slate.
      expect((await api.endBroadcast(production.id)).status).toBe(200);
      await expect.poll(() => output.slateText(), { timeout: 10_000 }).toContain(TEXT.slate.end);
      expect((await api.resetBroadcast(production.id)).status).toBe(200);
      await expect.poll(() => output.slateText(), { timeout: 10_000 }).toContain(TEXT.slate.standby);

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
