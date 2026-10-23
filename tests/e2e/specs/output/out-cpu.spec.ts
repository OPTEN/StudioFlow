import type { Frame } from '@playwright/test';
import { expect, test } from '../../support/ui/fixtures';
import { sleep } from '../../support/output/analysis';
import { openProbedOutput } from '../../support/output/open';
import { inboundOf } from '../../support/output/rtc';
import { recordMeasurement, summarize } from '../../support/output/stats';
import { addCamera, goLive, placeItem } from '../../support/output/world';
import { t } from '../../support/tags';

/**
 * E2E-NET-20 for the output page (docs/testing.md, T-FPS): the output keeps its frame rate and its connection when the
 * CPU of the proxy machine is four times slower (CDP `Emulation.setCPUThrottlingRate`). Two cameras side by side, 1080p.
 */

async function rafFps(frame: Frame, ms = 3000): Promise<number> {
  return frame.evaluate(
    (window) =>
      new Promise<number>((resolve) => {
        let frames = 0;
        const start = performance.now();
        const tick = () => {
          frames += 1;
          if (performance.now() - start >= window) resolve((frames * 1000) / (performance.now() - start));
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    ms,
  );
}

test.describe('OUT under CPU load', () => {
  test(
    'E2E-NET-20 [output, CPU throttling 4x] with a four times slower CPU the output still renders at 20 fps or more, stays connected (never stale) and its pictures keep moving',
    t.perf('@p1'),
    async ({ browser, api, production, pairContext, openPhone, openLaptop, onCleanup }) => {
      test.setTimeout(300_000);
      const deps = { api, production, pairContext, openPhone, openLaptop };
      const cameras = [await addCamera(deps, 'Kamera Eins'), await addCamera(deps, 'Kamera Zwei')];
      const scene = production.sceneIds[0]!;
      await placeItem(api, production, scene, cameras[0]!.source, { x: 0, y: 270, w: 960, h: 540, fit: 'cover', radius: 0 });
      await placeItem(api, production, scene, cameras[1]!.source, { x: 960, y: 270, w: 960, h: 540, fit: 'cover', radius: 0 });
      await goLive(api, production);
      const { output, context } = await openProbedOutput({ browser, onCleanup }, production, {}, { viewport: { width: 1920, height: 1080 } });
      await output.waitForPlayingVideos(2, { minFps: 8, timeout: 60_000 });
      const frame = await output.frame();
      await expect.poll(async () => (await api.getSnapshot(production.id)).body.outputStatus.state, { timeout: 15_000 }).toBe('connected');
      await sleep(3000);
      const baseline = [await rafFps(frame), await rafFps(frame), await rafFps(frame)];

      const cdp = await context.newCDPSession(output.page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      const states = new Set<string>();
      const fps: number[] = [];
      const decode: number[] = [];
      const started = Date.now();
      let before = await inboundOf(frame, production, cameras[0]!.source);
      let beforeAt = Date.now();
      while (Date.now() - started < 30_000) {
        fps.push(await rafFps(frame));
        states.add((await api.getSnapshot(production.id)).body.outputStatus.state);
        const after = await inboundOf(frame, production, cameras[0]!.source);
        if (before && after) decode.push((after.framesDecoded - before.framesDecoded) / ((Date.now() - beforeAt) / 1000));
        before = after;
        beforeAt = Date.now();
      }
      const still = await output.waitForPlayingVideos(2, { minFps: 5, timeout: 20_000 });
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
      const stats = summarize(fps);
      await recordMeasurement(
        test.info(),
        'net-20-cpu-throttle',
        { baselineFps: baseline, throttledFps: stats, decodeFps: summarize(decode), statesSeen: [...states], videosAtTheEnd: still.map((entry) => entry.fps) },
        `rAF fps ${baseline.map((value) => value.toFixed(0)).join('/')} without throttle, p50 ${stats.p50.toFixed(1)} / min ${stats.min.toFixed(1)} at 4x; decode ${summarize(decode).p50.toFixed(1)} fps; output states ${[...states].join('/')}`,
      );
      expect(stats.p50, 'T-FPS at CPU throttle 4x: the output renders at 20 fps or more (hard)').toBeGreaterThanOrEqual(20);
      expect([...states], 'the Regie never sees the output as stale or gone').toEqual(['connected']);
      expect(summarize(decode).p50, 'the pictures are still decoded').toBeGreaterThanOrEqual(15);
    },
  );
});
