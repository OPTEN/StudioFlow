import { CUT } from '../../support/api';
import { TEXT } from '../../support/text';
import { makePng } from '../../support/media-samples';
import { expect, test } from '../../support/ui/fixtures';
import { SCREEN_COLORS } from '../../support/ui/init';
import { colorsClose } from '../../support/ui/pixels';
import { GROUND, firstEvent, itemsOfLayer, sleep, toneOf } from '../../support/output/analysis';
import { outBug } from '../../support/output/bugs';
import { openProbedOutput } from '../../support/output/open';
import { DecodedFrame, CENTRE, Screencast } from '../../support/output/screencast';
import { fmt, judgeTiming, recordMeasurement, startCpuMonitor, summarize, timingGate } from '../../support/output/stats';
import { FULL, addCamera, addScreens, goLive, placeItem, switchProgram, type Camera, type WorldDeps } from '../../support/output/world';
import { readRtc } from '../../support/perf/rtc';
import { t } from '../../support/tags';

/**
 * Switching as the audience sees it (docs/testing.md E2E-SWITCH-02/04/08/09/13, E2E-OUT-11): the Regie's click is
 * replaced by the REST call it makes (`POST .../program`), the output page is the real one in a real browser. The
 * probe records the stage per animation frame (layers, opacity, item state, picture luminance, running Web Animations)
 * and the DOM events (layer added/removed, slate added/removed); a CDP screencast records the pixels the compositor
 * produced. Times are epoch milliseconds in both the browser and this process (one machine, one clock).
 */

const FADE = (durationMs: number) => ({ kind: 'fade' as const, durationMs });

/**
 * What a phone sends at its lowest simulcast layer right now, and whether libwebrtc adapts to the CPU: an overloaded sender
 * lowers the resolution of every layer (`degradationPreference: 'maintain-framerate'`), so its lowest layer is then 240 px
 * wide instead of 320 (issue #39). A picture can never be wider than the layer that is sent.
 */
async function senderLowestLayer(camera: Camera): Promise<{ width: number; cpuLimited: boolean }> {
  const { outbound } = await readRtc(camera.phone.page);
  const sending = outbound.filter((stream) => stream.active && stream.frameWidth > 0);
  return { width: sending.length > 0 ? Math.min(...sending.map((stream) => stream.frameWidth)) : 0, cpuLimited: outbound.some((stream) => stream.qualityLimitationReason === 'cpu') };
}

/** A laptop with two fake screens (S1 red, S2 green) and the scenes A = S1 and B = S2, both full canvas. */
async function screenScenes(deps: WorldDeps) {
  const screens = await addScreens(deps, 'Laptop Colours', 2);
  const [a, b, c] = deps.production.sceneIds as [string, string, string];
  const itemA = await placeItem(deps.api, deps.production, a, screens.sources[0]!, FULL);
  const itemB = await placeItem(deps.api, deps.production, b, screens.sources[1]!, FULL);
  return { screens, a, b, c, itemA, itemB };
}

test.describe('OUT transitions', () => {
  test(
    'E2E-SWITCH-02 [output, cut] a cut shows only the new scene in the next frame: one layer at a time, no opacity animation',
    t.p0,
    async ({ browser, api, production, pairContext, openPhone, openLaptop, onCleanup }) => {
      test.setTimeout(180_000);
      const deps = { api, production, pairContext, openPhone, openLaptop };
      const { a, b } = await screenScenes(deps);
      await goLive(api, production);
      const { output, probe } = await openProbedOutput({ browser, onCleanup }, production, {}, { viewport: { width: 1280, height: 720 } });
      await output.waitForPlayingVideos(1);
      await probe.waitForScene(a);

      for (const [from, to] of [[a, b], [b, a], [a, b]] as const) {
        await probe.takeEvents();
        await probe.startSampler({ animations: true });
        await sleep(150);
        const sw = await switchProgram(api, production, to, CUT);
        expect(sw.status, 'switch accepted').toBe(200);
        await probe.waitForScene(to);
        await sleep(400);
        const frames = await probe.stopSampler();
        const events = await probe.takeEvents();
        const added = firstEvent(events, 'layer+', { id: to })!;
        const removed = firstEvent(events, 'layer-', { id: from })!;
        expect(added, 'the new layer is added').toBeDefined();
        expect(removed, 'the old layer is removed').toBeDefined();
        expect(Math.abs(removed.t - added.t), 'old layer leaves in the same task as the new one arrives').toBeLessThanOrEqual(5);
        expect(Math.max(...frames.map((frame) => frame.layers.length)), 'never two layers on stage during a cut').toBeLessThanOrEqual(1);
        expect(frames.flatMap((frame) => frame.layers.map((layer) => layer.opacity)).every((opacity) => opacity === 1), 'full opacity in every frame').toBe(true);
        expect(frames.flatMap((frame) => frame.anims ?? []).filter((animation) => animation.scene !== null), 'no animation on a scene layer').toEqual([]);
        const firstWithNew = frames.find((frame) => frame.layers.some((layer) => layer.id === to))!;
        expect(firstWithNew.layers.map((layer) => layer.id), 'the first frame with the new scene has no trace of the old one').toEqual([to]);
        expect(added.t - sw.sentAt, 'request -> new scene in the DOM').toBeLessThan(300);
      }
      // A flat area of the picture: the label (“S2”) sits at the exact centre, where glyph and ground depend on the font, and the stamp bar at the top.
      const stage = await output.stagePixels();
      const flat = stage.mean({ x: 200, y: 200, width: 100, height: 100 });
      expect(colorsClose(flat, SCREEN_COLORS[1], 50), `the stage shows S2 (green), got ${flat}`).toBe(true);
    },
  );

  test(
    'E2E-SWITCH-02 [output, fade] exactly one opacity animation of the requested duration on the new layer, the old layer leaves when it ends (T-FADE)',
    t.p0,
    async ({ browser, api, production, pairContext, openPhone, openLaptop, onCleanup }) => {
      test.setTimeout(240_000);
      const deps = { api, production, pairContext, openPhone, openLaptop };
      const { a, b } = await screenScenes(deps);
      await goLive(api, production);
      const { output, probe } = await openProbedOutput({ browser, onCleanup }, production, {}, { viewport: { width: 1280, height: 720 } });
      await output.waitForPlayingVideos(1);
      await probe.waitForScene(a);

      const results: Array<{ durationMs: number; measuredMs: number; frames: number; animationMs: number | null }> = [];
      let from = a;
      let to = b;
      for (const durationMs of [200, 200, 300, 300, 500, 500, 1000, 1000, 2000, 2000]) {
        await probe.takeEvents();
        await probe.startSampler({ animations: true });
        await sleep(150);
        const sw = await switchProgram(api, production, to, FADE(durationMs));
        expect(sw.status, `fade ${durationMs} accepted`).toBe(200);
        await probe.waitForScene(to, durationMs + 5000);
        await sleep(250);
        const frames = await probe.stopSampler();
        const events = await probe.takeEvents();
        const added = firstEvent(events, 'layer+', { id: to })!;
        const removed = firstEvent(events, 'layer-', { id: from })!;
        expect(added && removed, `fade ${durationMs}: layers added and removed`).toBeTruthy();

        // One opacity animation, 'durationMs' long, on the new layer only.
        const animations = frames.flatMap((frame) => frame.anims ?? []).filter((animation) => animation.props.includes('opacity') && animation.scene !== null);
        expect(new Set(animations.map((animation) => animation.scene)), `fade ${durationMs}: the animation targets the new layer only`).toEqual(new Set([to]));
        const durations = new Set(animations.map((animation) => animation.duration));
        expect([...durations], `fade ${durationMs}: one animation, duration ${durationMs} ms`).toEqual([durationMs]);

        // The opacity of the new layer rises from ~0 to 1 without going back, in many steps; the old layer stays at 1.
        const series = frames.flatMap((frame) => frame.layers.filter((layer) => layer.id === to).map((layer) => ({ t: frame.t, opacity: layer.opacity })));
        expect(series[0]!.opacity, `fade ${durationMs}: starts transparent`).toBeLessThanOrEqual(0.25);
        expect(series.at(-1)!.opacity, `fade ${durationMs}: ends opaque`).toBe(1);
        for (let index = 1; index < series.length; index++)
          expect(series[index]!.opacity, `fade ${durationMs}: opacity never goes back (frame ${index})`).toBeGreaterThanOrEqual(series[index - 1]!.opacity - 0.02);
        const intermediate = series.filter((sample) => sample.opacity > 0.05 && sample.opacity < 0.95).length;
        expect(intermediate, `fade ${durationMs}: intermediate frames are visible`).toBeGreaterThanOrEqual(Math.floor(durationMs / 50));
        for (const frame of frames.filter((candidate) => candidate.layers.length === 2))
          expect(frame.layers.find((layer) => layer.id === from)!.opacity, 'the old layer stays opaque below the fade').toBe(1);

        // T-FADE: new layer in the DOM -> old layer removed.
        const measuredMs = removed.t - added.t;
        results.push({ durationMs, measuredMs, frames: series.length, animationMs: [...durations][0] ?? null });
        // Done: one layer, opaque, no running animation.
        const last = frames.at(-1)!;
        expect(last.layers, `fade ${durationMs}: finished on the new scene`).toEqual([{ id: to, opacity: 1 }]);
        expect(last.anims ?? [], 'no animation left behind').toEqual([]);
        [from, to] = [to, from];
      }
      await recordMeasurement(test.info(), 'switch-02-fade', { results }, results.map((r) => `${r.durationMs} ms -> ${Math.round(r.measuredMs)} ms`).join(', '));
      // T-FADE (hard +-50 ms): the best of the runs per duration counts, so a single scheduling stall of a shared machine
      // (the first fade after a page load creates the videos) does not fail the test; a fade that is systematically
      // off fails every run.
      for (const durationMs of new Set(results.map((r) => r.durationMs))) {
        const errors = results.filter((r) => r.durationMs === durationMs).map((r) => Math.abs(r.measuredMs - durationMs));
        expect(Math.min(...errors), `T-FADE (hard +-50 ms) for ${durationMs} ms: errors of the runs ${errors.map(Math.round).join('/')} ms`).toBeLessThanOrEqual(50);
      }
    },
  );

  test(
    'E2E-SWITCH-02 [output, fade pixels] a 1 s fade shows intermediate colours between S1 and S2 and completes on the new scene',
    t.p0,
    async ({ browser, api, production, pairContext, openPhone, openLaptop, onCleanup }) => {
      test.setTimeout(180_000);
      const deps = { api, production, pairContext, openPhone, openLaptop };
      const { a, b } = await screenScenes(deps);
      await goLive(api, production);
      const { output, probe } = await openProbedOutput({ browser, onCleanup }, production, {}, { viewport: { width: 1280, height: 720 } });
      await output.waitForPlayingVideos(1);
      await probe.waitForScene(a);
      await sleep(1000);
      for (const [from, to] of [[a, b], [b, a]] as const) {
        // The next scene is the preview scene (Studio Mode, decision 12): the output has its picture ready when the fade starts.
        // A scene that is neither on air nor in the preview shows its picture with the next keyframe, after about half a second.
        expect((await api.setPreview(production.id, { sceneId: to })).status).toBe(200);
        await sleep(900);
        const cast = await Screencast.start(output.page, { maxWidth: 320, maxHeight: 180 });
        await sleep(300);
        const sw = await switchProgram(api, production, to, FADE(1000));
        await probe.waitForScene(to, 8000);
        await sleep(500);
        const frames = (await cast.stop()).map((frame) => new DecodedFrame(frame.t, frame.png));
        const samples = frames.map((frame) => ({ ms: frame.t - sw.sentAt, rgb: frame.mean(CENTRE) }));
        const tones = samples.map((sample) => toneOf(sample.rgb));
        const before = tones.filter((_, index) => samples[index]!.ms < 0);
        const during = samples.filter((sample) => sample.ms >= 50 && sample.ms <= 1000);
        const mixed = during.filter((sample) => toneOf(sample.rgb) === 'mixed');
        const fromTone = from === a ? 'red' : 'green';
        const toTone = from === a ? 'green' : 'red';
        expect(before.every((tone) => tone === fromTone), `before the switch the stage is ${fromTone}`).toBe(true);
        expect(mixed.length, `a 1 s fade shows many intermediate frames (${samples.length} frames in total)`).toBeGreaterThanOrEqual(10);
        // Steady progress: the red-green balance moves one way only.
        const balance = during.map((sample) => sample.rgb[0] - sample.rgb[1]);
        const direction = from === a ? -1 : 1;
        for (let index = 1; index < balance.length; index++)
          expect((balance[index]! - balance[index - 1]!) * direction, `no step backwards in the cross-fade (frame ${index})`).toBeGreaterThanOrEqual(-8);
        const final = samples.filter((sample) => sample.ms >= 1150);
        expect(final.length, 'frames after the fade').toBeGreaterThan(3);
        expect(final.every((sample) => toneOf(sample.rgb) === toTone), `after the fade the stage is ${toTone}`).toBe(true);
        const lastMixed = mixed.at(-1)!;
        expect(lastMixed.ms, 'the cross-fade ends on time (T-FADE hard +-50 ms plus a frame)').toBeLessThanOrEqual(1000 + 80);
      }
    },
  );

  test(
    'E2E-SWITCH-04 [output, A fade always completes] a switch request during a fade is refused (409), the output never shows a half state afterwards',
    t.p0,
    async ({ browser, api, production, pairContext, openPhone, openLaptop, onCleanup }) => {
      test.setTimeout(180_000);
      const deps = { api, production, pairContext, openPhone, openLaptop };
      const { a, b, c } = await screenScenes(deps);
      await goLive(api, production);
      const { output, probe } = await openProbedOutput({ browser, onCleanup }, production, {}, { viewport: { width: 1280, height: 720 } });
      await output.waitForPlayingVideos(1);
      await probe.waitForScene(a);
      await probe.takeEvents();
      await probe.startSampler({ animations: true });
      const sw = await switchProgram(api, production, b, FADE(2000));
      expect(sw.status).toBe(200);
      await sleep(300);
      const refused = await switchProgram(api, production, c, CUT);
      expect(refused.status, 'second switch during the fade').toBe(409);
      const problem = await api.switchProgram(production.id, { sceneId: c, transition: CUT });
      expect(problem.body.code, 'transition_running').toBe('transition_running');
      await probe.waitForScene(b, 6000);
      await sleep(300);
      const frames = await probe.stopSampler();
      const events = await probe.takeEvents();
      expect(events.filter((event) => event.type === 'layer+').map((event) => event.id), 'only B was ever added').toEqual([b]);
      const during = frames.filter((frame) => frame.t > sw.sentAt + 100 && frame.t < sw.sentAt + 1900);
      expect(during.every((frame) => frame.layers.length === 2), 'two layers during the whole fade').toBe(true);
      const last = frames.at(-1)!;
      expect(last.layers, 'after the fade: the new layer alone, opacity 1').toEqual([{ id: b, opacity: 1 }]);
      expect(last.anims ?? []).toEqual([]);
      // The next switch works.
      await sleep(200);
      const next = await switchProgram(api, production, c, CUT);
      expect(next.status, 'a switch after the fade').toBe(200);
      await probe.waitForScene(c);
    },
  );

  test(
    'E2E-SWITCH-08 [output, switch latency] 30 cuts, 1.5 s apart: request -> new scene in the output DOM (T-SWITCH p50 150 ms, p95 300 ms)',
    t.p0,
    async ({ browser, api, production, pairContext, openPhone, openLaptop, onCleanup }) => {
      test.setTimeout(240_000);
      const deps = { api, production, pairContext, openPhone, openLaptop };
      const { a, b } = await screenScenes(deps);
      await goLive(api, production);
      const { output, probe } = await openProbedOutput({ browser, onCleanup }, production, {}, { viewport: { width: 1280, height: 720 } });
      await output.waitForPlayingVideos(1);
      await probe.waitForScene(a);
      await probe.takeEvents();
      const samples: Array<{ to: string; sentAt: number; answeredMs: number; domMs: number }> = [];
      let target = b;
      for (let index = 0; index < 30; index++) {
        const sw = await switchProgram(api, production, target, CUT);
        expect(sw.status, `cut ${index}`).toBe(200);
        await probe.waitForScene(target, 5000);
        const events = await probe.takeEvents();
        const added = firstEvent(events, 'layer+', { id: target })!;
        samples.push({ to: target, sentAt: sw.sentAt, answeredMs: sw.answeredAt - sw.sentAt, domMs: added.t - sw.sentAt });
        target = target === a ? b : a;
        await sleep(1500);
      }
      const dom = summarize(samples.map((sample) => sample.domMs));
      const rest = summarize(samples.map((sample) => sample.answeredMs));
      await recordMeasurement(test.info(), 'switch-08-latency', { samples, dom, rest }, `request -> DOM ${fmt(dom)} ms; REST answer ${fmt(rest)} ms`);
      expect(dom.p50, 'T-SWITCH p50 (target 150 ms)').toBeLessThanOrEqual(150);
      expect(dom.p95, 'T-SWITCH p95 (hard 300 ms)').toBeLessThanOrEqual(300);
    },
  );

  test(
    'E2E-SWITCH-13 [output, switch in standby] the standby slate stays (no flash of the new scene) and the new scene shows after the start',
    t.p1,
    async ({ browser, api, production, pairContext, openPhone, openLaptop, onCleanup }) => {
      test.setTimeout(180_000);
      const deps = { api, production, pairContext, openPhone, openLaptop };
      const { a, b } = await screenScenes(deps);
      const { output, probe } = await openProbedOutput({ browser, onCleanup }, production, {}, { viewport: { width: 1280, height: 720 } });
      await expect.poll(() => output.slateText(), { timeout: 15_000 }).toContain(TEXT.slate.standby);
      await probe.waitForScene(a);
      await sleep(600);
      await probe.takeEvents();
      await probe.startSampler();
      const sw = await switchProgram(api, production, b, CUT);
      expect(sw.status).toBe(200);
      await probe.waitForScene(b);
      await sleep(1200);
      const frames = await probe.stopSampler();
      expect(frames.every((frame) => frame.slate !== null && frame.slate.opacity === 1), 'the slate stays opaque in every frame').toBe(true);
      const stage = await output.stagePixels();
      for (const [x, y] of [[100, 100], [1820, 100], [100, 980], [1820, 980], [960, 1000]] as const) {
        const pixel = stage.at(x, y);
        expect(Math.hypot(pixel[0] - GROUND[0], pixel[1] - GROUND[1], pixel[2] - GROUND[2]), `pixel ${x},${y} is the slate ground`).toBeLessThanOrEqual(8);
      }
      await goLive(api, production);
      await expect.poll(async () => (await probe.snapshot()).slate, { timeout: 5000, message: 'the slate is gone after the start' }).toBeNull();
      await output.waitForPlayingVideos(1);
      await expect
        .poll(async () => toneOf((await output.stagePixels()).mean({ x: 600, y: 400, width: 700, height: 300 })), { timeout: 8000, message: 'the program (S2) shows after the start' })
        .toBe('green');
    },
  );

  test(
    'E2E-OUT-11 [output, slates] standby -> start -> end -> reset: texts, 300 ms fades, covering the picture, renaming, background image',
    t.smoke,
    async ({ browser, api, production, pairContext, openPhone, openLaptop, onCleanup }) => {
      test.setTimeout(240_000);
      const deps = { api, production, pairContext, openPhone, openLaptop };
      const { a } = await screenScenes(deps);
      const { output, probe } = await openProbedOutput({ browser, onCleanup }, production, {}, { viewport: { width: 1280, height: 720 } });
      const frame = await output.frame();
      const slate = () => probe.snapshot().then((snapshot) => snapshot.slate);

      // Standby: title, subtitle = production name; the slate fades in over 300 ms and covers the stage.
      await expect.poll(async () => (await slate())?.title, { timeout: 15_000 }).toBe(TEXT.slate.standby);
      expect((await slate())!.subtitle, 'subtitle = production name').toBe(production.name);
      await expect.poll(async () => (await slate())?.opacity, { timeout: 2000 }).toBe(1);
      await probe.waitForScene(a);
      const stageBox = (await (await output.stage()).boundingBox())!;
      const slateBox = (await frame.locator('.sf-r-slate').boundingBox())!;
      expect([slateBox.x, slateBox.y, slateBox.width, slateBox.height].map(Math.round)).toEqual([stageBox.x, stageBox.y, stageBox.width, stageBox.height].map(Math.round));

      await probe.takeEvents();

      // The slate texts come from the production (API): title and subtitle change live.
      const custom = { title: 'Break until 14:00', subtitle: 'We will be right back', backgroundAssetId: null };
      expect((await api.updateProduction(production.id, { standbySlate: custom })).status).toBe(200);
      await expect.poll(async () => (await slate())?.title, { timeout: 5000 }).toBe(custom.title);
      expect((await slate())!.subtitle).toBe(custom.subtitle);
      // Background image: cover-fitted, loaded with the output key.
      const uploaded = await api.uploadAsset(production.id, { fileName: 'Slate.png', contentType: 'image/png', data: makePng(1920, 1080, [200, 40, 40]) });
      expect(uploaded.status, uploaded.raw.text().slice(0, 200)).toBe(201);
      const assetId = uploaded.body.id;
      expect((await api.updateProduction(production.id, { standbySlate: { ...custom, backgroundAssetId: assetId } })).status).toBe(200);
      await expect
        .poll(() => frame.evaluate(() => { const image = document.querySelector<HTMLImageElement>('.sf-r-slate-image'); return image ? { display: getComputedStyle(image).display, fit: getComputedStyle(image).objectFit, natural: image.naturalWidth, src: image.src } : null; }), { timeout: 8000, message: 'slate image loaded' })
        .toMatchObject({ display: 'block', fit: 'cover', natural: 1920 });
      const image = await frame.evaluate(() => document.querySelector<HTMLImageElement>('.sf-r-slate-image')!.src);
      expect(image, 'the image is requested with the output key').toContain('?k=');
      const withImage = await output.stagePixels();
      expect(colorsClose(withImage.at(100, 100), '#c82828', 30), 'the slate image covers the stage').toBe(true);
      // Back to the plain slate.
      await api.updateProduction(production.id, { standbySlate: { title: TEXT.slate.standby, subtitle: production.name, backgroundAssetId: null } });
      await expect.poll(() => frame.evaluate(() => getComputedStyle(document.querySelector('.sf-r-slate-image')!).display), { timeout: 5000 }).toBe('none');

      // Start: the slate fades out over 300 ms to the program (the picture was already behind it).
      await probe.takeEvents();
      await probe.startSampler({ animations: true });
      const started = Date.now();
      await goLive(api, production);
      await expect.poll(async () => (await slate()), { timeout: 5000 }).toBeNull();
      await sleep(200);
      let frames = await probe.stopSampler();
      let events = await probe.takeEvents();
      const fadeOut = frames.filter((sample) => sample.slate !== null && sample.slate.opacity < 1);
      expect(fadeOut.length, 'the slate is seen at intermediate opacities').toBeGreaterThanOrEqual(3);
      const slateGone = firstEvent(events, 'slate-')!;
      expect(slateGone.t - started, 'start -> slate gone (fade 300 ms + request)').toBeLessThan(300 + 400);
      const slateAnimation = frames.flatMap((sample) => sample.anims ?? []).find((animation) => animation.cls?.includes('sf-r-slate') && animation.props.includes('opacity'));
      expect(slateAnimation?.duration, 'slate fade is a 300 ms opacity animation').toBeLessThanOrEqual(300);
      await output.waitForPlayingVideos(1);
      expect(toneOf((await output.stagePixels()).mean({ x: 600, y: 400, width: 700, height: 300 })), 'the program (S1) is on air').toBe('red');

      // End: the end slate fades in over the last picture.
      await probe.takeEvents();
      await probe.startSampler({ animations: true });
      expect((await api.endBroadcast(production.id)).status).toBe(200);
      await expect.poll(async () => (await slate())?.title, { timeout: 5000 }).toBe(TEXT.slate.end);
      await expect.poll(async () => (await slate())?.opacity, { timeout: 2000 }).toBe(1);
      frames = await probe.stopSampler();
      events = await probe.takeEvents();
      const fadeIn = frames.filter((sample) => sample.slate !== null && sample.slate.opacity > 0.05 && sample.slate.opacity < 0.95);
      expect(fadeIn.length, 'end slate fades in').toBeGreaterThanOrEqual(3);
      expect(frames.every((sample) => sample.layers.some((layer) => layer.id === a)), 'the last picture stays under the end slate').toBe(true);
      expect(frames.filter((sample) => sample.slate).every((sample) => sample.slate!.title !== TEXT.slate.standby), 'no standby slate in between').toBe(true);
      expect(toneOf((await output.stagePixels()).at(960, 1000)), 'covered: the end slate is opaque').toBe('dark');

      // Reset: back to the standby slate with the production's slate texts.
      expect((await api.resetBroadcast(production.id)).status).toBe(200);
      await expect.poll(async () => (await slate())?.title, { timeout: 5000 }).toBe(TEXT.slate.standby);
      expect((await slate())!.subtitle).toBe(production.name);
    },
  );

  test(
    'E2E-OUT-11 [output, rename] renaming the production updates the standby slate subtitle live',
    t.p1,
    async ({ browser, api, production, onCleanup }) => {
      outBug('OUT-02', 'the standby slate subtitle is a copy of the name taken at creation; renaming the production leaves it unchanged');
      const { probe } = await openProbedOutput({ browser, onCleanup }, production, {}, { viewport: { width: 1280, height: 720 } });
      await expect.poll(async () => (await probe.snapshot()).slate?.subtitle, { timeout: 15_000 }).toBe(production.name);
      await probe.takeEvents();
      const renamed = `${production.name} new`;
      expect((await api.updateProduction(production.id, { name: renamed })).status).toBe(200);
      await expect.poll(async () => (await probe.snapshot()).slate?.subtitle, { timeout: 5000, message: 'subtitle follows the production name' }).toBe(renamed);
      expect((await probe.takeEvents()).filter((event) => event.type === 'slate+'), 'updated in place, no new slate').toEqual([]);
    },
  );

  test(
    'E2E-SWITCH-09 [output, cut, picture within N ms] a cut to the preview scene (its camera is not in the program) shows the picture quickly and never below the LOW layer',
    t.p0,
    async ({ browser, api, production, pairContext, openPhone, openLaptop, onCleanup }) => {
      test.setTimeout(300_000);
      const deps = { api, production, pairContext, openPhone, openLaptop };
      const k1 = await addCamera(deps, 'Camera One');
      const k2 = await addCamera(deps, 'Camera Two');
      const [a, b] = production.sceneIds as [string, string];
      await placeItem(api, production, a, k1.source, FULL);
      await placeItem(api, production, b, k2.source, FULL);
      await goLive(api, production);
      const { output, probe } = await openProbedOutput({ browser, onCleanup }, production, {}, { viewport: { width: 1280, height: 720 } });
      await output.waitForPlayingVideos(1);
      await sleep(3000);

      const rows: Array<{ index: number; to: string; layerMs: number; pictureMs: number; frames: number; firstWidth: number; readyAtInsert: number; fullMs: number; senderLowWidth: number; senderCpuLimited: boolean }> = [];
      const stopCpu = startCpuMonitor();
      let target = b;
      for (let index = 0; index < 50; index++) {
        // The next scene is the preview scene: the output requests its pictures at the size they will have on stage.
        expect((await api.setPreview(production.id, { sceneId: target })).status).toBe(200);
        await sleep(900);
        // The lowest layer the sender of the target camera sends right now: the floor of the first picture.
        const sender = await senderLowestLayer(target === a ? k1 : k2);
        await probe.takeEvents();
        await probe.startSampler({ luma: true });
        await sleep(120);
        const sw = await switchProgram(api, production, target, CUT);
        await probe.waitForScene(target, 5000);
        await sleep(450);
        const frames = await probe.stopSampler();
        const events = await probe.takeEvents();
        const added = firstEvent(events, 'layer+', { id: target })!;
        const withLayer = frames.filter((sample) => sample.t >= added.t - 1 && sample.layers.some((layer) => layer.id === target));
        const firstOk = withLayer.findIndex((sample) => {
          const item = itemsOfLayer(sample, target)[0];
          return item !== undefined && item.state === 'live' && (item.luma ?? 0) >= 20;
        });
        const first = withLayer[0] && itemsOfLayer(withLayer[0], target)[0];
        rows.push({
          index,
          to: target,
          layerMs: added.t - sw.sentAt,
          pictureMs: firstOk < 0 ? NaN : withLayer[firstOk]!.t - added.t,
          frames: firstOk,
          firstWidth: firstOk < 0 ? 0 : (itemsOfLayer(withLayer[firstOk]!, target)[0]!.video?.w ?? 0),
          readyAtInsert: first?.video?.ready ?? -1,
          senderLowWidth: sender.width,
          senderCpuLimited: sender.cpuLimited,
          // How long the picture stays at a lower simulcast layer after the cut (the source was only preloaded at LOW).
          fullMs: (() => {
            const full = withLayer.find((sample) => (itemsOfLayer(sample, target)[0]?.video?.w ?? 0) >= 1280);
            return full ? full.t - added.t : NaN;
          })(),
        });
        target = target === a ? b : a;
        await sleep(100);
      }
      const machine = stopCpu();
      const gate = timingGate(machine.busyPct);
      const picture = summarize(rows.map((row) => row.pictureMs));
      const darkFrames = summarize(rows.map((row) => row.frames));
      const layer = summarize(rows.map((row) => row.layerMs));
      const full = summarize(rows.map((row) => row.fullMs));
      // The LOW layer is 320 px wide when the sender has CPU to spare. A sender that adapts to its CPU sends smaller layers
      // (240 px = 3/4 x 320); then the floor of that cut is the lowest layer the sender sends, and the report says so.
      const floorOf = (row: (typeof rows)[number]): number => (row.senderCpuLimited && row.senderLowWidth > 0 ? Math.min(320, row.senderLowWidth) : 320);
      const adapted = rows.filter((row) => floorOf(row) < 320);
      if (adapted.length > 0) {
        test.info().annotations.push({
          type: 'sender-cpu-limited',
          description: `${adapted.length} of ${rows.length} cuts went to a camera whose sender adapted to its CPU (lowest layer ${Math.min(...adapted.map((row) => row.senderLowWidth))} px instead of 320): the floor of those cuts is the layer that was sent`,
        });
      }
      await recordMeasurement(
        test.info(),
        'switch-09-cut',
        { rows, picture, darkFrames, layer, fullResolution: full, machineCpuBusyPct: machine.busyPct, comparable: gate.enforce, cutsToAnAdaptedSender: adapted.length },
        `new layer in the DOM ${fmt(layer)} ms after the request; first picture ${fmt(picture)} ms after the layer; frames without picture ${fmt(darkFrames)}; full resolution (>= 1280 px) ${fmt(full)} ms after the layer (the first picture is 320 px wide in ${rows.filter((row) => row.firstWidth === 320).length} of ${rows.length} cuts)`,
      );
      // What does not depend on the load: a picture that is shown is never narrower than the lowest layer that is sent.
      expect(
        rows.filter((row) => Number.isFinite(row.pictureMs) && row.firstWidth < floorOf(row)).map((row) => `cut ${row.index}: ${row.firstWidth} px (sender's lowest layer ${row.senderLowWidth} px${row.senderCpuLimited ? ', CPU-limited' : ''})`),
        'the new picture is never below the LOW layer (320 px wide; for a sender that adapts to its CPU: the lowest layer it sends)',
      ).toEqual([]);
      // The times need a machine with headroom (issue #39): a pass counts on any machine, a failure on a busy one is "not comparable".
      await judgeTiming(test.info(), gate, () => {
        expect(rows.every((row) => Number.isFinite(row.pictureMs)), 'every cut shows a picture').toBe(true);
        expect(picture.max, 'the first picture is on screen within 150 ms of the new layer (about 9 frames at 60 Hz)').toBeLessThanOrEqual(150);
        expect(layer.p95, 'T-SWITCH p95 is unaffected (hard 300 ms)').toBeLessThanOrEqual(300);
      });
    },
  );

  test(
    'E2E-SWITCH-09 [output, cut, no dark frame] after a cut to a not yet shown camera no frame is dark: the target video has a decoded frame when the layer appears',
    t.p0,
    async ({ browser, api, production, pairContext, openPhone, openLaptop, onCleanup }) => {
      outBug('OUT-01', 'a cut to a scene whose camera is not in the program shows 1-5 frames without picture (dark scene ground)');
      test.setTimeout(300_000);
      const deps = { api, production, pairContext, openPhone, openLaptop };
      const k1 = await addCamera(deps, 'Camera One');
      const k2 = await addCamera(deps, 'Camera Two');
      const [a, b] = production.sceneIds as [string, string];
      await placeItem(api, production, a, k1.source, FULL);
      await placeItem(api, production, b, k2.source, FULL);
      await goLive(api, production);
      const { output, probe } = await openProbedOutput({ browser, onCleanup }, production, {}, { viewport: { width: 1280, height: 720 } });
      await output.waitForPlayingVideos(1);
      await sleep(3000);

      const cast = await Screencast.start(output.page, { maxWidth: 320, maxHeight: 180 });
      const switches: Array<{ to: string; sentAt: number; addedAt: number }> = [];
      const perCut: Array<{ index: number; darkSamples: number; readyAtInsert: number; widthAtInsert: number }> = [];
      let target = b;
      for (let index = 0; index < 50; index++) {
        // The next scene is the preview scene: the output requests its pictures at the size they will have on stage.
        expect((await api.setPreview(production.id, { sceneId: target })).status).toBe(200);
        await sleep(900);
        await probe.takeEvents();
        await probe.startSampler({ luma: true });
        await sleep(120);
        const sw = await switchProgram(api, production, target, CUT);
        await probe.waitForScene(target, 5000);
        await sleep(300);
        const frames = await probe.stopSampler();
        const events = await probe.takeEvents();
        const added = firstEvent(events, 'layer+', { id: target })!;
        switches.push({ to: target, sentAt: sw.sentAt, addedAt: added.t });
        const withLayer = frames.filter((sample) => sample.t >= added.t - 1 && sample.layers.some((layer) => layer.id === target)).slice(0, 12);
        const dark = withLayer.filter((sample) => {
          const item = itemsOfLayer(sample, target)[0];
          return !item || item.state !== 'live' || (item.luma ?? 0) < 20;
        });
        const first = itemsOfLayer(withLayer[0]!, target)[0]!;
        perCut.push({ index, darkSamples: dark.length, readyAtInsert: first.video?.ready ?? -1, widthAtInsert: first.video?.w ?? 0 });
        target = target === a ? b : a;
        await sleep(100);
      }
      const frames = await cast.stop();

      // The pixels the compositor produced after each cut: dark frames (scene ground rgb(13,17,23)) before the picture.
      const decoded = frames.map((frame) => new DecodedFrame(frame.t, frame.png));
      let darkPixelFrames = 0;
      let cutsWithDark = 0;
      for (const cut of switches) {
        const window = decoded.filter((frame) => frame.t >= cut.addedAt - 5 && frame.t <= cut.addedAt + 250);
        const dark = window.filter((frame) => frame.luma(CENTRE) < 20);
        darkPixelFrames += dark.length;
        if (dark.length > 0) cutsWithDark += 1;
      }
      await recordMeasurement(
        test.info(),
        'switch-09-dark-frames',
        { perCut, cutsWithDarkSamples: perCut.filter((cut) => cut.darkSamples > 0).length, cutsWithDarkPixels: cutsWithDark, darkPixelFrames, screencastFrames: decoded.length },
        `${perCut.filter((cut) => cut.darkSamples > 0).length}/50 cuts had animation frames without picture (max ${Math.max(...perCut.map((cut) => cut.darkSamples))}); ${cutsWithDark}/50 cuts had dark screencast frames (${darkPixelFrames} in total)`,
      );
      expect(perCut.map((cut) => cut.readyAtInsert).every((ready) => ready >= 2), 'at switch time the target video already has readyState >= 2').toBe(true);
      expect(perCut.every((cut) => cut.darkSamples === 0), 'no animation frame after a cut without a picture (mean luminance >= 20)').toBe(true);
      expect(darkPixelFrames, 'no dark frame in the screencast after a cut').toBe(0);
    },
  );

  test(
    'E2E-SWITCH-09 [output, cut, cold scene] a cut to a scene that is neither in the program nor in the preview shows the layer at once and the picture with the next keyframe (T-SWITCH-COLD, decision #12)',
    t.p1,
    async ({ browser, api, production, pairContext, openPhone, openLaptop, onCleanup }) => {
      test.setTimeout(300_000);
      const deps = { api, production, pairContext, openPhone, openLaptop };
      const k1 = await addCamera(deps, 'Camera One');
      const k2 = await addCamera(deps, 'Camera Two');
      const [a, b] = production.sceneIds as [string, string];
      await placeItem(api, production, a, k1.source, FULL);
      await placeItem(api, production, b, k2.source, FULL);
      await goLive(api, production);
      const { output, probe } = await openProbedOutput({ browser, onCleanup }, production, {}, { viewport: { width: 1280, height: 720 } });
      await output.waitForPlayingVideos(1);

      const rows: Array<{ index: number; to: string; layerMs: number; pictureMs: number; firstWidth: number }> = [];
      const stopCpu = startCpuMonitor();
      let target = b;
      for (let index = 0; index < 6; index++) {
        // Long enough for the output to pause the sources of the scene it left (5 s grace), so that the target is cold.
        await sleep(8000);
        await probe.takeEvents();
        await probe.startSampler({ luma: true });
        await sleep(120);
        const sw = await switchProgram(api, production, target, CUT);
        await probe.waitForScene(target, 5000);
        await sleep(2500);
        const frames = await probe.stopSampler();
        const events = await probe.takeEvents();
        const added = firstEvent(events, 'layer+', { id: target })!;
        const withLayer = frames.filter((sample) => sample.t >= added.t - 1 && sample.layers.some((layer) => layer.id === target));
        const firstOk = withLayer.findIndex((sample) => {
          const item = itemsOfLayer(sample, target)[0];
          return item !== undefined && item.state === 'live' && (item.luma ?? 0) >= 20;
        });
        rows.push({
          index,
          to: target,
          layerMs: added.t - sw.sentAt,
          pictureMs: firstOk < 0 ? Number.NaN : withLayer[firstOk]!.t - added.t,
          firstWidth: firstOk < 0 ? 0 : (itemsOfLayer(withLayer[firstOk]!, target)[0]!.video?.w ?? 0),
        });
        target = target === a ? b : a;
      }
      const machine = stopCpu();
      const gate = timingGate(machine.busyPct);
      const picture = summarize(rows.map((row) => row.pictureMs));
      const layer = summarize(rows.map((row) => row.layerMs));
      await recordMeasurement(
        test.info(),
        'switch-09-cold',
        { rows, picture, layer, machineCpuBusyPct: machine.busyPct, comparable: gate.enforce },
        `cold scene: new layer in the DOM ${fmt(layer)} ms after the request; first picture ${fmt(picture)} ms after the layer`,
      );
      await judgeTiming(test.info(), gate, () => {
        expect(rows.every((row) => Number.isFinite(row.pictureMs)), 'every cut shows a picture').toBe(true);
        expect(picture.max, 'T-SWITCH-COLD: the picture is on screen within 1.5 s of the new layer (hard)').toBeLessThanOrEqual(1500);
        expect(layer.p95, 'T-SWITCH p95 is unaffected (hard 300 ms)').toBeLessThanOrEqual(300);
      });
    },
  );

  test(
    'E2E-SWITCH-09 [output, fade] 20 fades of 300 ms between two cameras: the stage is never dark, the new picture is at least the LOW layer',
    t.p0,
    async ({ browser, api, production, pairContext, openPhone, openLaptop, onCleanup }) => {
      test.setTimeout(300_000);
      const deps = { api, production, pairContext, openPhone, openLaptop };
      const k1 = await addCamera(deps, 'Camera One');
      const k2 = await addCamera(deps, 'Camera Two');
      const [a, b] = production.sceneIds as [string, string];
      await placeItem(api, production, a, k1.source, FULL);
      await placeItem(api, production, b, k2.source, FULL);
      await goLive(api, production);
      const { output, probe } = await openProbedOutput({ browser, onCleanup }, production, {}, { viewport: { width: 1280, height: 720 } });
      await output.waitForPlayingVideos(1);
      await sleep(3000);
      const cast = await Screencast.start(output.page, { maxWidth: 320, maxHeight: 180 });
      const starts: number[] = [];
      let target = b;
      for (let index = 0; index < 20; index++) {
        // The next scene is the preview scene (Studio Mode, decision 12): its picture is ready when the fade starts.
        expect((await api.setPreview(production.id, { sceneId: target })).status).toBe(200);
        await sleep(900);
        const sw = await switchProgram(api, production, target, FADE(300));
        expect(sw.status, `fade ${index}`).toBe(200);
        starts.push(sw.sentAt);
        await probe.waitForScene(target, 5000);
        await sleep(700);
        target = target === a ? b : a;
      }
      const frames = (await cast.stop()).map((frame) => new DecodedFrame(frame.t, frame.png));
      const lumas = frames.filter((frame) => starts.some((start) => frame.t >= start - 100 && frame.t <= start + 700)).map((frame) => frame.luma(CENTRE));
      const stats = summarize(lumas);
      await recordMeasurement(test.info(), 'switch-09-fade', { frames: frames.length, lumas: stats }, `stage luminance during 20 fades: min ${stats.min.toFixed(0)}, p50 ${stats.p50.toFixed(0)}`);
      expect(lumas.length, 'frames were recorded around the fades').toBeGreaterThan(100);
      expect(stats.min, 'no dark frame while fading (mean luminance >= 20)').toBeGreaterThanOrEqual(20);
    },
  );
});
