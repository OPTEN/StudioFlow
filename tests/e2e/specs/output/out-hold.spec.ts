import { makePng } from '../../support/media-samples';
import { expect, test } from '../../support/ui/fixtures';
import { colorsClose } from '../../support/ui/pixels';
import { sleep } from '../../support/output/analysis';
import { openProbedOutput } from '../../support/output/open';
import { DecodedFrame, Screencast } from '../../support/output/screencast';
import { recordMeasurement } from '../../support/output/stats';
import { addCamera, goLive, placeItem } from '../../support/output/world';
import type { ProbeFrame, ProbeItem } from '../../support/output/probe';
import { t } from '../../support/tags';

/**
 * Hold frame, held state, fallback and recovery on the output (docs/testing.md E2E-OUT-06, E2E-OUT-07; spec 8.3: «Standbild
 * 3 s, dann abgedunkelt»). The output derives the state purely from the LiveKit track of the source; the specs make the
 * source go away by closing or stopping the real sender and read the state from the DOM (probe: hold frame canvas shown =
 * `hold`, `.sf-r-held` shown = `held`, `.sf-r-fallback` shown = `fallback`).
 */

interface Placed {
  name: string;
  holdMs: number | null;
  rect: { x: number; y: number; w: number; h: number };
}

const PLAN: Placed[] = [
  { name: 'K1 breit', holdMs: 3000, rect: { x: 0, y: 0, w: 1360, h: 765 } },
  { name: 'K2 schmal', holdMs: 3000, rect: { x: 1420, y: 0, w: 300, h: 169 } },
  { name: 'K3 halten', holdMs: null, rect: { x: 0, y: 790, w: 480, h: 270 } },
  { name: 'K4 zehn', holdMs: 10_000, rect: { x: 520, y: 790, w: 480, h: 270 } },
];

function stateAt(frame: ProbeFrame, id: string): ProbeItem | undefined {
  return frame.items.find((item) => item.id === id);
}

test.describe('OUT hold frame', () => {
  test(
    'E2E-OUT-06 [output, hold and held] a source that goes away keeps its last frame, turns blurred and dark after holdMs (3 s / 10 s / never) and comes back without a black frame',
    t.smoke,
    async ({ browser, api, production, pairContext, openPhone, openLaptop, onCleanup }) => {
      test.setTimeout(300_000);
      const deps = { api, production, pairContext, openPhone, openLaptop };
      const scene = production.sceneIds[0]!;
      const cameras = [];
      const items = [];
      for (const plan of PLAN) {
        const camera = await addCamera(deps, plan.name);
        cameras.push(camera);
        items.push(await placeItem(api, production, scene, camera.source, { ...plan.rect, fit: 'cover', radius: 0, holdMs: plan.holdMs }));
      }
      await goLive(api, production);
      const { output, probe } = await openProbedOutput({ browser, onCleanup }, production, {}, { viewport: { width: 1920, height: 1080 } });
      await output.waitForPlayingVideos(4, { minFps: 8, timeout: 45_000 });
      for (const item of items) await probe.waitForItemState(item.id, 'live');
      await sleep(2500); // the rolling hold frames are refreshed about once per second

      // The pages close; the senders leave. The output notices when LiveKit reports the track gone.
      await probe.startSampler({ luma: true });
      await sleep(300);
      const closedAt = Date.now();
      await Promise.all(cameras.map((camera) => camera.phone.page.close()));
      const items4 = items.map((item) => item.id);
      const k1 = items4[0]!;
      const k1Area = { x: 60, y: 60, width: 1100, height: 600 };
      // Frozen: while K1 is in hold its area does not change between two screenshots 1.2 s apart (a live camera moves).
      await probe.waitForItemState(k1, 'hold', 40_000);
      const noticeMs = Date.now() - closedAt;
      const hold1 = await output.stagePixels();
      await sleep(1200);
      const hold2 = await output.stagePixels();
      expect((await probe.snapshot()).items.find((item) => item.id === k1)!.state, 'still in hold when the second screenshot was taken').toBe('hold');
      const a1 = hold1.mean(k1Area);
      const a2 = hold2.mean(k1Area);
      for (const channel of [0, 1, 2]) expect(Math.abs(a1[channel]! - a2[channel]!), 'the hold picture is frozen (channel ' + channel + ')').toBeLessThanOrEqual(1.5);
      const holdLuma = hold1.image.meanLuma({ x: k1Area.x * hold1.scale, y: k1Area.y * hold1.scale, width: k1Area.width * hold1.scale, height: k1Area.height * hold1.scale });
      expect(holdLuma, 'hold: the last picture is not black').toBeGreaterThanOrEqual(20);
      // Darkened: after the hold time the same area is darker, but not black.
      await probe.waitForItemState(k1, 'held', 10_000);
      await sleep(400);
      const held = await output.stagePixels();
      const heldLuma = held.image.meanLuma({ x: k1Area.x * held.scale, y: k1Area.y * held.scale, width: k1Area.width * held.scale, height: k1Area.height * held.scale });
      expect(heldLuma, 'held is darker than hold (' + holdLuma.toFixed(0) + ' -> ' + heldLuma.toFixed(0) + ')').toBeLessThan(holdLuma * 0.8);
      expect(heldLuma, 'but not black').toBeGreaterThanOrEqual(12);
      // Watch the held states: K4 (10 s) is the last to turn.
      await probe.waitForItemState(items4[3]!, 'held', 20_000);
      await sleep(500);
      const frames = await probe.stopSampler();

      const firstWith = (id: string, state: string) => frames.find((frame) => stateAt(frame, id)?.state === state);
      const rows = PLAN.map((plan, index) => {
        const id = items4[index]!;
        const hold = firstWith(id, 'hold');
        const heldFrame = firstWith(id, 'held');
        return { name: plan.name, holdMs: plan.holdMs, holdAt: hold?.t, heldAt: heldFrame?.t, measured: hold && heldFrame ? heldFrame.t - hold.t : null };
      });
      await recordMeasurement(test.info(), 'out-06-hold', { noticeMs, rows }, `the output noticed the loss after ${noticeMs} ms; hold->held ${rows.map((row) => `${row.name}: ${row.measured === null ? 'never' : Math.round(row.measured)} ms`).join(', ')}`);

      // Never black, never an empty item: the state sequence of every item is live -> hold [-> held] without gaps.
      for (const [index, plan] of PLAN.entries()) {
        const id = items4[index]!;
        const sequence = frames.map((frame) => stateAt(frame, id)?.state).filter((state, position, all) => state !== all[position - 1]);
        expect(sequence, `${plan.name}: states over time`).toEqual(plan.holdMs === null ? ['live', 'hold'] : ['live', 'hold', 'held']);
        const lumas = frames.map((frame) => stateAt(frame, id)).filter((item) => item && (item.state === 'hold' || item.state === 'held')).map((item) => item!.luma ?? 0);
        expect(Math.min(...lumas), `${plan.name}: the lost picture is never black`).toBeGreaterThanOrEqual(12);
      }

      // T-HOLD: hold -> held within the hold time (hard +-300 ms).
      const byName = new Map(rows.map((row) => [row.name, row]));
      for (const [name, expected] of [['K1 breit', 3000], ['K2 schmal', 3000], ['K4 zehn', 10_000]] as const) {
        const row = byName.get(name)!;
        expect(row.measured, `${name}: held reached`).not.toBeNull();
        expect(Math.abs(row.measured! - expected), `T-HOLD ${name}: ${Math.round(row.measured!)} ms for ${expected} ms (hard +-300)`).toBeLessThanOrEqual(300);
      }
      expect(byName.get('K3 halten')!.heldAt, 'holdMs null never escalates').toBeUndefined();

      // The held look: blur 2.5 % of the item width, scrim rgba(13,17,23,.72), message only on items >= 320 px wide.
      const look = await (await output.frame()).evaluate((ids) => {
        const out: Record<string, { blur: string; scrim: string; text: string; textDisplay: string; heldDisplay: string }> = {};
        for (const id of ids) {
          const item = document.querySelector(`[data-item-id="${id}"]`)!;
          const held = item.querySelector('.sf-r-held') as HTMLElement;
          const text = item.querySelector('.sf-r-held-text') as HTMLElement;
          out[id] = {
            blur: getComputedStyle(item.querySelector('.sf-r-box')!).filter,
            scrim: getComputedStyle(held).backgroundColor,
            text: text.textContent ?? '',
            textDisplay: getComputedStyle(text).display,
            heldDisplay: getComputedStyle(held).display,
          };
        }
        return out;
      }, items4);
      const blurPx = (id: string) => Number(/blur\(([\d.]+)px\)/.exec(look[id]!.blur)?.[1] ?? NaN);
      expect(Math.abs(blurPx(items4[0]!) - 34), `K1 blur ${look[items4[0]!]!.blur} is 2.5 % of 1360 px (34 px)`).toBeLessThanOrEqual(1);
      expect(Math.abs(blurPx(items4[1]!) - 7.5), `K2 blur ${look[items4[1]!]!.blur} is 2.5 % of 300 px`).toBeLessThanOrEqual(1);
      for (const id of [items4[0]!, items4[1]!, items4[3]!]) {
        expect(look[id]!.scrim.replace(/\s/g, ''), 'scrim colour').toBe('rgba(13,17,23,0.72)');
        expect(look[id]!.heldDisplay).toBe('flex');
        expect(look[id]!.text).toBe('Bild kommt gleich zurück');
      }
      expect(look[items4[0]!]!.textDisplay, 'K1 (1360 px) shows the message').not.toBe('none');
      expect(look[items4[1]!]!.textDisplay, 'K2 (300 px) shows no message').toBe('none');
      expect(look[items4[3]!]!.textDisplay, 'K4 (480 px) shows the message').not.toBe('none');
      expect(look[items4[2]!]!.heldDisplay, 'K3 (hold for ever) is not darkened').toBe('none');
      // The pixels: a darkened, blurred but not black picture.
      const stage = await output.stagePixels();
      const k1Mean = stage.mean({ x: 100, y: 100, width: 1100, height: 600 });
      expect(k1Mean[0] + k1Mean[1] + k1Mean[2], 'the held picture is not black').toBeGreaterThan(40);

      // K3 stays in hold: look at it for a minute (the K4 timer started 10 s after the loss, so ~50 s remain).
      const waitedSince = firstWith(items4[2]!, 'hold')!.t;
      const remaining = Math.max(0, 60_000 - (Date.now() - waitedSince));
      const seen = new Set<string>();
      const end = Date.now() + remaining;
      while (Date.now() < end) {
        seen.add((await probe.snapshot()).items.find((item) => item.id === items4[2])?.state ?? 'gone');
        await sleep(1000);
      }
      expect([...seen], 'K3 (holdMs null) stays in hold for a minute').toEqual(['hold']);

      // Recovery: K1's sender page opens again (credentials in storage, camera starts by itself); the picture returns
      // without a black frame in between and the held look is removed.
      const cast = await Screencast.start(output.page, { maxWidth: 480, maxHeight: 270 });
      const { PhoneSender } = await import('../../support/ui/sender');
      const again = await PhoneSender.inContext(cameras[0]!.phone.context, 'pixel7');
      await again.gotoStart();
      const reopenedAt = Date.now();
      await probe.startSampler({ luma: true });
      await probe.waitForItemState(k1, 'live', 45_000);
      const liveAt = Date.now();
      await sleep(1500);
      const afterFrames = await probe.stopSampler();
      const castFrames = (await cast.stop()).map((frame) => new DecodedFrame(frame.t, frame.png));
      const recovery = afterFrames.filter((frame) => frame.t >= reopenedAt);
      const darkProbe = recovery.filter((frame) => {
        const item = stateAt(frame, k1);
        return item && (item.luma ?? 0) < 20;
      });
      expect(darkProbe.length, 'no black frame while the held picture is replaced by the live one (probe)').toBe(0);
      const darkPixels = castFrames.filter((frame) => frame.t >= reopenedAt && frame.luma({ x: 0.1, y: 0.1, width: 0.4, height: 0.4 }) < 12);
      expect(darkPixels.length, 'no black frame in the screencast').toBe(0);
      const live = stateAt(afterFrames.at(-1)!, k1)!;
      expect(live.state).toBe('live');
      expect(live.blur, 'blur removed').toBe('none');
      await recordMeasurement(test.info(), 'out-06-recovery', { reopenToLiveMs: liveAt - reopenedAt }, `K1 page reopened -> live on the output after ${liveAt - reopenedAt} ms`);
    },
  );

  test(
    'E2E-OUT-07 [output, fallback] after holdMs a fallback image or camera replaces the held picture; the source coming back removes it',
    t.p1,
    async ({ browser, api, production, pairContext, openPhone, openLaptop, onCleanup }) => {
      test.setTimeout(240_000);
      const deps = { api, production, pairContext, openPhone, openLaptop };
      const scene = production.sceneIds[0]!;
      const k1 = await addCamera(deps, 'Kamera Eins');
      const k2 = await addCamera(deps, 'Kamera Zwei');
      const uploaded = await api.uploadAsset(production.id, { fileName: 'Pause-Slate.png', contentType: 'image/png', data: makePng(1920, 1080, [230, 120, 20]) });
      expect(uploaded.status, uploaded.raw.text().slice(0, 200)).toBe(201);
      const asset = uploaded.body;
      // K1 fills the left two thirds; its fallback is the image. K2 is shown at the right as a small picture.
      const item = await placeItem(api, production, scene, k1.source, { x: 0, y: 0, w: 1280, h: 720, fit: 'cover', radius: 0, holdMs: 1000, fallback: asset.id });
      await placeItem(api, production, scene, k2.source, { x: 1360, y: 0, w: 480, h: 270, fit: 'cover', radius: 0 });
      await goLive(api, production);
      const { output, probe } = await openProbedOutput({ browser, onCleanup }, production, {}, { viewport: { width: 1920, height: 1080 } });
      await output.waitForPlayingVideos(2, { minFps: 8, timeout: 45_000 });
      await probe.waitForItemState(item.id, 'live');
      await sleep(2000);

      // The asset is used as fallback: it cannot be deleted.
      expect((await api.deleteAsset(production.id, asset.id)).status, 'a fallback asset is in use').toBe(409);

      // 1. Image fallback.
      await k1.phone.stopCamera();
      await probe.waitForItemState(item.id, 'hold', 20_000);
      await probe.waitForItemState(item.id, 'fallback', 10_000);
      const frame = await output.frame();
      const fallback = await frame.evaluate((id) => {
        const root = document.querySelector(`[data-item-id="${id}"]`)!;
        const fb = root.querySelector('.sf-r-fallback') as HTMLElement;
        const img = fb.querySelector('img');
        return {
          display: getComputedStyle(fb).display,
          image: img ? { natural: img.naturalWidth, src: img.src } : null,
          blur: getComputedStyle(root.querySelector('.sf-r-box')!).filter,
          held: getComputedStyle(root.querySelector('.sf-r-held')!).display,
        };
      }, item.id);
      expect(fallback.image?.natural, 'the fallback image is loaded').toBe(1920);
      expect(fallback.image?.src, 'loaded with the output key').toContain('?k=');
      expect(fallback.blur, 'no blur on the fallback').toBe('none');
      expect(fallback.held, 'no scrim and no message on the fallback').toBe('none');
      const stage = await output.stagePixels();
      expect(colorsClose(stage.at(640, 360), '#e67814', 40), 'the item shows the fallback image (orange)').toBe(true);
      // K1 is back: the fallback goes, the live picture returns.
      await k1.phone.startCamera();
      await probe.waitForItemState(item.id, 'live', 45_000);
      const back = await output.waitForPlayingVideos(2, { minFps: 8 });
      expect(back.length).toBe(2);
      expect((await probe.snapshot()).items.find((entry) => entry.id === item.id)!.blur, 'blur removed').toBe('none');

      // 2. A live camera as fallback.
      const updated = await api.updateSceneItem(production.id, scene, item.id, { ...item, onLost: { holdMs: 1000, fallbackSource: k2.source } });
      expect(updated.status, updated.raw.text().slice(0, 200)).toBe(200);
      await sleep(1000);
      await k1.phone.stopCamera();
      await probe.waitForItemState(item.id, 'fallback', 20_000);
      const camera = await frame.evaluate((id) => {
        const video = document.querySelector(`[data-item-id="${id}"] .sf-r-fallback video`) as HTMLVideoElement | null;
        return video ? { w: video.videoWidth, ready: video.readyState, paused: video.paused } : null;
      }, item.id);
      expect(camera, 'the fallback camera is a video element in the item').not.toBeNull();
      await expect
        .poll(() => frame.evaluate((id) => {
          const video = document.querySelector(`[data-item-id="${id}"] .sf-r-fallback video`) as HTMLVideoElement;
          return video.getVideoPlaybackQuality().totalVideoFrames;
        }, item.id).then(async (first) => { await sleep(700); return (await frame.evaluate((id) => (document.querySelector(`[data-item-id="${id}"] .sf-r-fallback video`) as HTMLVideoElement).getVideoPlaybackQuality().totalVideoFrames, item.id)) - first; }), { timeout: 15_000, message: 'the fallback camera shows moving frames' })
        .toBeGreaterThan(5);
      await k1.phone.startCamera();
      await probe.waitForItemState(item.id, 'live', 45_000);
      expect(
        await frame.evaluate((id) => getComputedStyle(document.querySelector(`[data-item-id="${id}"] .sf-r-fallback`)!).display, item.id),
        'the fallback is removed when K1 returns',
      ).toBe('none');
    },
  );
});
