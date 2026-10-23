import { generateSamples } from '../../support/media-samples';
import { stackConfig } from '../../support/env';
import { OutputHub, StudioHub } from '../../support/hubs';
import { expect, test } from '../../support/ui/fixtures';
import { sleep } from '../../support/output/analysis';
import { outBug } from '../../support/output/bugs';
import { openProbedOutput, recordHubFrames, type HubMessage } from '../../support/output/open';
import { inboundOf, inboundVideo, trackSids } from '../../support/output/rtc';
import { fmt, recordMeasurement, summarize } from '../../support/output/stats';
import { FULL, addCamera, addScreens, goLive, placeItem, switchProgram } from '../../support/output/world';
import { firstEvent } from '../../support/output/analysis';
import { t } from '../../support/tags';

/**
 * What the output page receives and reports (docs/testing.md E2E-OUT-05, -15, -19, -20, -21, -22, -23, E2E-SWITCH-10):
 * the debug overlay, assets served with the output key, the 2 s reports, the simulcast layer the page asks the SFU for,
 * the tracks it subscribes to and several consumers at once.
 */

test.describe('OUT media and reports', () => {
  test(
    'E2E-OUT-05 [output, debug=1] the overlay shows scene, revision, connections, per-source size, fps, bitrate and latency; updates every second; absent without the parameter',
    t.p1,
    async ({ browser, api, production, pairContext, openPhone, openLaptop, onCleanup }) => {
      test.setTimeout(180_000);
      const deps = { api, production, pairContext, openPhone, openLaptop };
      const camera = await addCamera(deps, 'Kamera Eins');
      await placeItem(api, production, production.sceneIds[0]!, camera.source, FULL);
      await goLive(api, production);
      const { output } = await openProbedOutput({ browser, onCleanup }, production, { debug: true }, { viewport: { width: 1280, height: 720 } });
      await output.waitForPlayingVideos(1, { minFps: 8, timeout: 45_000 });
      const frame = await output.frame();
      const panel = frame.locator('pre.c-debug');
      await expect(panel).toHaveCount(1);
      const style = await panel.evaluate((element) => {
        const css = getComputedStyle(element);
        return { position: css.position, pointerEvents: css.pointerEvents, fontFamily: css.fontFamily, ariaHidden: element.getAttribute('aria-hidden'), userSelect: css.userSelect };
      });
      expect(style.position, 'fixed, so the stage never moves').toBe('fixed');
      expect(style.pointerEvents).toBe('none');
      expect(style.fontFamily, 'mono font').toMatch(/JetBrains Mono|monospace|Consolas/);
      expect(style.ariaHidden).toBe('true');

      const sceneName = (await api.getSnapshot(production.id)).body.scenes.find((scene) => scene.id === production.sceneIds[0])!.name;
      await expect
        .poll(async () => (await output.debugLines()).length, { message: 'overlay lines (scene, revision, hub, livekit, latency, source)', timeout: 15_000 })
        .toBeGreaterThanOrEqual(6);
      const lines = await output.debugLines();
      expect(lines[0], 'production and scene').toBe(`${production.name} · Szene «${sceneName}»`);
      expect(lines[1], 'revision and broadcast').toMatch(/^Revision \d+ · Sendung live$/);
      expect(lines[2], 'hub and sync state').toBe('Hub verbunden · Sync aktuell');
      expect(lines[3], 'LiveKit state').toBe('LiveKit verbunden');
      expect(lines[4], 'latency estimate and renderer fps').toMatch(/^Latenz ≈ \d+ ms · Renderer \d+ fps$/);
      expect(lines[5], 'per source: code, name, size, fps, bitrate, loss, buffer').toMatch(new RegExp(`^${camera.code} Kamera Eins · \\d+×\\d+ · \\d+ fps · [\\d,]+ Mbit/s · Verlust [\\d,]+ % · Puffer \\d+ ms$`));

      // Values match the video element and the API (the picture size may still grow through simulcast layers).
      await expect
        .poll(async () => {
          const size = await (await output.videos()).first().evaluate((video: HTMLVideoElement) => `${video.videoWidth}×${video.videoHeight}`);
          return (await output.debugLines()).find((line) => line.startsWith(camera.code))?.includes(` · ${size} · `) ?? false;
        }, { timeout: 15_000, message: 'the size in the overlay equals videoWidth x videoHeight' })
        .toBe(true);
      await expect
        .poll(async () => {
          const revision = Number(/^Revision (\d+)/.exec((await output.debugLines())[1] ?? '')?.[1]);
          return revision === (await api.getSnapshot(production.id)).body.revision;
        }, { timeout: 15_000, message: 'the revision in the overlay is the revision of the API' })
        .toBe(true);

      // It updates at least every second and follows the program.
      const texts = new Set<string>();
      const changes: number[] = [];
      let last = '';
      const end = Date.now() + 6000;
      while (Date.now() < end) {
        const text = (await output.debugLines()).join('\n');
        if (text !== last) {
          changes.push(Date.now());
          last = text;
        }
        texts.add(text);
        await sleep(150);
      }
      const gaps = changes.slice(1).map((time, index) => time - changes[index]!);
      expect(texts.size, 'the overlay changes while the picture runs').toBeGreaterThanOrEqual(3);
      expect(Math.max(...gaps), 'no pause longer than 3 s between updates').toBeLessThanOrEqual(3000);
      const other = production.sceneIds[1]!;
      await switchProgram(api, production, other);
      const otherName = (await api.getSnapshot(production.id)).body.scenes.find((scene) => scene.id === other)!.name;
      await expect.poll(async () => (await output.debugLines())[0], { timeout: 4000 }).toBe(`${production.name} · Szene «${otherName}»`);
      expect((await output.debugLines()).some((line) => line.startsWith('Keine Kamera- oder Screen-Quelle')), 'an empty scene says so').toBe(true);

      // Without the parameter there is no overlay.
      const plain = await openProbedOutput({ browser, onCleanup }, production, {}, { viewport: { width: 1280, height: 720 } });
      await expect.poll(async () => (await plain.probe.snapshot()).layers.length).toBe(1);
      await sleep(1500);
      expect(await (await plain.output.frame()).locator('.c-debug').count(), 'no overlay without debug=1').toBe(0);
    },
  );

  test(
    'E2E-OUT-19 [output, assets] images and videos are served with ?k=<key> (200, 206 with Content-Range, private cache), play and loop; a refused key leaves the item invisible, retries and shows no broken image',
    t.p1,
    async ({ browser, api, production, onCleanup }) => {
      test.setTimeout(180_000);
      const samples = await generateSamples();
      const image = await api.uploadAsset(production.id, { fileName: 'Foto.jpg', contentType: 'image/jpeg', data: samples.photoJpg });
      const video = await api.uploadAsset(production.id, { fileName: 'Clip.mp4', contentType: 'video/mp4', data: samples.clipMp4 });
      expect(image.status, image.raw.text().slice(0, 200)).toBe(201);
      expect(video.status, video.raw.text().slice(0, 200)).toBe(201);
      const scene = production.sceneIds[0]!;
      await placeItem(api, production, scene, image.body.id, { x: 0, y: 0, w: 960, h: 540, fit: 'cover', radius: 0 });
      await placeItem(api, production, scene, video.body.id, { x: 960, y: 0, w: 960, h: 540, fit: 'cover', radius: 0 });
      await goLive(api, production);

      const responses: Array<{ url: string; status: number; range: string | null; cache: string | null; type: string | null; request: string }> = [];
      const opened = await openProbedOutput({ browser, onCleanup }, production, {}, {
        viewport: { width: 1920, height: 1080 },
        onPage: (page) =>
          page.on('response', (response) => {
            if (/\/assets\/[^/]+\/content/.test(response.url()))
              responses.push({ url: response.url(), status: response.status(), range: response.headers()['content-range'] ?? null, cache: response.headers()['cache-control'] ?? null, type: response.headers()['content-type'] ?? null, request: response.request().headers()['range'] ?? '' });
          }),
      });
      const { output } = opened;
      const frame = await output.frame();
      await expect
        .poll(() => frame.evaluate(() => {
          const img = document.querySelector('img.fs-r-media--image') as HTMLImageElement | null;
          const clip = document.querySelector('video.fs-r-media--video') as HTMLVideoElement | null;
          return Boolean(img && img.naturalWidth > 0 && getComputedStyle(img).visibility === 'visible' && clip && clip.readyState >= 2 && getComputedStyle(clip).visibility === 'visible');
        }), { timeout: 20_000, message: 'image visible, video loaded' })
        .toBe(true);
      const imageResponse = responses.find((entry) => entry.url.includes(image.body.id))!;
      const videoResponses = responses.filter((entry) => entry.url.includes(video.body.id));
      expect(imageResponse.url, 'the key travels in the query').toContain(`k=${encodeURIComponent(production.outputKey)}`);
      expect(imageResponse.status).toBe(200);
      expect(imageResponse.type).toBe('image/jpeg');
      expect(imageResponse.cache, 'asset cache policy').toBe('private, max-age=3600');
      expect(videoResponses.length, 'the video was requested').toBeGreaterThan(0);
      expect(videoResponses.every((entry) => entry.status === 206 && entry.range !== null && /^bytes \d+-\d+\/\d+$/.test(entry.range)), `video answers 206 with Content-Range: ${JSON.stringify(videoResponses.map((entry) => [entry.status, entry.range]))}`).toBe(true);
      expect(videoResponses[0]!.cache).toBe('private, max-age=3600');
      // The video plays and loops (the clip is 3 s long): its time wraps within 8 s.
      const loop = await frame.evaluate(async () => {
        const clip = document.querySelector('video.fs-r-media--video') as HTMLVideoElement;
        let previous = clip.currentTime;
        let wrapped = false;
        let advanced = false;
        for (let step = 0; step < 80; step++) {
          await new Promise((resolve) => setTimeout(resolve, 100));
          if (clip.currentTime < previous - 0.5) wrapped = true;
          if (clip.currentTime > previous) advanced = true;
          previous = clip.currentTime;
        }
        return { loop: clip.loop, wrapped, advanced, paused: clip.paused, duration: clip.duration };
      });
      expect(loop.loop, 'loop attribute').toBe(true);
      expect(loop.advanced && loop.wrapped && !loop.paused, `the video plays and loops: ${JSON.stringify(loop)}`).toBe(true);

      // A refused key: the same page with the key of the asset requests replaced.
      const refused: Array<{ status: number }> = [];
      const wrong = await openProbedOutput({ browser, onCleanup }, production, {}, {
        viewport: { width: 1920, height: 1080 },
        onPage: (page) => {
          void page.context().route(/\/assets\/[^/]+\/content/, (route) => {
            const url = new URL(route.request().url());
            url.searchParams.set('k', 'x'.repeat(43));
            return route.continue({ url: url.toString() });
          });
          page.on('response', (response) => {
            if (/\/assets\/[^/]+\/content/.test(response.url())) refused.push({ status: response.status() });
          });
        },
      });
      await expect.poll(() => refused.length, { timeout: 15_000, message: 'asset requests were made' }).toBeGreaterThanOrEqual(2);
      expect(new Set(refused.map((entry) => entry.status)), 'a wrong key is 403').toEqual(new Set([403]));
      const wrongFrame = await wrong.output.frame();
      const state = await wrongFrame.evaluate(() => ({
        image: getComputedStyle(document.querySelector('img.fs-r-media--image')!).visibility,
        video: getComputedStyle(document.querySelector('video.fs-r-media--video')!).visibility,
        imageNatural: (document.querySelector('img.fs-r-media--image') as HTMLImageElement).naturalWidth,
      }));
      expect(state.image, 'no broken-image icon: the image stays invisible').toBe('hidden');
      expect(state.video).toBe('hidden');
      expect(state.imageNatural).toBe(0);
      const before = refused.length;
      await sleep(4500);
      expect(refused.length, 'failed loads are retried with a backoff').toBeGreaterThan(before);
    },
  );

  test(
    'E2E-OUT-20 [output, reports] a report every 2 s with rendering, fps, latency and the program scene; outputStatusChanged is limited to once per 5 s unless a value changes by more than 20 %',
    t.p1,
    async ({ browser, api, production, config, pairContext, openPhone, openLaptop, onCleanup }) => {
      test.setTimeout(180_000);
      const deps = { api, production, pairContext, openPhone, openLaptop };
      const camera = await addCamera(deps, 'Kamera Eins');
      await placeItem(api, production, production.sceneIds[0]!, camera.source, FULL);
      await goLive(api, production);
      const studio = StudioHub.connect(config.baseURL, api.cookie);
      onCleanup(() => studio.stop());
      await studio.open(production.id);
      const frames: { sent: HubMessage[]; received: HubMessage[] } = { sent: [], received: [] };
      await openProbedOutput({ browser, onCleanup }, production, {}, {
        viewport: { width: 1280, height: 720 },
        onPage: (page) => Object.assign(frames, recordHubFrames(page)),
      });
      await expect.poll(() => frames.sent.filter((message) => message.target === 'Report').length, { timeout: 30_000, message: 'the first report' }).toBeGreaterThanOrEqual(1);
      const started = Date.now();
      await sleep(12_000);
      const reports = frames.sent.filter((message) => message.target === 'Report' && message.t >= started);
      const intervals = reports.slice(1).map((report, index) => report.t - reports[index]!.t);
      const payloads = reports.map((report) => (report.arguments as Array<{ rendering: boolean; fps: number | null; latencyMs: number | null; programSceneId: string | null }>)[0]!);
      await recordMeasurement(test.info(), 'out-20-reports', { count: reports.length, intervals, payloads }, `${reports.length} reports in 12 s, interval ${fmt(summarize(intervals))} ms, fps ${payloads.map((p) => p.fps).join('/')}, latency ${payloads.map((p) => p.latencyMs).join('/')}`);
      expect(reports.length, '~6 reports in 12 s').toBeGreaterThanOrEqual(5);
      expect(reports.length).toBeLessThanOrEqual(7);
      for (const interval of intervals) expect(Math.abs(interval - 2000), `interval ${interval} ms`).toBeLessThanOrEqual(500);
      for (const payload of payloads) {
        expect(payload.rendering).toBe(true);
        expect(payload.programSceneId, 'the scene the page shows').toBe(production.sceneIds[0]);
        // The product reports the animation frame rate of the page (about the display's refresh rate), not the content's 30 fps.
        expect(payload.fps, 'rendered frames per second').toBeGreaterThanOrEqual(20);
        expect(payload.fps!).toBeLessThanOrEqual(144);
        expect(payload.latencyMs, 'estimated latency').not.toBeNull();
        expect(payload.latencyMs!).toBeLessThan(300);
      }
      // outputStatusChanged reaches the Regie at most every 5 s, unless a value changed by more than 20 %.
      const statusEvents = studio
        .of('event')
        .filter((entry) => (entry.args[0] as { type: string }).type === 'outputStatusChanged')
        .map((entry) => ({ at: entry.at, status: (entry.args[0] as { status: { state: string; consumers: number; latencyMs: number | null; fps: number | null } }).status }));
      expect(statusEvents.length, 'the status reached the Regie').toBeGreaterThanOrEqual(1);
      for (let index = 1; index < statusEvents.length; index++) {
        const previous = statusEvents[index - 1]!;
        const current = statusEvents[index]!;
        const gap = current.at - previous.at;
        const changed = (a: number | null, b: number | null) => a === null || b === null ? a !== b : Math.abs(b - a) > 0.2 * Math.max(Math.abs(a), 1);
        const justified = current.status.state !== previous.status.state || current.status.consumers !== previous.status.consumers || changed(previous.status.latencyMs, current.status.latencyMs) || changed(previous.status.fps, current.status.fps);
        expect(gap >= 4500 || justified, `status events ${gap} ms apart need a >20 % change: ${JSON.stringify([previous.status, current.status])}`).toBe(true);
      }
    },
  );

  test(
    'E2E-OUT-21 [output, simulcast layers] the layer follows the item size in the program: full canvas -> highest, thumbnail -> lowest; a source only in another scene is at the lowest layer; screens have one layer',
    t.p1,
    async ({ browser, api, production, pairContext, openPhone, openLaptop, onCleanup }) => {
      test.setTimeout(240_000);
      const deps = { api, production, pairContext, openPhone, openLaptop };
      const k1 = await addCamera(deps, 'Kamera Eins');
      const k2 = await addCamera(deps, 'Kamera Zwei');
      const screens = await addScreens(deps, 'Laptop Farben', 1);
      const [a, b, c] = production.sceneIds as [string, string, string];
      await placeItem(api, production, a, k1.source, FULL);
      await placeItem(api, production, a, screens.sources[0]!, { x: 40, y: 40, w: 320, h: 180, radius: 0 });
      await placeItem(api, production, b, k1.source, { x: 1500, y: 700, w: 270, h: 152, fit: 'cover', radius: 0 });
      await placeItem(api, production, b, screens.sources[0]!, FULL);
      await placeItem(api, production, c, k2.source, FULL);
      await goLive(api, production);
      const { output } = await openProbedOutput({ browser, onCleanup }, production, {}, { viewport: { width: 1920, height: 1080 } });
      const frame = await output.frame();
      await output.waitForPlayingVideos(2, { minFps: 8, timeout: 45_000 });
      const width = async (source: string) => (await inboundOf(frame, production, source))?.frameWidth ?? 0;

      // Scene A: K1 full canvas.
      await expect.poll(() => width(k1.source), { timeout: 15_000, message: 'K1 full canvas -> highest layer (>= 1280 px)' }).toBeGreaterThanOrEqual(1280);
      // K2 is only in scene C: lowest layer.
      await expect.poll(() => width(k2.source), { timeout: 15_000, message: 'K2 (other scene) -> lowest layer (<= 360 px)' }).toBeLessThanOrEqual(360);
      expect(await width(k2.source)).toBeGreaterThan(0);
      // Screens have no simulcast: one layer, whatever the item size.
      expect(await width(screens.sources[0]!), 'S1 small in A: single layer').toBe(1280);

      // Scene B: K1 is a 270 px thumbnail -> the SFU is asked for the lowest layer.
      expect((await switchProgram(api, production, b)).status).toBe(200);
      await expect.poll(() => width(k1.source), { timeout: 15_000, message: 'K1 as a 270 px thumbnail -> <= 360 px' }).toBeLessThanOrEqual(360);
      expect(await width(screens.sources[0]!), 'S1 full in B: still the single layer').toBe(1280);
      // And back: the full canvas needs the highest layer again.
      expect((await switchProgram(api, production, a)).status).toBe(200);
      await expect.poll(() => width(k1.source), { timeout: 15_000, message: 'K1 full canvas again -> >= 1280 px' }).toBeGreaterThanOrEqual(1280);
    },
  );

  test(
    'E2E-SWITCH-10 [output, other scenes at the lowest layer] a camera that is neither in the program nor in the preview scene arrives at the lowest simulcast layer',
    t.p1,
    async ({ browser, api, production, pairContext, openPhone, openLaptop, onCleanup }) => {
      test.setTimeout(180_000);
      const deps = { api, production, pairContext, openPhone, openLaptop };
      const k1 = await addCamera(deps, 'Kamera Eins');
      const k2 = await addCamera(deps, 'Kamera Zwei');
      const [a, b] = production.sceneIds as [string, string];
      await placeItem(api, production, a, k1.source, FULL);
      await placeItem(api, production, b, k2.source, FULL);
      await goLive(api, production);
      const { output } = await openProbedOutput({ browser, onCleanup }, production, { debug: true }, { viewport: { width: 1920, height: 1080 } });
      await output.waitForPlayingVideos(1, { minFps: 8, timeout: 45_000 });
      const frame = await output.frame();
      await expect.poll(async () => (await inboundOf(frame, production, k2.source))?.frameWidth ?? 0, { timeout: 15_000 }).toBeGreaterThan(0);
      await sleep(3000);
      const k2Width = (await inboundOf(frame, production, k2.source))!.frameWidth;
      expect(k2Width, 'K2 is only in scene B (not live, no preview): lowest layer').toBeLessThanOrEqual(360);
      expect((await inboundOf(frame, production, k1.source))!.frameWidth, 'K1 is in the program at full canvas: highest layer').toBeGreaterThanOrEqual(1280);
    },
  );

  test(
    'E2E-SWITCH-10 [output, preview at the highest layer] the camera of the preview scene is preloaded at the highest layer within 3 s of selecting the preview',
    t.p1,
    async ({ browser, api, production, pairContext, openPhone, openLaptop, onCleanup }) => {
      outBug('OUT-03', 'the output preloads the sources of the preview scene at the lowest layer (320x180), spec 7 asks for the highest ("preview scene items -> HIGH")');
      test.setTimeout(180_000);
      const deps = { api, production, pairContext, openPhone, openLaptop };
      const k1 = await addCamera(deps, 'Kamera Eins');
      const k2 = await addCamera(deps, 'Kamera Zwei');
      const [a, b] = production.sceneIds as [string, string];
      await placeItem(api, production, a, k1.source, FULL);
      await placeItem(api, production, b, k2.source, FULL);
      await goLive(api, production);
      const { output } = await openProbedOutput({ browser, onCleanup }, production, { debug: true }, { viewport: { width: 1920, height: 1080 } });
      await output.waitForPlayingVideos(1, { minFps: 8, timeout: 45_000 });
      const frame = await output.frame();
      await expect.poll(async () => (await inboundOf(frame, production, k2.source))?.frameWidth ?? 0, { timeout: 15_000 }).toBeGreaterThan(0);
      expect((await inboundOf(frame, production, k2.source))!.frameWidth, 'before the selection: lowest layer').toBeLessThanOrEqual(360);

      const selected = Date.now();
      expect((await api.setPreview(production.id, { sceneId: b })).status).toBe(200);
      let reachedAt = 0;
      await expect
        .poll(async () => {
          const width = (await inboundOf(frame, production, k2.source))?.frameWidth ?? 0;
          if (width >= 1280 && !reachedAt) reachedAt = Date.now() - selected;
          return width;
        }, { timeout: 3000, intervals: [100], message: 'K2 reaches the highest layer (>= 1280 px) within 3 s of selecting the preview' })
        .toBeGreaterThanOrEqual(1280);
    },
  );

  test(
    'E2E-OUT-22 [output, subscriptions] the output receives only the sources that are in a scene; a screen in no scene is not subscribed',
    t.p1,
    async ({ browser, api, production, pairContext, openPhone, openLaptop, onCleanup }) => {
      outBug('OUT-04', 'the output subscribes to every published track (autoSubscribe), also to sources that are in no scene');
      test.setTimeout(180_000);
      const deps = { api, production, pairContext, openPhone, openLaptop };
      const camera = await addCamera(deps, 'Kamera Eins');
      const screens = await addScreens(deps, 'Laptop Farben', 1);
      await placeItem(api, production, production.sceneIds[0]!, camera.source, FULL);
      await goLive(api, production);
      const { output } = await openProbedOutput({ browser, onCleanup }, production, {}, { viewport: { width: 1280, height: 720 } });
      await output.waitForPlayingVideos(1, { minFps: 8, timeout: 45_000 });
      await sleep(4000);
      const frame = await output.frame();
      const sids = await trackSids(production);
      expect(sids.has(screens.sources[0]!), 'S1 is published').toBe(true);
      const streams = await inboundVideo(frame);
      const screen = await inboundOf(frame, production, screens.sources[0]!);
      await recordMeasurement(test.info(), 'out-22-subscriptions', { streams: streams.map((stream) => ({ sid: stream.sid, width: stream.frameWidth, bytes: stream.bytesReceived, packets: stream.packetsReceived })), screenSid: sids.get(screens.sources[0]!), cameraSid: sids.get(camera.source) }, `${streams.length} inbound video streams for 1 source in a scene; S1 (in no scene): ${screen ? `${screen.bytesReceived} bytes, ${screen.frameWidth} px wide` : 'not received'}`);
      expect(streams.map((stream) => stream.sid), 'only the sources of scenes arrive').toEqual([sids.get(camera.source)]);
      expect(screen?.bytesReceived ?? 0, 'no bytes for S1').toBe(0);
    },
  );

  test(
    'E2E-OUT-23 [output, consumers] three output pages switch together (<= 100 ms apart) and the Regie counts three consumers',
    t.p2,
    async ({ browser, api, production, pairContext, openPhone, openLaptop, onCleanup }) => {
      test.setTimeout(240_000);
      const deps = { api, production, pairContext, openPhone, openLaptop };
      const screens = await addScreens(deps, 'Laptop Farben', 2);
      const [a, b] = production.sceneIds as [string, string];
      await placeItem(api, production, a, screens.sources[0]!, FULL);
      await placeItem(api, production, b, screens.sources[1]!, FULL);
      await goLive(api, production);
      const pages = [];
      for (const debug of [false, false, true]) pages.push(await openProbedOutput({ browser, onCleanup }, production, { debug }, { viewport: { width: 640, height: 360 } }));
      for (const page of pages) await page.output.waitForPlayingVideos(1, { minFps: 5, timeout: 45_000 });
      await expect
        .poll(async () => (await api.getSnapshot(production.id)).body.outputStatus.consumers, { timeout: 15_000, message: 'three consumers' })
        .toBe(3);
      const status = (await api.getSnapshot(production.id)).body.outputStatus;
      expect(status.addresses.length, 'the addresses are listed').toBeGreaterThanOrEqual(1);

      const spreads: number[] = [];
      let target = b;
      for (let index = 0; index < 20; index++) {
        for (const page of pages) await page.probe.takeEvents();
        const sw = await switchProgram(api, production, target, index % 2 === 0 ? { kind: 'cut', durationMs: 0 } : { kind: 'fade', durationMs: 200 });
        expect(sw.status, `switch ${index}`).toBe(200);
        const times: number[] = [];
        for (const page of pages) {
          await page.probe.waitForScene(target, 5000);
          const added = firstEvent(await page.probe.takeEvents(), 'layer+', { id: target });
          times.push(added!.t);
        }
        spreads.push(Math.max(...times) - Math.min(...times));
        target = target === a ? b : a;
        await sleep(400);
      }
      const spread = summarize(spreads);
      await recordMeasurement(test.info(), 'out-23-consumers', { spreads, spread }, `three pages: spread of the scene change ${fmt(spread)} ms`);
      expect(spread.max, 'all pages show the same scene within 100 ms').toBeLessThanOrEqual(100);
    },
  );

  test(
    'E2E-OUT-15 [output, status in the Regie] the header chip and its popover follow the output: not connected -> connected with latency -> two consumers -> blocked page flagged -> connected -> none; silent hub client -> stale',
    t.p1,
    async ({ regie, api, browser, production, pairContext, openPhone, openLaptop, onCleanup }) => {
      test.setTimeout(240_000);
      const deps = { api, production, pairContext, openPhone, openLaptop };
      const camera = await addCamera(deps, 'Kamera Eins');
      await placeItem(api, production, production.sceneIds[0]!, camera.source, FULL);
      await goLive(api, production);
      const chip = regie.page.getByRole('button', { name: /Output an Proxy/ });
      const lamp = chip.locator('.c-lamp');
      await expect(chip).toBeVisible();
      await expect(lamp, 'no output: grey lamp').toHaveClass(/is-idle/);
      await chip.click();
      const popover = regie.page.getByRole('dialog', { name: 'Output' });
      await expect(popover.locator('dd').first()).toHaveText('nicht verbunden');
      // The link is masked; «Kopieren» puts the full URL with the real key into the clipboard.
      await expect(popover.locator('.c-linkbox__text')).toContainText('?k=');
      expect(await popover.locator('.c-linkbox__text').innerText(), 'the key is masked').not.toContain(production.outputKey);
      await popover.getByRole('button', { name: 'Kopieren' }).click();
      await expect.poll(() => regie.page.evaluate(() => navigator.clipboard.readText()), { timeout: 5000 }).toContain(production.outputKey);
      expect(await regie.page.evaluate(() => navigator.clipboard.readText())).toBe(production.outputUrl);

      const first = await openProbedOutput({ browser, onCleanup }, production, {}, { viewport: { width: 1280, height: 720 } });
      await first.output.waitForPlayingVideos(1, { minFps: 5, timeout: 45_000 });
      const connectedAfter = Date.now();
      await expect(lamp, 'connected: green lamp (no idle/warn class)').not.toHaveClass(/is-idle|is-warn/, { timeout: 8000 });
      await expect(chip, 'the chip shows the latency in ms').toHaveText(/\d+ ms/, { timeout: 8000 });
      await expect(popover.locator('dd').first()).toHaveText('verbunden, 1 Abnehmer', { timeout: 8000 });
      await recordMeasurement(test.info(), 'out-15-chip', { connectedMs: Date.now() - connectedAfter }, `output opened -> chip connected after ${Date.now() - connectedAfter} ms`);
      expect(Date.now() - connectedAfter, 'chip within 5 s').toBeLessThanOrEqual(5000 + 3000);
      await expect(popover.locator('dd').nth(1), 'the address of the consumer').not.toHaveText('–');
      await expect(popover.locator('dd').nth(2)).toHaveText('1920 × 1080 · 30 fps');
      await expect(popover.locator('dd').nth(3)).toContainText('gemessen');

      const second = await openProbedOutput({ browser, onCleanup }, production, {}, { viewport: { width: 640, height: 360 } });
      await second.output.waitForPlayingVideos(1, { minFps: 5, timeout: 45_000 });
      await expect(popover.locator('dd').first()).toHaveText('verbunden, 2 Abnehmer', { timeout: 8000 });
      await second.context.close();
      await expect(popover.locator('dd').first()).toHaveText('verbunden, 1 Abnehmer', { timeout: 10_000 });

      // A page whose main thread is blocked for 10 s stops reporting AND stops answering the hub's keep-alive: the API
      // drops the connection after its 5 s client timeout (before Output:StaleAfter of 6 s could make it «stale»), so
      // the Regie sees «nicht verbunden» after ~5 s; the page reconnects as soon as it runs again.
      const blocked = Date.now();
      void first.output.page.evaluate(() => { const end = Date.now() + 10_000; while (Date.now() < end) { /* block */ } });
      await expect.poll(async () => (await api.getSnapshot(production.id)).body.outputStatus.state, { timeout: 12_000, intervals: [250], message: 'no longer connected while the page is blocked' }).not.toBe('connected');
      const flaggedAfter = Date.now() - blocked;
      expect(flaggedAfter, 'flagged within 8 s of the block').toBeLessThanOrEqual(8000);
      await expect(lamp, 'the lamp is no longer green').toHaveClass(/is-idle|is-warn/, { timeout: 5000 });
      const resumedAt = blocked + 10_000;
      await expect.poll(async () => (await api.getSnapshot(production.id)).body.outputStatus.state, { timeout: 20_000, intervals: [250], message: 'connected again after the block' }).toBe('connected');
      await recordMeasurement(test.info(), 'out-15-blocked', { flaggedAfterMs: flaggedAfter, reconnectedAfterBlockMs: Date.now() - resumedAt }, `blocked page flagged after ${flaggedAfter} ms, connected again ${Date.now() - resumedAt} ms after the block ended`);
      await expect(lamp).not.toHaveClass(/is-warn|is-idle/, { timeout: 8000 });

      const closed = Date.now();
      await first.context.close();
      await expect.poll(async () => (await api.getSnapshot(production.id)).body.outputStatus.state, { timeout: 12_000, intervals: [250], message: 'none after closing' }).toBe('none');
      expect(Date.now() - closed, 'none within 8 s').toBeLessThanOrEqual(8500);
      await expect(lamp).toHaveClass(/is-idle/, { timeout: 5000 });
      await expect(popover.locator('dd').first()).toHaveText('nicht verbunden');

      // «stale» is a hub connection without a fresh rendering report (here a client that connects and stays silent):
      // after 6 s the chip warns and the popover says so.
      const silent = OutputHub.connect(stackConfig().baseURL, production.outputKey);
      onCleanup(() => silent.stop());
      await silent.open();
      await expect.poll(async () => (await api.getSnapshot(production.id)).body.outputStatus.state, { timeout: 12_000, intervals: [250], message: 'stale without reports' }).toBe('stale');
      await expect(lamp, 'warning lamp').toHaveClass(/is-warn/, { timeout: 5000 });
      await expect(popover.locator('dd').first()).toHaveText('verbunden, kein aktuelles Bild');
      await silent.report({ rendering: true });
      await expect.poll(async () => (await api.getSnapshot(production.id)).body.outputStatus.state, { timeout: 8000, intervals: [250] }).toBe('connected');
    },
  );
});
