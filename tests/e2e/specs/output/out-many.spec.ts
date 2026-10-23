import type { Frame } from '@playwright/test';
import { expect, test } from '../../support/ui/fixtures';
import { CdpCounters } from '../../support/ui/counters';
import { sleep } from '../../support/output/analysis';
import { openProbedOutput } from '../../support/output/open';
import { inboundVideo, type InboundVideo } from '../../support/output/rtc';
import { recordMeasurement, startCpuMonitor, waitForQuietMachine } from '../../support/output/stats';
import { FULL, addCamera, addScreens, goLive, placeItem, switchProgram, type Camera } from '../../support/output/world';
import { t } from '../../support/tags';

/**
 * Many sources (docs/testing.md E2E-NET-19, thresholds T-FPS / T-MEM): eight real phone senders with the 720p stamp camera
 * and two laptops sharing a screen each, all in one 3 x 3 scene (nine of them), in an Auto-Grid scene (all ten) and in a
 * single full-screen scene. The output page is measured: animation frame rate, decoded frames per second per source,
 * main-thread busy share (CDP TaskDuration), JS heap, received bytes, dropped frames. OUT_MANY_MINUTES scales the run
 * (default 3 minutes, the catalogue says 5).
 */

const MINUTES = Number(process.env['OUT_MANY_MINUTES'] ?? 3);

/** Animation frames per second of the output document over `ms`. */
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

interface PhaseResult {
  name: string;
  seconds: number;
  rafFps: number;
  decodeFps: { mean: number; min: number; perSource: number[] };
  /** Frames per second the camera senders report to have encoded and sent (the senders share the machine with the output). */
  producedFps: { mean: number; min: number };
  droppedFrames: number;
  inboundMbit: number;
  busyShare: number;
  heapMB: number;
  videos: number;
  machineCpuBusyPct: number;
  widths: number[];
}

test.describe('OUT many sources', () => {
  test(
    `E2E-NET-19 [output, many sources] 8 cameras and 2 screens in a 3 x 3 scene, an Auto-Grid and a full screen (${MINUTES} min): frame rate, main-thread load, heap and received bytes of the output`,
    t.perf('@p1'),
    async ({ browser, api, production, pairContext, openPhone, openLaptop, onCleanup }) => {
      test.setTimeout((MINUTES + 12) * 60_000);
      const deps = { api, production, pairContext, openPhone, openLaptop };
      const cameras: Camera[] = [];
      for (let index = 1; index <= 8; index++) cameras.push(await addCamera(deps, `Handy ${index}`));
      const laptopA = await addScreens(deps, 'Laptop A', 1);
      const laptopB = await addScreens(deps, 'Laptop B', 1);
      const sources = [...cameras.map((camera) => camera.source), laptopA.sources[0]!, laptopB.sources[0]!];
      const [grid, auto, single] = production.sceneIds as [string, string, string];

      // Scene 1: 3 x 3 with nine items (K1 .. K8, S1), cells of 640 x 360.
      for (const [index, source] of sources.slice(0, 9).entries()) {
        await placeItem(api, production, grid, source, { x: (index % 3) * 640, y: Math.floor(index / 3) * 360, w: 640, h: 360, fit: 'cover', radius: 0 });
      }
      // Scene 2: Auto-Grid with all ten.
      for (const source of sources) await placeItem(api, production, auto, source, FULL);
      expect((await api.updateScene(production.id, auto, { layoutMode: 'autoGrid' })).status).toBe(200);
      // Scene 3: one full-screen camera.
      await placeItem(api, production, single, cameras[0]!.source, FULL);
      await goLive(api, production);

      const { output, probe } = await openProbedOutput({ browser, onCleanup }, production, {}, { viewport: { width: 1920, height: 1080 } });
      await output.waitForPlayingVideos(9, { minFps: 5, timeout: 120_000 });
      const frame = await output.frame();
      const counters = await CdpCounters.attach(frame);
      onCleanup(() => counters.detach());
      const idleMachine = await waitForQuietMachine({ maxBusyPct: 60, timeoutMs: 60_000 });

      const measure = async (name: string, seconds: number): Promise<PhaseResult> => {
        await sleep(8000); // settle: layers, simulcast switches
        const before = await inboundVideo(frame);
        const startSample = await counters.sample({ gc: false });
        const cpu = startCpuMonitor();
        const raf: number[] = [];
        const started = Date.now();
        while (Date.now() - started < seconds * 1000) raf.push(await rafFps(frame, 3000));
        const wall = (Date.now() - started) / 1000;
        const after = await inboundVideo(frame);
        // What the senders really sent in the phase: their own report of the encoded frame rate (telemetry of the API).
        const telemetry = (await api.getTelemetry(production.id)).body;
        const produced = cameras.map((camera) => telemetry.find((message) => message.deviceId === camera.device.id)?.telemetry.slots.find((slot) => slot.slot === 'camera')?.fps ?? 0).filter((fps) => fps > 3);
        const endSample = await counters.sample({ gc: false });
        const settled = await counters.sample({ gc: true });
        const machine = cpu();
        const bySid = (list: InboundVideo[]) => new Map(list.map((stream) => [`${stream.sid}`, stream]));
        const previous = bySid(before);
        const perSource: number[] = [];
        let dropped = 0;
        let bytes = 0;
        for (const stream of after) {
          const old = previous.get(stream.sid);
          if (!old) continue;
          perSource.push((stream.framesDecoded - old.framesDecoded) / wall);
          dropped += stream.framesDropped - old.framesDropped;
          bytes += stream.bytesReceived - old.bytesReceived;
        }
        const live = perSource.filter((fps) => fps > 3);
        return {
          name,
          seconds: Math.round(wall),
          rafFps: raf.reduce((sum, value) => sum + value, 0) / raf.length,
          decodeFps: { mean: live.length ? live.reduce((sum, value) => sum + value, 0) / live.length : 0, min: live.length ? Math.min(...live) : 0, perSource: perSource.map((fps) => Math.round(fps * 10) / 10) },
          producedFps: { mean: produced.length ? produced.reduce((sum, value) => sum + value, 0) / produced.length : 0, min: produced.length ? Math.min(...produced) : 0 },
          droppedFrames: dropped,
          inboundMbit: (bytes * 8) / wall / 1e6,
          busyShare: (endSample.taskDurationSeconds - startSample.taskDurationSeconds) / ((endSample.at - startSample.at) / 1000),
          heapMB: settled.jsHeapUsed / 1024 / 1024,
          videos: settled.dom.videos,
          machineCpuBusyPct: machine.busyPct,
          widths: [...new Set(after.map((stream) => stream.frameWidth))].sort((a, b) => a - b),
        };
      };

      const phases: PhaseResult[] = [];
      const gridSeconds = Math.max(30, Math.round(MINUTES * 60 * 0.5));
      phases.push(await measure('3x3 (9 items)', gridSeconds));
      expect((await switchProgram(api, production, auto, { kind: 'fade', durationMs: 500 })).status).toBe(200);
      await probe.waitForScene(auto, 10_000);
      phases.push(await measure('Auto-Grid (10 items)', Math.max(20, Math.round(MINUTES * 60 * 0.25))));
      expect((await switchProgram(api, production, single)).status).toBe(200);
      await probe.waitForScene(single, 10_000);
      phases.push(await measure('single full screen', Math.max(15, Math.round(MINUTES * 60 * 0.15))));
      expect((await switchProgram(api, production, grid)).status).toBe(200);
      await probe.waitForScene(grid, 10_000);
      phases.push(await measure('3x3 again', Math.max(15, Math.round(MINUTES * 60 * 0.1))));

      const incidents = (await api.getSnapshot(production.id)).body.incidents;
      await recordMeasurement(
        test.info(),
        'net-19-many-sources',
        { minutes: MINUTES, phases, idleMachineBeforeMeasuring: idleMachine, openIncidents: incidents.filter((incident) => incident.endedAt === null).length, incidentsTotal: incidents.length, pageErrors: output.problems.pageErrors },
        phases.map((phase) => `${phase.name}: rAF ${phase.rafFps.toFixed(0)} fps, decode ${phase.decodeFps.mean.toFixed(0)} fps/source (min ${phase.decodeFps.min.toFixed(0)}) of ${phase.producedFps.mean.toFixed(0)} sent, main thread ${(phase.busyShare * 100).toFixed(0)} %, heap ${phase.heapMB.toFixed(0)} MB, ${phase.inboundMbit.toFixed(1)} Mbit/s in, ${phase.droppedFrames} dropped, machine CPU ${phase.machineCpuBusyPct} %`).join(' | '),
      );
      const grid3 = phases[0]!;
      expect(grid3.videos, 'nine videos on the stage').toBe(9);
      expect(grid3.rafFps, 'T-FPS: output frame rate in the 3 x 3 scene (hard 24)').toBeGreaterThanOrEqual(24);
      // The senders share the machine: their encoders do not always deliver 30 fps. The output must decode what is sent.
      expect(grid3.decodeFps.mean, `every picture is decoded at the rate the senders report to send (${grid3.producedFps.mean.toFixed(1)} fps)`).toBeGreaterThanOrEqual(grid3.producedFps.mean * 0.9);
      expect(grid3.busyShare, 'T-FPS: output main-thread busy share (hard 60 %)').toBeLessThanOrEqual(0.6);
      expect(grid3.heapMB, 'JS heap below 400 MB').toBeLessThanOrEqual(400);
      expect(grid3.inboundMbit, 'total inbound below 20 Mbit/s (non-program sources at the lowest layer)').toBeLessThanOrEqual(20);
      for (const phase of phases) {
        expect(phase.droppedFrames / (phase.seconds * Math.max(1, phase.decodeFps.perSource.length) * 30), `${phase.name}: no decode drops worth mentioning`).toBeLessThan(0.02);
      }
      expect(phases[2]!.videos, 'single full screen: one video').toBe(1);
      expect(incidents.filter((incident) => incident.endedAt === null), 'no incident').toEqual([]);
      expect(output.problems.pageErrors, 'no uncaught exception').toEqual([]);
    },
  );
});
