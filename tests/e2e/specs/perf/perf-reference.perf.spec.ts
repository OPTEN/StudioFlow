import { expect, test } from '../../support/ui/fixtures';
import { sleep } from '../../support/output/analysis';
import { judgeTiming, recordMeasurement, startCpuMonitor, type TimingGate } from '../../support/output/stats';
import { t } from '../../support/tags';
import { profileMainThread } from '../../support/perf/cpu';
import { BUDGET, checkBudgetParts, flatten, type PerfSummary } from '../../support/perf/budget';
import {
  COLD_SCENE,
  Meters,
  PREVIEW_SCENE,
  REFERENCE,
  SCENE_NAMES,
  buildReferenceWorld,
  measureDragging,
  measureIdle,
  measureSwitch,
  sourcesOfStreams,
  type WindowResult,
} from '../../support/perf/reference';

/**
 * E2E-PERF-01 (docs/testing.md 2.20, issue #12): the reference scenario with fake media, measured per role, then compared
 * with the performance budget. This container has no GPU (Chromium renders with SwiftShader and every codec runs in
 * software), so the numbers are the worst case of "no hardware acceleration" and a way to compare two builds on the same
 * machine. They do not replace the manual series of measurements on real devices (MAN-16).
 *
 * `PERF_SECONDS` scales the measuring windows (default 45 s idle, 15 s dragging). `PERF_BUDGET_SCALE` multiplies the
 * budgets that depend on the speed of the machine (CPU, main thread, switching time), see support/perf/budget.ts: counts
 * (decoded streams, videos) are exact, loads may exceed the budget by 20 %. The animation frame rate of the Regie while
 * dragging is recorded but not budgeted: with software compositing on a machine that is fully busy it swings from 2 to 30.
 */

const SECONDS = Number(process.env['PERF_SECONDS'] ?? 45);
const DRAG_SECONDS = Math.max(8, Math.round(SECONDS / 3));
const PROFILE_SECONDS = Number(process.env['PERF_PROFILE_SECONDS'] ?? 12);

function summarizeWindow(window: WindowResult): PerfSummary['idle'] {
  const slotOf = (names: readonly string[]) => window.senders.streams.filter((stream) => names.some((name) => stream.name.startsWith(name)));
  const screens = slotOf(['Laptop']);
  const phones = slotOf(['Phone']);
  const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
  return {
    seconds: window.seconds,
    machineBusy: window.machineBusy,
    dom: { output: window.dom.output, regie: window.dom.regie },
    output: {
      cores: window.output.cpu.cores,
      coresByType: window.output.cpu.coresByType,
      mainThreadBusy: window.output.mainThread.busyShare,
      decodedStreams: window.output.decode.decodedStreams,
      subscribedStreams: window.output.decode.subscribed,
      softwareStreams: window.output.decode.softwareStreams,
      decodeLoad: window.output.decode.decodeLoad,
      megapixelsPerSecond: window.output.decode.megapixelsPerSecond,
      framePixels: window.output.decode.framePixels,
      droppedFrames: window.output.decode.droppedFrames,
      droppedShare: window.output.decode.droppedShare,
    },
    regie: {
      cores: window.regie.cpu.cores,
      coresByType: window.regie.cpu.coresByType,
      mainThreadBusy: window.regie.mainThread.busyShare,
      decodedStreams: window.regie.decode.decodedStreams,
      subscribedStreams: window.regie.decode.subscribed,
      softwareStreams: window.regie.decode.softwareStreams,
      decodeLoad: window.regie.decode.decodeLoad,
      megapixelsPerSecond: window.regie.decode.megapixelsPerSecond,
      framePixels: window.regie.decode.framePixels,
      droppedFrames: window.regie.decode.droppedFrames,
      droppedShare: window.regie.decode.droppedShare,
    },
    senders: {
      cores: window.senders.cpu.cores,
      phoneEncodeLoad: sum(phones.map((stream) => stream.encode.encodeLoad)),
      screenEncodeLoad: sum(screens.map((stream) => stream.encode.encodeLoad)),
      screenCodec: screens[0]?.encode.layers[0]?.codec ?? null,
      screenEncoder: screens[0]?.encode.layers[0]?.encoder ?? null,
      screenEncoderPowerEfficient: screens[0]?.encode.layers[0]?.powerEfficient ?? null,
      screenFps: screens[0]?.encode.layers[0]?.framesPerSecond ?? 0,
      phoneCodec: phones[0]?.encode.layers[0]?.codec ?? null,
      phoneEncoder: phones[0]?.encode.layers[0]?.encoder ?? null,
      cpuLimited: window.senders.cpuLimited,
    },
  };
}

/** The scenario takes about two thirds of four cores by itself: a machine above this had no headroom for it. */
const SATURATED_BUSY_PCT = 90;

test.describe('PERF reference scenario', () => {
  test(
    'E2E-PERF-01 [perf, reference scenario] 4 phones at 1080p, 2 screens at 1440p, 6 scenes and Studio Mode: CPU, decoders and encoders per role stay within the performance budget',
    t.perf('@p1'),
    async ({ api, production, pairContext, onCleanup }) => {
      test.setTimeout(900_000);
      const world = await buildReferenceWorld({ api, production, pairContext, onCleanup });
      const stopMachineCpu = startCpuMonitor();
      const meters = await Meters.attach(world);
      onCleanup(() => meters.detach());
      // Settle: simulcast layers, dynacast, first keyframes, fonts.
      await sleep(20_000);

      const idle = await measureIdle(meters, SECONDS);
      const idleSources = {
        output: await sourcesOfStreams(production, idle.output.decode),
        regie: await sourcesOfStreams(production, idle.regie.decode),
      };
      // Where the main thread of the Regie and of the output spends its time (sampled profile, a window of its own).
      const profiles = {
        regie: (await profileMainThread(world.regieContext, world.regie.page, PROFILE_SECONDS)).top,
        output: (await profileMainThread(world.output.context, (await world.output.output.frame()).page(), PROFILE_SECONDS)).top,
      };
      const drag = await measureDragging(meters, world, DRAG_SECONDS);

      // Switching: first the scene in the preview (Studio Mode: the next Take), then a scene whose sources nobody asked for.
      const preview = await measureSwitch(api, production, world.output, world.sceneIds[PREVIEW_SCENE]!, 2);
      await sleep(8_000);
      const cold = await measureSwitch(api, production, world.output, world.sceneIds[COLD_SCENE]!, 4);

      const summary: PerfSummary = {
        idle: summarizeWindow(idle),
        dragging: { ...summarizeWindow(drag), regieRafFps: drag.regieRafFps },
        switching: { previewSceneMs: preview.ms, coldSceneMs: cold.ms, coldVideoWidths: cold.videoWidths },
        decodedSources: idleSources,
        profiles,
      };
      const lines = flatten(summary);
      await recordMeasurement(
        test.info(),
        'perf-reference',
        { scenario: { ...REFERENCE, scenes: SCENE_NAMES }, summary, idle, drag, flat: Object.fromEntries(lines) },
        lines.map(([key, value]) => `${key}=${typeof value === 'number' ? Math.round(value * 1000) / 1000 : value}`).join(' | '),
      );
      for (const side of ['regie', 'output'] as const) {
        console.log(`[perf] profile ${side}: ${profiles[side].slice(0, 12).map((entry) => `${entry.name} ${(entry.selfShare * 100).toFixed(1)}% ${entry.where}`).join(' | ')}`);
      }
      for (const [key, value] of lines) console.log(`[perf] ${key} = ${typeof value === 'number' ? Math.round(value * 1000) / 1000 : value}`);

      // The output decodes the sources of the program scene (Panel: K1, K2) and of the preview scene (Slides: S1, K1), no others.
      const [k1, k2, , , s1] = world.sources as [string, string, string, string, string, string];
      const wanted = new Set([k1, k2, s1]);
      expect(
        idleSources.output.filter((source) => !wanted.has(source)),
        'the output decodes only the sources of the program and the preview scene',
      ).toEqual([]);

      // The counts hold on any machine. The loads only mean something if the machine had headroom: a sender at its CPU limit
      // (`qualityLimitationReason = cpu`) is the sign that it had none, and so is a machine that was busy all the time (the
      // scenario itself takes about two thirds of four cores, so the limit is higher than the 60 % of the other timing tests;
      // docs/testing.md 6.8).
      const { counts, loads } = checkBudgetParts(summary, BUDGET);
      expect(counts, `the performance budget, counts (docs/testing.md 5.1):\n${counts.join('\n')}`).toEqual([]);
      const starved = summary.idle.senders.cpuLimited || summary.dragging.senders.cpuLimited;
      const machine = stopMachineCpu();
      const saturated = machine.busyPct > SATURATED_BUSY_PCT;
      const gate: TimingGate = {
        enforce: !starved && !saturated,
        busyPct: machine.busyPct,
        maxBusyPct: SATURATED_BUSY_PCT,
        reason: starved
          ? 'a sender was at its CPU limit (qualityLimitationReason = cpu) during the measurement: the machine had no headroom, the figures are recorded, the loads are not held against the budget (not comparable); repeat the run on a machine with headroom (docs/testing.md 6.8)'
          : `the machine was at ${machine.busyPct} % CPU during the measurement (more than ${SATURATED_BUSY_PCT} %): the figures are recorded, the loads are not held against the budget (not comparable); repeat the run on a machine with headroom (docs/testing.md 6.8)`,
      };
      await judgeTiming(test.info(), gate, () => {
        expect(loads, `the performance budget, loads (docs/testing.md 5.1):\n${loads.join('\n')}`).toEqual([]);
      });
    },
  );
});
