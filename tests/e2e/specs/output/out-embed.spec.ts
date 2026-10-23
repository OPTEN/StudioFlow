import { DE } from '../../support/constants';
import { stackConfig } from '../../support/env';
import { expect, test } from '../../support/ui/fixtures';
import { EMBED_ORIGIN, FOREIGN_ORIGIN, newUiContext } from '../../support/ui/init';
import { OutputPage, outputPath } from '../../support/ui/output';
import { colorsClose } from '../../support/ui/pixels';
import { GROUND, sleep, toneOf } from '../../support/output/analysis';
import { OutputProbe } from '../../support/output/probe';
import { openProbedOutput, waitForReportedPicture } from '../../support/output/open';
import { audioFlowing } from '../../support/output/rtc';
import { recordMeasurement } from '../../support/output/stats';
import { FULL, addCamera, addScreens, goLive, placeItem } from '../../support/output/world';
import { t } from '../../support/tags';

/**
 * The output page in the places it is used: inside an iframe of the proxy product, in frames of every shape, on a
 * transparent background for overlays, with a light page weight and silent (docs/testing.md E2E-OUT-03, -04, -16, -18,
 * -24). The iframes sit on the fake origin https://embed.test, which STUDIOFLOW_FRAME_ANCESTORS of the test stack lists.
 */

const SIZES: Array<{ name: string; width: number; height: number }> = [
  { name: '16:9 1920x1080', width: 1920, height: 1080 },
  { name: '16:9 1280x720', width: 1280, height: 720 },
  { name: '4:3 800x600', width: 800, height: 600 },
  { name: '21:9 1680x720', width: 1680, height: 720 },
  { name: 'tiny 160x90', width: 160, height: 90 },
  { name: 'portrait 600x1000', width: 600, height: 1000 },
  { name: 'square 10x10', width: 10, height: 10 },
  { name: '4K 3840x2160', width: 3840, height: 2160 },
];

/** The stage box a frame of this size must produce: uniform scale, centred. */
function expectedStage(width: number, height: number) {
  const scale = Math.min(width / 1920, height / 1080);
  return { scale, width: 1920 * scale, height: 1080 * scale, x: (width - 1920 * scale) / 2, y: (height - 1080 * scale) / 2 };
}

test.describe('OUT embedding', () => {
  test(
    'E2E-OUT-03 [output, letterboxing] the 16:9 stage is centred and black-barred in iframes of 16:9, 4:3, 21:9, 160x90, 3840x2160 ..., re-fits on resize, nothing scrolls, the picture is not distorted; a foreign origin cannot frame it',
    t.p0,
    async ({ browser, api, production, pairContext, openPhone, openLaptop, onCleanup }) => {
      test.setTimeout(300_000);
      const deps = { api, production, pairContext, openPhone, openLaptop };
      const camera = await addCamera(deps, 'Kamera Eins');
      const item = await placeItem(api, production, production.sceneIds[0]!, camera.source, FULL);
      await goLive(api, production);

      const { output } = await openProbedOutput({ browser, onCleanup }, production, {}, { embed: { size: { width: 1280, height: 720 } } });
      await output.waitForPlayingVideos(1, { minFps: 8, timeout: 45_000 });
      const frame = await output.frame();
      const refits: Array<{ size: string; frames: number }> = [];

      for (const size of SIZES) {
        await output.resizeFrame(size);
        // Re-fit: how many animation frames of the output document pass until the stage has the expected box.
        const want = expectedStage(size.width, size.height);
        const frames = await frame.evaluate(
          (expected) =>
            new Promise<number>((resolve) => {
              let count = 0;
              const stage = document.querySelector('.sf-r-stage') as HTMLElement;
              const check = () => {
                const box = stage.getBoundingClientRect();
                const ok = Math.abs(box.width - expected.width) <= 1 && Math.abs(box.height - expected.height) <= 1;
                if (ok || count > 30) resolve(ok ? count : -1);
                else {
                  count += 1;
                  requestAnimationFrame(check);
                }
              };
              requestAnimationFrame(check);
            }),
          want,
        );
        refits.push({ size: size.name, frames });
        expect(frames, `${size.name}: the stage re-fits (animation frames until it matches)`).toBeGreaterThanOrEqual(0);
        expect(frames, `${size.name}: re-fit within a few animation frames of the output document`).toBeLessThanOrEqual(4);

        const iframeBox = (await output.iframe().boundingBox())!;
        const stageBox = (await (await output.stage()).boundingBox())!;
        expect(Math.abs(stageBox.width - want.width), `${size.name}: stage width ${stageBox.width} vs ${want.width}`).toBeLessThanOrEqual(1);
        expect(Math.abs(stageBox.height - want.height), `${size.name}: stage height`).toBeLessThanOrEqual(1);
        expect(Math.abs(stageBox.x - iframeBox.x - want.x), `${size.name}: centred horizontally`).toBeLessThanOrEqual(1);
        expect(Math.abs(stageBox.y - iframeBox.y - want.y), `${size.name}: centred vertically`).toBeLessThanOrEqual(1);
        expect(Math.abs(stageBox.width / stageBox.height - 16 / 9), `${size.name}: 16:9`).toBeLessThanOrEqual(size.width < 100 ? 0.4 : 0.02);

        // No scrollbars, nothing larger than the frame.
        const scroll = await frame.evaluate(() => ({
          sw: document.documentElement.scrollWidth,
          cw: document.documentElement.clientWidth,
          sh: document.documentElement.scrollHeight,
          ch: document.documentElement.clientHeight,
          bw: document.body.scrollWidth,
          bh: document.body.scrollHeight,
        }));
        expect(scroll.sw, `${size.name}: no horizontal scroll`).toBeLessThanOrEqual(scroll.cw);
        expect(scroll.sh, `${size.name}: no vertical scroll`).toBeLessThanOrEqual(scroll.ch);

        // Bars are black: sample the middle of the bar on the long side of the frame (when there is one).
        if (size.width >= 100) {
          const shot = await output.viewportPixels();
          const left = Math.round(iframeBox.x);
          const top = Math.round(iframeBox.y);
          if (want.y > 4) {
            const bar = shot.pixel(left + size.width / 2, top + Math.min(want.y / 2, 40));
            expect([bar[0], bar[1], bar[2]], `${size.name}: letterbox bar is black`).toEqual([0, 0, 0]);
          }
          if (want.x > 4) {
            const bar = shot.pixel(left + Math.min(want.x / 2, 40), top + size.height / 2);
            expect([bar[0], bar[1], bar[2]], `${size.name}: pillarbox bar is black`).toEqual([0, 0, 0]);
          }
        }
        // Undistorted and still playing: the item box keeps the aspect of its canvas rectangle (16:9), frames advance.
        const items = await output.items();
        const box = items.find((entry) => entry.id === item.id)!.box;
        expect(Math.abs(box.width / box.height - 16 / 9), `${size.name}: the item is not distorted`).toBeLessThanOrEqual(size.width < 100 ? 0.4 : 0.02);
        const video = (await output.videos()).first();
        const playing = await video.evaluate(async (element: HTMLVideoElement) => {
          const before = element.getVideoPlaybackQuality().totalVideoFrames;
          await new Promise((resolve) => setTimeout(resolve, 600));
          return { frames: element.getVideoPlaybackQuality().totalVideoFrames - before, aspect: element.videoWidth / element.videoHeight };
        });
        expect(playing.frames, `${size.name}: the video keeps playing across the resize`).toBeGreaterThan(3);
        expect(Math.abs(playing.aspect - 16 / 9), 'the camera picture is 16:9').toBeLessThan(0.02);
      }
      await recordMeasurement(test.info(), 'out-03-refit', { refits }, refits.map((entry) => `${entry.size}: ${entry.frames}`).join(', '));
      expect(output.problems.cspViolations, 'no frame-ancestors violation for the allowed origin').toEqual([]);
      expect(output.problems.pageErrors).toEqual([]);

      // The same at a device pixel ratio of 2.
      const retina = await openProbedOutput({ browser, onCleanup }, production, {}, { context: { context: { deviceScaleFactor: 2 } }, embed: { size: { width: 800, height: 600 } } });
      await retina.output.waitForPlayingVideos(1, { minFps: 8, timeout: 45_000 });
      for (const size of [{ width: 800, height: 600 }, { width: 1680, height: 720 }, { width: 640, height: 360 }]) {
        await retina.output.resizeFrame(size);
        const want = expectedStage(size.width, size.height);
        await expect
          .poll(async () => {
            const box = (await (await retina.output.stage()).boundingBox())!;
            return [Math.round(box.width), Math.round(box.height)];
          }, { message: `dpr 2, ${size.width}x${size.height}: stage box in CSS pixels` })
          .toEqual([Math.round(want.width), Math.round(want.height)]);
        expect(await retina.output.page.evaluate(() => window.devicePixelRatio)).toBe(2);
      }

      // Not allowed: an origin that STUDIOFLOW_FRAME_ANCESTORS does not list gets no output.
      const context = await newUiContext(browser);
      onCleanup(() => context.close());
      const foreign = await OutputPage.embed(context, production, { origin: FOREIGN_ORIGIN, waitForFrame: false, size: { width: 640, height: 360 } });
      await expect
        .poll(() => foreign.page.frames().map((candidate) => candidate.url()), { message: 'the foreign origin cannot frame the output', timeout: 15_000 })
        .toContainEqual(expect.stringMatching(/^chrome-error:/));
      expect(foreign.page.frames().some((candidate) => candidate.url().startsWith(foreign.config.baseURL))).toBe(false);
      expect(foreign.problems.cspViolations.length, 'the browser reported the refusal').toBeGreaterThan(0);
      // The header says so: frame-ancestors lists the stack itself and the allowed embedders, not the foreign origin.
      const header = (await fetch(`${stackConfig().baseURL}${outputPath(production)}`)).headers.get('content-security-policy') ?? '';
      expect(header).toMatch(/frame-ancestors [^;]*'self'/);
      expect(header).toContain(EMBED_ORIGIN);
      expect(header).not.toContain(FOREIGN_ORIGIN);
    },
  );

  test(
    'E2E-OUT-04 [output, bg=transparent] page, stage and scene colour are transparent so a red host page shows through; contain bars stay opaque; slates are not affected',
    t.p1,
    async ({ browser, api, production, pairContext, openPhone, openLaptop, onCleanup }) => {
      test.setTimeout(180_000);
      const deps = { api, production, pairContext, openPhone, openLaptop };
      const screens = await addScreens(deps, 'Laptop Farben', 1);
      const scene = production.sceneIds[0]!;
      // A 16:9 screen in a 600 x 600 item with contain fit (bars above and below), on a scene with a background colour.
      await api.updateScene(production.id, scene, { background: { color: '#102030', assetId: null } });
      await placeItem(api, production, scene, screens.sources[0]!, { x: 660, y: 240, w: 600, h: 600, fit: 'contain', radius: 0 });

      // Standby first: the slate is opaque even with bg=transparent (it is not part of the transparent stage).
      const { output, probe } = await openProbedOutput({ browser, onCleanup }, production, { transparent: true }, { embed: { size: { width: 800, height: 600 }, hostBackground: '#ff0000' } });
      const frame = await output.frame();
      await expect.poll(async () => (await probe.snapshot()).slate?.opacity, { timeout: 15_000 }).toBe(1);
      const standby = await output.viewportPixels();
      const box = (await output.iframe().boundingBox())!;
      // The 4:3 frame letterboxes the 16:9 stage: bars above and below show the host page (red).
      const barTop = standby.pixel(box.x + 400, box.y + 20);
      expect(colorsClose(barTop, '#ff0000', 6), `the letterbox bar shows the red host, got ${barTop}`).toBe(true);
      const slatePixel = standby.pixel(box.x + 400, box.y + 560 / 2 + 150);
      expect(Math.hypot(slatePixel[0] - GROUND[0], slatePixel[1] - GROUND[1], slatePixel[2] - GROUND[2]), 'the standby slate is opaque').toBeLessThanOrEqual(8);

      await goLive(api, production);
      await output.waitForPlayingVideos(1, { minFps: 5, timeout: 45_000 });
      await expect.poll(async () => (await probe.snapshot()).slate, { timeout: 5000 }).toBeNull();
      await sleep(400);
      const computed = await frame.evaluate(() => ({
        html: getComputedStyle(document.documentElement).backgroundColor,
        body: getComputedStyle(document.body).backgroundColor,
        viewport: getComputedStyle(document.querySelector('.sf-r-viewport')!).backgroundColor,
        stage: getComputedStyle(document.querySelector('.sf-r-stage')!).backgroundColor,
        layer: getComputedStyle(document.querySelector('.sf-r-layer')!).backgroundColor,
        isTransparent: document.documentElement.classList.contains('is-transparent'),
      }));
      for (const [name, value] of Object.entries(computed).filter(([key]) => key !== 'isTransparent')) expect(value, `${name} background`).toBe('rgba(0, 0, 0, 0)');
      expect(computed.isTransparent).toBe(true);

      const live = await output.viewportPixels({ omitBackground: true });
      const stageBox = (await (await output.stage()).boundingBox())!;
      const at = (canvasX: number, canvasY: number) => live.pixel(stageBox.x + (canvasX / 1920) * stageBox.width, stageBox.y + (canvasY / 1080) * stageBox.height);
      // Scene background (#102030) is not drawn: the host shows through at (100,100) of the canvas ...
      expect(colorsClose(at(100, 100), '#ff0000', 6), `scene background is transparent, got ${at(100, 100)}`).toBe(true);
      // ... the contain bars of the item stay opaque (#0a0d12) ...
      expect(colorsClose(at(960, 262), '#0a0d12', 8), `contain bar above the picture is opaque, got ${at(960, 262)}`).toBe(true);
      // ... and the picture itself is there.
      expect(toneOf(at(960, 540)), 'the screen picture in the item').toBe('red');
      // Opaque in the DOM, too: transparency is a property of the page, not of the video.
      const withoutParam = await openProbedOutput({ browser, onCleanup }, production, {}, { embed: { size: { width: 800, height: 600 }, hostBackground: '#ff0000' } });
      await withoutParam.output.waitForPlayingVideos(1, { minFps: 5, timeout: 45_000 });
      const opaque = await withoutParam.output.viewportPixels();
      const opaqueBox = (await withoutParam.output.iframe().boundingBox())!;
      const bar = opaque.pixel(opaqueBox.x + 400, opaqueBox.y + 20);
      expect([bar[0], bar[1], bar[2]], 'without the parameter the letterbox is black').toEqual([0, 0, 0]);
    },
  );

  test(
    'E2E-OUT-16 [output, embedded like the proxy] iframe with allow="autoplay; fullscreen", width 100 % and aspect-ratio 16/9: autoplay without a click, fullscreen permitted, same picture as standalone',
    t.p1,
    async ({ browser, api, production, pairContext, openPhone, openLaptop, onCleanup }) => {
      test.setTimeout(180_000);
      const deps = { api, production, pairContext, openPhone, openLaptop };
      const screens = await addScreens(deps, 'Laptop Farben', 1);
      await placeItem(api, production, production.sceneIds[0]!, screens.sources[0]!, FULL);
      await goLive(api, production);
      const { output: embedded } = await openProbedOutput({ browser, onCleanup }, production, {}, { embed: { size: { width: 960, height: 540 }, title: 'Webinar Q4 live' } });
      const page = embedded.page;
      // The proxy's markup: width 100 % of its column and aspect-ratio 16/9 instead of pixel sizes.
      await page.setViewportSize({ width: 1000, height: 700 });
      await page.locator('#output-frame').evaluate((element: HTMLIFrameElement) => {
        element.style.cssText = 'border:0;display:block;width:100%;aspect-ratio:16/9;height:auto';
      });
      // Wait for the picture without any script in the output frame (Playwright's evaluate() counts as a user gesture).
      await waitForReportedPicture(api, production);
      expect(await new OutputProbe(embedded).activationAtFirstPlay(), 'no user gesture before the first video played').toBe(false);
      const frame = await embedded.frame();
      await embedded.waitForPlayingVideos(1, { minFps: 5, timeout: 45_000 });
      // Permissions policy: fullscreen and autoplay are allowed in the frame, there is no sandbox on the iframe.
      const policy = await frame.evaluate(() => {
        const doc = document as unknown as { permissionsPolicy?: { allowsFeature(name: string): boolean }; featurePolicy?: { allowsFeature(name: string): boolean } };
        const features = doc.permissionsPolicy ?? doc.featurePolicy;
        return { fullscreenEnabled: document.fullscreenEnabled, fullscreen: features?.allowsFeature('fullscreen'), autoplay: features?.allowsFeature('autoplay') };
      });
      expect(policy.fullscreenEnabled, 'document.fullscreenEnabled').toBe(true);
      expect(policy.fullscreen, 'permissions policy: fullscreen').toBe(true);
      expect(policy.autoplay, 'permissions policy: autoplay').toBe(true);
      expect(await page.locator('#output-frame').getAttribute('sandbox'), 'no sandbox needed').toBeNull();
      expect(await page.locator('#output-frame').getAttribute('allow'), 'the proxy markup').toBe('autoplay; fullscreen');
      // Fullscreen on the iframe works after a click on the host page (a real user gesture).
      await page.mouse.click(30, 30);
      const fullscreen = await page.evaluate(async () => {
        const element = document.getElementById('output-frame') as HTMLIFrameElement;
        try {
          await element.requestFullscreen();
          return { ok: document.fullscreenElement === element, error: '' };
        } catch (error) {
          return { ok: false, error: String(error) };
        }
      });
      expect(fullscreen.ok, `fullscreen: ${fullscreen.error}`).toBe(true);
      await page.evaluate(() => document.exitFullscreen());
      // The picture is the one of the standalone page.
      const stage = await embedded.stagePixels();
      expect(toneOf(stage.mean({ x: 600, y: 400, width: 700, height: 300 })), 'embedded stage shows S1').toBe('red');
      const direct = await openProbedOutput({ browser, onCleanup }, production, {}, { viewport: { width: 960, height: 540 } });
      await direct.output.waitForPlayingVideos(1, { minFps: 5 });
      expect(toneOf((await direct.output.stagePixels()).mean({ x: 600, y: 400, width: 700, height: 300 })), 'standalone stage shows S1').toBe('red');
    },
  );

  test(
    'E2E-OUT-18 [output, page weight] a cold load transfers <= 350 KB of HTML, JS and CSS (compressed), makes no third-party request and answers within the T-LOAD limits',
    t.p1,
    async ({ browser, production, config, onCleanup }) => {
      const context = await newUiContext(browser);
      onCleanup(() => context.close());
      const page = await context.newPage();
      const cdp = await context.newCDPSession(page);
      await cdp.send('Network.enable');
      await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
      const requests = new Map<string, { url: string; type: string; encoding: string; bytes: number }>();
      cdp.on('Network.responseReceived', (event: { requestId: string; type: string; response: { url: string; headers: Record<string, string> } }) => {
        requests.set(event.requestId, { url: event.response.url, type: event.type, encoding: event.response.headers['content-encoding'] ?? event.response.headers['Content-Encoding'] ?? '', bytes: 0 });
      });
      cdp.on('Network.loadingFinished', (event: { requestId: string; encodedDataLength: number }) => {
        const entry = requests.get(event.requestId);
        if (entry) entry.bytes = event.encodedDataLength;
      });
      await page.goto(outputPath(production));
      await expect.poll(() => page.evaluate(() => document.querySelector('.sf-r-slate-title')?.textContent ?? ''), { timeout: 10_000 }).toContain(DE.slateStandby);
      await sleep(4000); // livekit-client is loaded after the first frame
      const all = [...requests.values()];
      const counted = all.filter((entry) => ['Document', 'Script', 'Stylesheet'].includes(entry.type));
      const total = counted.reduce((sum, entry) => sum + entry.bytes, 0);
      const origins = new Set(all.map((entry) => new URL(entry.url)).filter((url) => url.protocol.startsWith('http')).map((url) => url.origin));
      const timing = await page.evaluate(() => {
        const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
        return { load: nav.loadEventEnd, dcl: nav.domContentLoadedEventEnd, transfer: nav.transferSize };
      });
      await recordMeasurement(
        test.info(),
        'out-18-weight',
        { totalBytes: total, files: counted.map((entry) => ({ url: entry.url.replace(config.baseURL, ''), type: entry.type, encoding: entry.encoding, bytes: entry.bytes })), allRequests: all.length, timing },
        `${Math.round(total / 1024)} KB of HTML/JS/CSS in ${counted.length} files (${[...new Set(counted.map((entry) => entry.encoding || 'identity'))].join('/')}); load ${Math.round(timing.load)} ms`,
      );
      expect(counted.length, 'document, script and stylesheet were seen').toBeGreaterThanOrEqual(3);
      expect(total, 'T-LOAD hard limit 350 KB (spec 9.3) including livekit-client').toBeLessThanOrEqual(350 * 1024);
      expect(counted.filter((entry) => entry.encoding === '' && entry.bytes > 20_000), 'every large text file is compressed').toEqual([]);
      expect([...origins], 'zero third-party requests').toEqual([new URL(config.baseURL).origin]);
      expect(timing.load, 'load event (T-LOAD hard 2 s)').toBeLessThanOrEqual(2000);
    },
  );

  test(
    'E2E-OUT-24 [output, silent] muted videos, no audio element, no microphone or capture request, no autoplay warning, no button',
    t.p2,
    async ({ browser, api, production, pairContext, openPhone, openLaptop, onCleanup }) => {
      test.setTimeout(180_000);
      const deps = { api, production, pairContext, openPhone, openLaptop };
      const camera = await addCamera(deps, 'Kamera Eins');
      await placeItem(api, production, production.sceneIds[0]!, camera.source, FULL);
      await goLive(api, production);
      const { output } = await openProbedOutput({ browser, onCleanup }, production, {}, { embed: { size: { width: 1280, height: 720 } } });
      await output.waitForPlayingVideos(1, { minFps: 8, timeout: 45_000 });
      await sleep(3000);
      const frame = await output.frame();
      const facts = await frame.evaluate(() => {
        const media = (window as unknown as { __sfMedia?: { userMediaCalls: unknown[]; displayCalls: number } }).__sfMedia;
        return {
          videos: [...document.querySelectorAll('video')].map((video) => ({ muted: video.muted, volume: video.volume, tracksWithAudio: ((video.srcObject as MediaStream | null)?.getAudioTracks().length ?? 0) })),
          audioElements: document.querySelectorAll('audio').length,
          buttons: document.querySelectorAll('button, [role=button]').length,
          text: document.body.innerText,
          userMedia: media?.userMediaCalls.length ?? -1,
          display: media?.displayCalls ?? -1,
        };
      });
      expect(facts.videos.length).toBeGreaterThan(0);
      expect(facts.videos.every((video) => video.muted && video.tracksWithAudio === 0), 'muted video elements without an audio track').toBe(true);
      expect(facts.audioElements, 'no <audio> element').toBe(0);
      expect(facts.userMedia, 'no getUserMedia call (the init script counts them)').toBe(0);
      expect(facts.display, 'no getDisplayMedia call').toBe(0);
      expect(facts.buttons).toBe(0);
      expect(facts.text, 'no «Ton an» button or text').not.toMatch(/Ton/);
      expect(await audioFlowing(frame), 'no audio RTP stream receives packets').toBe(0);
      expect([...output.problems.consoleErrors, ...output.problems.cspViolations].filter((text) => /autoplay|play\(\)|NotAllowed/i.test(text)), 'no autoplay-policy warning').toEqual([]);
    },
  );
});
