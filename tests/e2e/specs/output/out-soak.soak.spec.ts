import fs from 'node:fs';
import path from 'node:path';
import type { Browser } from '@playwright/test';
import { dockerCtl } from '../../support/docker-ctl';
import { inspectService, SERVICES } from '../../support/stack';
import { expect, test } from '../../support/ui/fixtures';
import { CdpCounters, growth, slopePerMinute, type Counters } from '../../support/ui/counters';
import { sleep } from '../../support/output/analysis';
import { outBug } from '../../support/output/bugs';
import { collectLatencyRun } from '../../support/output/latency';
import { openProbedOutput } from '../../support/output/open';
import { RESULTS_DIR, recordMeasurement } from '../../support/output/stats';
import { VideoCensusProbe, type VideoCensus } from '../../support/output/zombies';
import { FULL, addCamera, goLive, placeItem, switchProgram, type WorldDeps } from '../../support/output/world';
import { t } from '../../support/tags';

/**
 * Soak of the output page (docs/testing.md E2E-NET-18 for the output, thresholds T-MEM in section 5): two real cameras,
 * the program switches between them every 10 s (alternating cut and 300 ms fade, so every switch builds a scene layer with
 * a new video and tears the old one down). After forced garbage collections the page's JS heap, DOM nodes (DevTools
 * counter, detached ones included), event listeners, documents, `<video>` elements (attached AND still alive after being
 * removed), WebSockets and RTCPeerConnections are sampled every minute (always 5 s after a switch, never in the middle of
 * a fade). Nothing may grow without bound. The long run (OUT_SOAK_MINUTES, default 20) asserts everything, the short
 * guard run asserts everything except the DOM node and removed-video counts, which known bug OUT-11 makes grow.
 */

const MINUTES = Number(process.env['OUT_SOAK_MINUTES'] ?? 20);
const SAMPLE_EVERY_MS = 60_000;
const SWITCH_EVERY_MS = 10_000;

interface RssSample {
  api: number;
  livekit: number;
  postgres: number;
  caddy: number;
}

interface Sample {
  minute: number;
  counters: Counters;
  census: VideoCensus;
  layers: number;
  holdCanvases: number;
  reportFps: number | null;
  rss: RssSample;
}

async function runSoak(
  fx: { browser: Browser; deps: WorldDeps; onCleanup: (fn: () => Promise<unknown> | unknown) => void },
  minutes: number,
  strictLeak: boolean,
): Promise<void> {
  const { browser, deps, onCleanup } = fx;
  const { api, production } = deps;
  const k1 = await addCamera(deps, 'Kamera Eins');
  const k2 = await addCamera(deps, 'Kamera Zwei');
  const [a, b] = production.sceneIds as [string, string];
  await placeItem(api, production, a, k1.source, FULL);
  await placeItem(api, production, b, k2.source, FULL);
  await goLive(api, production);
  const { output } = await openProbedOutput({ browser, onCleanup }, production, {}, { viewport: { width: 1920, height: 1080 } });
  await output.waitForPlayingVideos(1, { minFps: 8, timeout: 60_000 });
  const frame = await output.frame();
  const counters = await CdpCounters.attach(frame);
  const census = await VideoCensusProbe.attach(frame);
  onCleanup(() => counters.detach());
  onCleanup(() => census.detach());
  const state = async () => Promise.all(SERVICES.map(async (service) => { const info = await inspectService(service); return `${service}:${info?.restartCount}:${info?.id}`; }));
  const containersBefore = await state();

  const latencyAt = async () => {
    const lat = await openProbedOutput({ browser, onCleanup }, production, { latency: true }, { viewport: { width: 1280, height: 720 } });
    await lat.output.waitForPlayingVideos(1, { minFps: 8, timeout: 45_000 });
    const run = await collectLatencyRun(lat.output, { durationMs: 25_000, warmupMs: 5000 });
    await lat.context.close();
    return run.stats;
  };
  const latencyStart = await latencyAt();

  const samples: Sample[] = [];
  const rss = async (): Promise<RssSample> => ({
    api: (await dockerCtl.stats('api')).memBytes,
    livekit: (await dockerCtl.stats('livekit')).memBytes,
    postgres: (await dockerCtl.stats('postgres')).memBytes,
    caddy: (await dockerCtl.stats('caddy')).memBytes,
  });
  const takeSample = async (minute: number) => {
    const sampled = await counters.sample();
    const dom = await frame.evaluate(() => ({ layers: document.querySelectorAll('.sf-r-layer').length, holdCanvases: document.querySelectorAll('canvas.sf-r-hold-frame').length }));
    const status = (await api.getSnapshot(production.id)).body.outputStatus;
    samples.push({ minute, counters: sampled, census: await census.count(), layers: dom.layers, holdCanvases: dom.holdCanvases, reportFps: status.fps, rss: await rss() });
  };

  let target = b;
  let useFade = false;
  const sw = async () => {
    const result = await switchProgram(api, production, target, useFade ? { kind: 'fade', durationMs: 300 } : { kind: 'cut', durationMs: 0 });
    expect(result.status, `switch to ${target}`).toBe(200);
    target = target === a ? b : a;
    useFade = !useFade;
  };
  // Warm-up: a few switches so the first allocations are behind us, then the first sample.
  for (let index = 0; index < 4; index++) {
    await sw();
    await sleep(SWITCH_EVERY_MS);
  }
  const consoleErrorsAtStart = output.problems.consoleErrors.length;
  const started = Date.now();
  await takeSample(0);
  let nextSampleAt = started + SAMPLE_EVERY_MS;
  let switches = 0;
  while (Date.now() - started < minutes * 60_000) {
    const cycleStart = Date.now();
    await sw();
    switches += 1;
    await sleep(5000); // the fade (300 ms) is long over
    if (Date.now() >= nextSampleAt) {
      await takeSample(Math.round((Date.now() - started) / 60_000));
      nextSampleAt += SAMPLE_EVERY_MS;
    }
    await sleep(Math.max(0, SWITCH_EVERY_MS - (Date.now() - cycleStart)));
  }
  await takeSample(minutes);
  await output.waitForPlayingVideos(1, { minFps: 8, timeout: 30_000 });
  const latencyEnd = await latencyAt();

  // T-MEM compares «minute 10 -> end»: from the middle of the run to the end.
  const middleIndex = Math.max(1, samples.findIndex((sample) => sample.minute >= minutes / 2));
  const first = samples[0]!;
  const middle = samples[middleIndex]!;
  const last = samples.at(-1)!;
  const startToEnd = growth(first.counters, last.counters);
  const middleToEnd = growth(middle.counters, last.counters);
  const heapSlope = slopePerMinute(samples.slice(middleIndex).map((sample) => sample.counters), (sample) => sample.jsHeapUsed);
  const nodeSlope = slopePerMinute(samples.slice(middleIndex).map((sample) => sample.counters), (sample) => sample.nodes);
  const containersAfter = await state();
  const mb = (bytes: number) => Math.round((bytes / 1024 / 1024) * 10) / 10;
  const table = [first, middle, last].map((sample, index) => ({
    point: ['start', 'middle', 'end'][index],
    minute: sample.minute,
    jsHeapMB: mb(sample.counters.jsHeapUsed),
    nodes: sample.counters.nodes,
    listeners: sample.counters.listeners,
    documents: sample.counters.documents,
    attachedVideos: sample.counters.dom.videos,
    removedVideosStillAlive: sample.census.detached,
    removedVideosWithLiveTrack: sample.census.detachedWithLiveTrack,
    canvases: sample.counters.dom.canvases,
    elements: sample.counters.dom.elements,
    peerConnections: sample.counters.net?.peers,
    webSockets: sample.counters.net?.sockets,
    layers: sample.layers,
    holdCanvases: sample.holdCanvases,
    reportedFps: sample.reportFps,
  }));
  const rssGrowthMB = { api: mb(last.rss.api - first.rss.api), livekit: mb(last.rss.livekit - first.rss.livekit), postgres: mb(last.rss.postgres - first.rss.postgres), caddy: mb(last.rss.caddy - first.rss.caddy) };
  const series = samples.map((sample) => ({
    minute: sample.minute,
    heapMB: mb(sample.counters.jsHeapUsed),
    nodes: sample.counters.nodes,
    listeners: sample.counters.listeners,
    attachedVideos: sample.counters.dom.videos,
    removedVideos: sample.census.detached,
    peers: sample.counters.net?.peers,
    sockets: sample.counters.net?.sockets,
    mainThreadSeconds: Math.round(sample.counters.taskDurationSeconds * 100) / 100,
    rssMB: { api: mb(sample.rss.api), livekit: mb(sample.rss.livekit), postgres: mb(sample.rss.postgres), caddy: mb(sample.rss.caddy) },
  }));
  // Main-thread seconds per wall second between the samples: does the page get slower as removed videos pile up?
  const busy = samples.slice(1).map((sample, index) => ({ minute: sample.minute, busyPct: Math.round(((sample.counters.taskDurationSeconds - samples[index]!.counters.taskDurationSeconds) / ((sample.counters.at - samples[index]!.counters.at) / 1000)) * 1000) / 10 }));
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const csv = ['minute,heap_mb,nodes,listeners,documents,attached_videos,removed_videos_alive,canvases,elements,peers,sockets,main_thread_s,rss_api_mb,rss_livekit_mb,rss_postgres_mb,rss_caddy_mb']
    .concat(samples.map((sample) => [sample.minute, mb(sample.counters.jsHeapUsed), sample.counters.nodes, sample.counters.listeners, sample.counters.documents, sample.counters.dom.videos, sample.census.detached, sample.counters.dom.canvases, sample.counters.dom.elements, sample.counters.net?.peers, sample.counters.net?.sockets, sample.counters.taskDurationSeconds.toFixed(2), mb(sample.rss.api), mb(sample.rss.livekit), mb(sample.rss.postgres), mb(sample.rss.caddy)].join(',')))
    .join('\n');
  fs.writeFileSync(path.join(RESULTS_DIR, `soak-${new Date().toISOString().replace(/[:.]/g, '-')}-${minutes}min.csv`), csv);
  await recordMeasurement(
    test.info(),
    strictLeak ? 'net-18-soak' : 'net-18-soak-guard',
    { minutes, switches, table, series, mainThreadBusy: busy, startToEnd, middleToEnd, heapSlopeMBPerMinute: mb(heapSlope), nodeSlopePerMinute: nodeSlope, rssGrowthMB, latencyStart, latencyEnd, containersBefore, containersAfter, pageErrors: output.problems.pageErrors, consoleErrors: output.problems.consoleErrors },
    `${minutes} min, ${switches} switches; JS heap ${table.map((row) => row.jsHeapMB).join('/')} MB (start/middle/end), nodes ${table.map((row) => row.nodes).join('/')}, listeners ${table.map((row) => row.listeners).join('/')}, attached videos ${table.map((row) => row.attachedVideos).join('/')}, removed videos still alive ${table.map((row) => row.removedVideosStillAlive).join('/')}, peers ${table.map((row) => row.peerConnections).join('/')}; latency p95 ${latencyStart.p95.toFixed(0)} -> ${latencyEnd.p95.toFixed(0)} ms; container RSS growth ${JSON.stringify(rssGrowthMB)}`,
  );

  // T-MEM (hard limits), middle -> end.
  expect(mb(middleToEnd.jsHeapUsed), `output JS heap growth from the middle to the end (hard 20 MB): ${mb(middle.counters.jsHeapUsed)} -> ${mb(last.counters.jsHeapUsed)} MB`).toBeLessThanOrEqual(20);
  expect(middleToEnd.listeners / Math.max(1, middle.counters.listeners), 'event listeners growth (hard 5 %)').toBeLessThanOrEqual(0.05);
  expect(middleToEnd.listeners, 'event listeners growth (hard 100 absolute)').toBeLessThanOrEqual(100);
  // Constant (+- 0) over the whole run: one attached video per scene, the same peer connections and sockets, no stray layers.
  for (const sample of samples) {
    expect(sample.counters.dom.videos, `attached video elements at minute ${sample.minute}`).toBe(first.counters.dom.videos);
    expect(sample.counters.net?.peers, `RTCPeerConnections at minute ${sample.minute}`).toBe(first.counters.net?.peers);
    expect(sample.counters.net?.sockets, `WebSockets at minute ${sample.minute}`).toBe(first.counters.net?.sockets);
    expect(sample.layers, `scene layers at minute ${sample.minute}`).toBe(1);
    expect(sample.holdCanvases, `hold-frame canvases at minute ${sample.minute}`).toBeLessThanOrEqual(1);
  }
  expect(Math.abs(startToEnd.documents), 'documents').toBeLessThanOrEqual(2);
  expect(Math.abs(startToEnd.canvases), 'canvas elements').toBeLessThanOrEqual(1);
  // Server side: containers did not restart, memory did not run away (T-MEM: 100 MB per 60 min).
  expect(containersAfter, 'no container restarted').toEqual(containersBefore);
  for (const [service, growthMb] of Object.entries(rssGrowthMB)) expect(growthMb, `${service} RSS growth (hard 100 MB per hour)`).toBeLessThanOrEqual(100);
  expect(output.problems.pageErrors, 'no uncaught exception').toEqual([]);
  expect(output.problems.consoleErrors.length - consoleErrorsAtStart, 'no console error during the run').toBe(0);
  expect(latencyEnd.p95, 'latency p95 at the end within 50 ms of the start').toBeLessThanOrEqual(latencyStart.p95 + 50);
  if (strictLeak) {
    expect(middleToEnd.nodes / middle.counters.nodes, `DOM nodes growth from the middle to the end (hard 5 %): ${middle.counters.nodes} -> ${last.counters.nodes}`).toBeLessThanOrEqual(0.05);
    for (const sample of samples) expect(sample.census.detached, `removed <video> elements still alive at minute ${sample.minute}`).toBe(0);
  }
}

test.describe('OUT soak', () => {
  test(
    `E2E-NET-18 [output, soak] ${MINUTES} minutes with a program switch every 10 s between two cameras: the output page does not grow (heap, nodes, listeners, videos, peers, sockets), no errors, no container restart`,
    t.with('@p1', '@soak'),
    async ({ browser, api, production, pairContext, openPhone, openLaptop, onCleanup }) => {
      outBug('OUT-11', 'removed device <video> elements keep their MediaStream track and stay alive: about 150 DOM nodes and one video element leak per program switch');
      test.setTimeout((MINUTES + 14) * 60_000);
      await runSoak({ browser, deps: { api, production, pairContext, openPhone, openLaptop }, onCleanup }, MINUTES, true);
    },
  );

  test(
    'E2E-NET-18 [output, soak, guard] 4 minutes with a switch every 10 s: heap, listeners, attached videos, peers, sockets, errors, latency and the server containers stay put (the DOM node and removed-video counts are covered by the long run)',
    t.with('@p1', '@soak'),
    async ({ browser, api, production, pairContext, openPhone, openLaptop, onCleanup }) => {
      test.setTimeout(18 * 60_000);
      await runSoak({ browser, deps: { api, production, pairContext, openPhone, openLaptop }, onCleanup }, 4, false);
    },
  );
});
