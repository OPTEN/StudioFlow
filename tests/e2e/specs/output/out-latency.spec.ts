import { expect, test } from '../../support/ui/fixtures';
import { describeLatency } from '../../support/ui/stamp-camera';
import { collectLatencyRun } from '../../support/output/latency';
import { openProbedOutput, recordHubFrames, type HubMessage } from '../../support/output/open';
import { markTestStart } from '../../support/output/quiet';
import { fmt, judgeTiming, measureWhenQuiet, recordMeasurement, summarize, timingGate, type TimingGate } from '../../support/output/stats';
import { FULL, addCamera, addScreens, goLive, placeItem, switchProgram, type WorldDeps } from '../../support/output/world';
import { t } from '../../support/tags';

/**
 * Glass-to-glass latency of the direct LiveKit path (docs/testing.md E2E-OUT-13, -14; plan target about 150 ms, acceptance
 * below 200 ms): a stamp camera (or stamp screen) in a real sender -> the SFU -> the output page opened with `?latency=1`,
 * which decodes the stamp of every presented frame. Sender and output run in browsers on the same machine, so they share
 * the clock. The CPU use of the whole machine during each run is recorded next to the figures.
 *
 * A latency figure only means something if the machine had headroom: the senders encode in software and the stack, the
 * senders and the output share the cores (a 2-vCPU runner never gets quiet, issue #39). So (docs/testing.md 6.8):
 * - waiting for a quiet machine is bounded by the time budget of the test (`measureWhenQuiet`), never into the timeout;
 * - what does not depend on the load (stamps increase, a picture is decoded at all) is always enforced;
 * - the absolute thresholds are enforced only if the run was taken at 60 % CPU or less (`judgeTiming`): on a busier
 *   machine a pass is a pass, a failure ends in a skip that says "not comparable";
 * - the tests with the full run time carry `@perf` (project `perf`, a machine with at least 4 cores and nothing else
 *   running); a short camera run stays in the nightly full run.
 */

const reportedLatencies = (frames: HubMessage[]): number[] =>
  frames
    .filter((message) => message.target === 'Report')
    .map((message) => (message.arguments as Array<{ latencyMs: number | null }>)[0]!.latencyMs)
    .filter((value): value is number => typeof value === 'number');

interface CameraRunFixtures {
  browser: Parameters<typeof openProbedOutput>[0]['browser'];
  onCleanup: Parameters<typeof openProbedOutput>[0]['onCleanup'];
  deps: WorldDeps;
}

/** A stamped 720p camera in a scene of its own, the output at 1920 x 1080 with the stamp decoder, and one latency run. */
async function cameraLatencyRun(fixtures: CameraRunFixtures, name: string, options: { durationMs: number; warmupMs: number; attempts: number }) {
  const { browser, onCleanup, deps } = fixtures;
  const { api, production } = deps;
  const camera = await addCamera(deps, 'Camera Latency', { camera: { width: 1280, height: 720, fps: 30 } });
  await placeItem(api, production, production.sceneIds[0]!, camera.source, FULL);
  await goLive(api, production);
  const frames: { sent: HubMessage[]; received: HubMessage[] } = { sent: [], received: [] };
  const { output } = await openProbedOutput({ browser, onCleanup }, production, { latency: true }, {
    viewport: { width: 1920, height: 1080 },
    onPage: (page) => Object.assign(frames, recordHubFrames(page)),
  });
  await output.waitForPlayingVideos(1, { minFps: 10, timeout: 45_000 });
  // Wait for a quiet machine as long as the test can afford; up to `attempts` runs, the first at 60 % CPU or less counts.
  const measured = await measureWhenQuiet(() => collectLatencyRun(output, { durationMs: options.durationMs, warmupMs: options.warmupMs, sourceId: camera.source }), {
    testInfo: test.info(),
    runMs: options.durationMs + options.warmupMs + 5000,
    attempts: options.attempts,
  });
  const run = measured.chosen;
  const cpu = run.cpu;
  const estimate = summarize(reportedLatencies(frames.sent));
  const gate = timingGate(cpu.busyPct);
  const summary = describeLatency(run.samples, {});
  await recordMeasurement(
    test.info(),
    name,
    {
      stats: run.stats,
      rawStats: run.rawStats,
      laggingFrames: run.dropped,
      frames: run.samples.length,
      presented: run.presented,
      undecodedShare: run.presented ? run.undecoded / run.presented : null,
      backwardsStamps: run.backwardsStamps,
      widths: run.widths,
      codec: 'H.264 simulcast (sender), direct LiveKit path',
      machineCpuBusyPct: cpu.busyPct,
      cores: cpu.cores,
      comparable: gate.enforce,
      stoppedBecause: measured.stoppedBecause,
      waitedForQuietMs: measured.waitedMs,
      reportedEstimate: estimate,
      attempts: measured.attempts.map((attempt) => ({ p50: attempt.stats.p50, p95: attempt.stats.p95, frames: attempt.samples.length, cpuBusyPct: attempt.cpu.busyPct, waitedMs: attempt.waitedMs })),
      targetMs: 150,
      acceptanceMs: 200,
      windowMs: run.windowMs,
    },
    `${summary.summary}; target p50 <= 150 ms ${run.stats.p50 <= 150 ? 'met' : 'not met'}; reported estimate mean ${estimate.mean.toFixed(0)} ms; machine CPU ${cpu.busyPct} % of ${cpu.cores} cores${gate.enforce ? '' : ' (not comparable)'}`,
  );
  return { run, gate, estimate, hasEstimate: estimate.count > 0 };
}

/** What every camera run must show, whatever the machine does, and the thresholds that need headroom. */
async function expectCameraLatency(result: Awaited<ReturnType<typeof cameraLatencyRun>>, expected: { minSamples: number; seconds: number }): Promise<void> {
  const { run, gate, estimate, hasEstimate } = result;
  expect(run.samples.length, `the stamp is decoded at least once a second (${run.samples.length} samples in ${expected.seconds} s)`).toBeGreaterThanOrEqual(expected.seconds);
  expect(run.backwardsStamps, 'decoded timestamps increase').toBe(0);
  await judgeTiming(test.info(), gate, () => {
    expect(run.samples.length, `enough decoded frames over ${expected.seconds} s (30 fps)`).toBeGreaterThanOrEqual(expected.minSamples);
    expect(run.presented ? run.undecoded / run.presented : 1, 'checksum failures / undecodable frames below 5 %').toBeLessThan(0.05);
    expect(run.dropped / (run.dropped + run.samples.length), 'frames with a lagging stamp below 5 % (camera, H.264)').toBeLessThan(0.05);
    expect(run.stats.p50, `T-LATENCY p50 (acceptance < 200 ms, target 150 ms): ${fmt(run.stats)}`).toBeLessThan(200);
    expect(run.stats.p95, 'T-LATENCY p95 (acceptance < 300 ms)').toBeLessThan(300);
    // The page's own estimate (RTT/2 + jitter buffer) is informational: it leaves out capture, encode, decode and render.
    if (hasEstimate) expect(Math.abs(estimate.mean - run.stats.mean), `|estimate ${estimate.mean.toFixed(0)} - measured ${run.stats.mean.toFixed(0)}| (informational)`).toBeLessThan(250);
  });
}

test.describe('OUT latency', () => {
  // The waiting for a quiet machine has to know how much of the timeout the set-up used.
  test.beforeEach(({}, testInfo) => markTestStart(testInfo));

  test(
    'E2E-OUT-13 [latency, camera] glass-to-glass latency of a stamped camera over 60 s: p50 below 200 ms, p95 below 300 ms (target 150 ms)',
    t.perf('@p0'),
    async ({ browser, api, production, pairContext, openPhone, openLaptop, onCleanup }) => {
      test.setTimeout(900_000);
      const deps = { api, production, pairContext, openPhone, openLaptop };
      const result = await cameraLatencyRun({ browser, onCleanup, deps }, 'out-13-latency-camera', { durationMs: 60_000, warmupMs: 6000, attempts: 3 });
      await expectCameraLatency(result, { minSamples: 1200, seconds: 60 });
    },
  );

  test(
    'E2E-OUT-13 [latency, camera, short] glass-to-glass latency of a stamped camera over 20 s: the stamps are decoded and increase; p50 below 200 ms and p95 below 300 ms where the machine has headroom',
    t.p1,
    async ({ browser, api, production, pairContext, openPhone, openLaptop, onCleanup }) => {
      test.setTimeout(300_000);
      const deps = { api, production, pairContext, openPhone, openLaptop };
      const result = await cameraLatencyRun({ browser, onCleanup, deps }, 'out-13-latency-camera-short', { durationMs: 20_000, warmupMs: 5000, attempts: 2 });
      await expectCameraLatency(result, { minSamples: 400, seconds: 20 });
    },
  );

  test(
    'E2E-OUT-13 [latency, screen] glass-to-glass latency of a stamped screen share (VP9) over 30 s',
    t.perf('@p1'),
    async ({ browser, api, production, pairContext, openPhone, openLaptop, onCleanup }) => {
      test.setTimeout(600_000);
      const deps = { api, production, pairContext, openPhone, openLaptop };
      const screens = await addScreens(deps, 'Laptop Latency', 1);
      await placeItem(api, production, production.sceneIds[0]!, screens.sources[0]!, FULL);
      await goLive(api, production);
      const { output } = await openProbedOutput({ browser, onCleanup }, production, { latency: true }, { viewport: { width: 1920, height: 1080 } });
      await output.waitForPlayingVideos(1, { minFps: 5, timeout: 45_000 });
      const measured = await measureWhenQuiet(() => collectLatencyRun(output, { durationMs: 30_000, warmupMs: 5000, sourceId: screens.sources[0]!, lagFilter: true }), {
        testInfo: test.info(),
        runMs: 30_000 + 5000 + 5000,
        attempts: 3,
      });
      const run = measured.chosen;
      const cpu = run.cpu;
      const gate = timingGate(cpu.busyPct);
      await recordMeasurement(
        test.info(),
        'out-13-latency-screen',
        {
          attempts: measured.attempts.map((attempt) => ({ p50: attempt.stats.p50, p95: attempt.stats.p95, cpuBusyPct: attempt.cpu.busyPct })),
          stats: run.stats,
          rawStats: run.rawStats,
          laggingFrames: run.dropped,
          frames: run.samples.length,
          presented: run.presented,
          undecodedShare: run.presented ? run.undecoded / run.presented : null,
          widths: run.widths,
          codec: 'VP9 screen share',
          machineCpuBusyPct: cpu.busyPct,
          comparable: gate.enforce,
          stoppedBecause: measured.stoppedBecause,
          waitedForQuietMs: measured.waitedMs,
        },
        `${describeLatency(run.samples, {}).summary}; machine CPU ${cpu.busyPct} %${gate.enforce ? '' : ' (not comparable)'}`,
      );
      expect(run.samples.length, 'the stamp is decoded at least once a second').toBeGreaterThanOrEqual(30);
      // VP9 screen content refreshes the changed high-order stamp blocks a frame or two late (up to ~30 % of the frames read
      // a stamp that is 2^k ms too old, see lagFilter in support/output/latency.ts): the figure is the one-sided corrected one.
      expect(run.backwardsStamps, 'the corrected timestamps increase (at most one step back in 200 frames)').toBeLessThanOrEqual(Math.ceil(run.samples.length / 200));
      await judgeTiming(test.info(), gate, () => {
        expect(run.samples.length, 'decoded frames').toBeGreaterThanOrEqual(300);
        expect(run.stats.p50, 'T-LATENCY p50 < 200 ms').toBeLessThan(200);
        expect(run.stats.p95, 'T-LATENCY p95 < 300 ms').toBeLessThan(300);
      });
    },
  );

  test(
    'E2E-OUT-14 [latency, switching] a cut every 5 s between two scenes with the camera for 120 s: p95 stays within 50 ms of the static case, no spike above 500 ms',
    t.perf('@p1'),
    async ({ browser, api, production, pairContext, openPhone, openLaptop, onCleanup }) => {
      test.setTimeout(900_000);
      const deps = { api, production, pairContext, openPhone, openLaptop };
      const camera = await addCamera(deps, 'Camera Latency', { camera: { width: 1280, height: 720, fps: 30 } });
      const [a, b] = production.sceneIds as [string, string];
      await placeItem(api, production, a, camera.source, FULL);
      await placeItem(api, production, b, camera.source, { x: 160, y: 90, w: 1600, h: 900, fit: 'cover', radius: 24 });
      await goLive(api, production);
      const { output } = await openProbedOutput({ browser, onCleanup }, production, { latency: true }, { viewport: { width: 1920, height: 1080 } });
      await output.waitForPlayingVideos(1, { minFps: 10, timeout: 45_000 });
      const measured = await measureWhenQuiet(
        async () => {
          expect((await switchProgram(api, production, a)).status).toBe(200);
          const statics = await collectLatencyRun(output, { durationMs: 30_000, warmupMs: 5000, sourceId: camera.source });
          let target = b;
          let lastSwitch = Date.now();
          let switches = 0;
          const switching = await collectLatencyRun(output, {
            durationMs: 120_000,
            warmupMs: 1000,
            sourceId: camera.source,
            pollMs: 1000,
            onPoll: async () => {
              if (Date.now() - lastSwitch >= 5000) {
                lastSwitch = Date.now();
                expect((await switchProgram(api, production, target)).status).toBe(200);
                target = target === a ? b : a;
                switches += 1;
              }
            },
          });
          return { statics, switching, switches };
        },
        { testInfo: test.info(), runMs: 30_000 + 5000 + 120_000 + 1000 + 10_000, attempts: 2, maxBusyPct: 60 },
      );
      const { statics, switching, switches } = measured.chosen;
      const gate: TimingGate = timingGate(measured.chosen.cpu.busyPct);
      await recordMeasurement(
        test.info(),
        'out-14-latency-switching',
        {
          static: statics.stats,
          switching: switching.stats,
          switches,
          widthsStatic: statics.widths,
          widthsSwitching: switching.widths,
          machineCpuBusyPct: measured.chosen.cpu.busyPct,
          comparable: gate.enforce,
          stoppedBecause: measured.stoppedBecause,
          waitedForQuietMs: measured.waitedMs,
          attempts: measured.attempts.map((attempt) => ({ staticP95: attempt.statics.stats.p95, switchingP95: attempt.switching.stats.p95, cpuBusyPct: attempt.cpu.busyPct })),
        },
        `static ${fmt(statics.stats)}; with ${switches} cuts ${fmt(switching.stats)}; machine CPU ${measured.chosen.cpu.busyPct} %${gate.enforce ? '' : ' (not comparable)'}`,
      );
      expect(switches, 'a cut every 5 s').toBeGreaterThanOrEqual(20);
      expect(switching.samples.length, 'the stamp is decoded while the program switches').toBeGreaterThanOrEqual(120);
      await judgeTiming(test.info(), gate, () => {
        expect(switching.stats.p95, `p95 within +50 ms of the static case (${statics.stats.p95.toFixed(0)} ms)`).toBeLessThanOrEqual(statics.stats.p95 + 50);
        expect(switching.stats.max, 'no latency spike above 500 ms').toBeLessThanOrEqual(500);
      });
    },
  );
});
