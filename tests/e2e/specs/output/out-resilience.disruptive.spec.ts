import type { Browser } from '@playwright/test';
import { THRESHOLD } from '../../support/constants';
import { dockerCtl, livekitCtl, restoreNetwork, type NetemProfile } from '../../support/docker-ctl';
import { stackConfig } from '../../support/env';
import { requireTool } from '../../support/fixtures';
import { outBug } from '../../support/output/bugs';
import { expect, test } from '../../support/ui/fixtures';
import { sleep, waitUntil } from '../../support/shell';
import { apiReady, ensureHealthy, inspectService, tryFetch } from '../../support/stack';
import { firstEvent } from '../../support/output/analysis';
import { collectLatencyRun } from '../../support/output/latency';
import { openProbedOutput, recordHubFrames, type HubMessage, type ProbedOutput } from '../../support/output/open';
import { type ItemState, type ProbeFrame } from '../../support/output/probe';
import { inboundOf } from '../../support/output/rtc';
import { recordMeasurement, startCpuMonitor, summarize, waitForQuietMachine } from '../../support/output/stats';
import { addCamera, addScreens, goLive, placeItem, switchProgram, type Camera, type WorldDeps } from '../../support/output/world';
import { t } from '../../support/tags';

/**
 * The output page while the stack is disturbed (docs/testing.md E2E-OUT-08, -09, E2E-NET-03 ... -06, -08, -24 from the
 * output's side): an API restart, a LiveKit restart, network disconnect and pause of LiveKit, and `netem` on LiveKit
 * (delay, loss, rate). The senders are the real sender app with the stamp camera, the output the real page. The rule of
 * the product: the picture never goes away. Every test leaves the stack healthy.
 */

test.afterEach(async () => {
  test.setTimeout(300_000);
  await restoreNetwork().catch(() => undefined);
  await ensureHealthy();
});

interface World {
  cameras: Camera[];
  /** Item ids of the cameras in scene A (same order). */
  itemIds: string[];
  opened: ProbedOutput;
  hub: { sent: HubMessage[]; received: HubMessage[] };
  sceneA: string;
  sceneB: string;
}

/** Two cameras side by side in scene A, K2 alone in scene B, the broadcast live and the output playing. */
async function liveWorld(
  fx: { browser: Browser; deps: WorldDeps; onCleanup: (fn: () => Promise<unknown> | unknown) => void },
  options: { cameras?: number; debug?: boolean; latency?: boolean; holdMs?: number | null } = {},
): Promise<World> {
  const { deps, browser, onCleanup } = fx;
  const count = options.cameras ?? 2;
  const cameras: Camera[] = [];
  for (let index = 0; index < count; index++) cameras.push(await addCamera(deps, `Kamera ${index + 1}`));
  const [sceneA, sceneB] = deps.production.sceneIds as [string, string];
  const width = Math.floor(1920 / count);
  const itemIds: string[] = [];
  for (const [index, camera] of cameras.entries()) {
    const item = await placeItem(deps.api, deps.production, sceneA, camera.source, { x: index * width, y: 270, w: width, h: Math.round((width * 9) / 16), fit: 'cover', radius: 0, holdMs: options.holdMs });
    itemIds.push(item.id);
  }
  await placeItem(deps.api, deps.production, sceneB, cameras.at(-1)!.source, { x: 0, y: 0, w: 1920, h: 1080, fit: 'cover', radius: 0, holdMs: options.holdMs });
  await goLive(deps.api, deps.production);
  const hub = { sent: [] as HubMessage[], received: [] as HubMessage[] };
  const opened = await openProbedOutput({ browser, onCleanup }, deps.production, { debug: options.debug, latency: options.latency }, {
    viewport: { width: 1920, height: 1080 },
    onPage: (page) => Object.assign(hub, recordHubFrames(page)),
  });
  await opened.output.waitForPlayingVideos(count, { minFps: 8, timeout: 60_000 });
  return { cameras, itemIds, opened, hub, sceneA, sceneB };
}

/** Epoch ms at which LiveKit answers HTTP on its test port (the container is serving), polling every 100 ms. */
async function liveKitServing(timeoutMs = 90_000): Promise<number> {
  const url = `${stackConfig().livekitAdmin}/`;
  await waitUntil('LiveKit answers', async () => (await tryFetch(url, { timeoutMs: 1500 }))?.status === 200, { timeoutMs, intervalMs: 100 });
  return Date.now();
}

/** Epoch ms at which Docker reports the service healthy. */
async function healthyAt(service: 'livekit' | 'api', timeoutMs = 120_000): Promise<number> {
  await waitUntil(`${service} healthy`, async () => (await inspectService(service))?.health === 'healthy', { timeoutMs, intervalMs: 100 });
  return Date.now();
}

/**
 * The picture freezes of every item in a window, from what the audience sees: the periods of at least 400 ms in which the
 * mean luminance of the item's picture does not change (the fake camera moves and carries a changing stamp bar, so a live
 * picture changes with every frame; a frozen or held one does not). `froze` is the start of the first such period,
 * `resumed` the end of the last one (the picture moves again for good), `gapMs` the time between them and `longestMs`
 * the longest single period. Frames are sampled per animation frame with `luma: true`. The presented-frame callbacks
 * (requestVideoFrameCallback) keep firing for a dead MediaStream and the item state changes late, so neither says whether
 * the picture moves.
 */
interface Freeze {
  froze: number;
  resumed: number;
  gapMs: number;
  longestMs: number;
  periods: number;
  over1000: number;
}

function freezes(frames: ProbeFrame[], itemIds: string[], from: number, minimumMs = 400): Map<string, Freeze> {
  const result = new Map<string, Freeze>();
  for (const id of itemIds) {
    const series = frames
      .filter((frame) => frame.t >= from)
      .map((frame) => {
        const item = frame.items.find((candidate) => candidate.id === id);
        return { t: frame.t, luma: item?.luma ?? null, state: item?.state ?? null };
      })
      .filter((sample): sample is { t: number; luma: number; state: ItemState } => sample.luma !== null && sample.state !== null);
    const periods: Array<{ from: number; to: number }> = [];
    let lastChangeAt = series[0]?.t ?? from;
    for (let index = 1; index < series.length; index++) {
      // Going from the live video to its hold picture re-draws the last frame: not a new picture.
      const redraw = (series[index - 1]!.state === 'live' && series[index]!.state !== 'live') || (series[index - 1]!.state === 'hold' && series[index]!.state === 'held');
      if (!redraw && Math.abs(series[index]!.luma - series[index - 1]!.luma) >= 0.01) {
        if (series[index]!.t - lastChangeAt >= minimumMs) periods.push({ from: lastChangeAt, to: series[index]!.t });
        lastChangeAt = series[index]!.t;
      }
    }
    if (series.length && series.at(-1)!.t - lastChangeAt >= minimumMs) periods.push({ from: lastChangeAt, to: series.at(-1)!.t });
    result.set(id, {
      froze: periods[0]?.from ?? from,
      resumed: periods.at(-1)?.to ?? from,
      gapMs: periods.length ? periods.at(-1)!.to - periods[0]!.from : 0,
      longestMs: periods.length ? Math.max(...periods.map((period) => period.to - period.from)) : 0,
      periods: periods.length,
      over1000: periods.filter((period) => period.to - period.from >= 1000).length,
    });
  }
  return result;
}

/** The lowest picture luminance of every item at any time of a sampler series (live, hold and held alike). */
function minLuma(frames: ProbeFrame[], from: number): number {
  const values = frames.filter((frame) => frame.t >= from).flatMap((frame) => frame.items.map((item) => item.luma ?? 0));
  return values.length ? Math.min(...values) : 0;
}

function openIncidents(snapshot: { incidents: Array<{ endedAt: string | null }> }): number {
  return snapshot.incidents.filter((incident) => incident.endedAt === null).length;
}

test.describe('OUT resilience', () => {
  test(
    'E2E-OUT-08 [api restart] the output keeps the picture while the API restarts, reconnects, reports again and follows a switch made after the restart; no reload',
    t.disruptive('@p0'),
    async ({ browser, api, production, pairContext, openPhone, openLaptop, onCleanup }) => {
      test.setTimeout(420_000);
      const deps = { api, production, pairContext, openPhone, openLaptop };
      const world = await liveWorld({ browser, deps, onCleanup }, { debug: true });
      const { probe, output } = world.opened;
      const timeOrigin = await probe.timeOrigin();
      const itemIds = (await probe.snapshot()).items.map((item) => item.id);
      await sleep(2000);
      const reportsBefore = world.hub.sent.filter((message) => message.target === 'Report').length;

      await probe.startSampler({ luma: true });
      await probe.takeEvents();
      const restartedAt = Date.now();
      await dockerCtl.restart('api');
      const restartReturned = Date.now();
      await waitUntil('api ready', apiReady, { timeoutMs: 120_000, intervalMs: 100 });
      const readyAt = Date.now();
      await waitUntil('api through Caddy', async () => {
        const response = await tryFetch(`${stackConfig().baseURL}/api/auth/me`, { timeoutMs: 3000 });
        return response !== undefined && ![502, 503, 504].includes(response.status);
      }, { timeoutMs: 30_000, intervalMs: 100 });

      // The first switch after the restart, made at once: the output has to reconnect and catch up.
      const first = await switchProgram(api, production, world.sceneB);
      expect(first.status, 'switch right after the restart').toBe(200);
      await probe.waitForScene(world.sceneB, 30_000);
      const events = await probe.takeEvents();
      const followedAt = firstEvent(events, 'layer+', { id: world.sceneB })!.t;
      const followMs = followedAt - first.sentAt;
      await expect.poll(async () => (await api.getSnapshot(production.id)).body.outputStatus.state, { timeout: 20_000, intervals: [200], message: 'the Regie sees the output again' }).toBe('connected');
      const connectedMs = Date.now() - readyAt;
      await sleep(1000);

      // Afterwards switches are fast again (T-SWITCH).
      const timed: number[] = [];
      let target = world.sceneA;
      for (let index = 0; index < 4; index++) {
        await probe.takeEvents();
        const sw = await switchProgram(api, production, target);
        await probe.waitForScene(target, 5000);
        timed.push(firstEvent(await probe.takeEvents(), 'layer+', { id: target })!.t - sw.sentAt);
        target = target === world.sceneA ? world.sceneB : world.sceneA;
        await sleep(600);
      }
      await sleep(1500);
      const frames = await probe.stopSampler();
      const lines = await output.debugLines();

      const outage = frames.filter((frame) => frame.t >= restartedAt && frame.t <= followedAt);
      const stills = freezes(frames.filter((frame) => frame.t <= first.sentAt), itemIds, restartedAt, 300);
      const longest = Math.max(...[...stills.values()].map((entry) => entry.longestMs));
      const reportsAfter = world.hub.sent.filter((message) => message.target === 'Report' && message.t > readyAt).length;
      await recordMeasurement(
        test.info(),
        'out-08-api-restart',
        { restartCommandMs: restartReturned - restartedAt, restartToReadyMs: readyAt - restartedAt, followMs, connectedAfterReadyMs: connectedMs, timedSwitchesMs: timed, longestStillPictureMs: longest, reportsBefore, reportsAfter, outageFrames: outage.length, overlay: lines },
        `docker restart api -> ready after ${readyAt - restartedAt} ms; switch made at once after ready shown after ${Math.round(followMs)} ms; Regie sees the output ${connectedMs} ms after ready; later switches ${timed.map(Math.round).join('/')} ms; longest still picture during the outage ${Math.round(longest)} ms`,
      );
      expect(outage.length, 'frames were sampled during the outage').toBeGreaterThan(50);
      expect(outage.every((frame) => frame.slate === null), 'no slate during the outage').toBe(true);
      expect(outage.every((frame) => itemIds.every((id) => !frame.items.some((item) => item.id === id) || frame.items.find((item) => item.id === id)!.state === 'live') ), 'both pictures stay live during the outage').toBe(true);
      expect(await probe.timeOrigin(), 'the page was not reloaded').toBe(timeOrigin);
      expect(longest, 'the pictures keep moving during the API restart (no still period above 500 ms)').toBeLessThanOrEqual(500);
      expect(readyAt - restartedAt, 'docker restart api -> ready (T-RESTART-API hard 30 s)').toBeLessThanOrEqual(THRESHOLD.restartApiHealthyHardMs);
      expect(followMs, 'a switch made right after the restart reaches the output within T-RESTART-API (hard 15 s)').toBeLessThanOrEqual(THRESHOLD.restartApiClientsHardMs);
      expect(connectedMs, 'the output reports again within T-RESTART-API (hard 15 s)').toBeLessThanOrEqual(THRESHOLD.restartApiClientsHardMs);
      expect(reportsAfter, 'reports resumed').toBeGreaterThan(0);
      expect(Math.max(...timed), 'T-SWITCH after the restart (hard 300 ms)').toBeLessThanOrEqual(300);
      expect(lines.find((line) => line.startsWith('Hub')), 'overlay: hub connected').toBe('Hub verbunden · Sync aktuell');
      expect((await api.getSnapshot(production.id)).body.incidents.filter((incident) => incident.endedAt === null), 'no open incident').toEqual([]);
    },
  );

  test(
    'E2E-OUT-09 [livekit restart] the pictures freeze on the last frame (never black), the output and the senders rejoin by themselves and fresh frames return within T-RESTART-LK',
    t.disruptive('@p0'),
    async ({ browser, api, production, pairContext, openPhone, openLaptop, onCleanup }) => {
      requireTool('lk.pause');
      test.setTimeout(420_000);
      const deps = { api, production, pairContext, openPhone, openLaptop };
      const world = await liveWorld({ browser, deps, onCleanup });
      const { probe } = world.opened;
      const timeOrigin = await probe.timeOrigin();
      const itemIds = (await probe.snapshot()).items.map((item) => item.id);
      await sleep(2500);
      await probe.startSampler({ luma: true });
      const restartedAt = Date.now();
      await dockerCtl.restart('livekit');
      const returnedAt = Date.now();
      const servingAt = await liveKitServing();
      const healthy = await healthyAt('livekit');
      // Both pictures are live again with fresh frames.
      await expect
        .poll(async () => (await probe.snapshot()).items.every((item) => item.state === 'live'), { timeout: 60_000, intervals: [100], message: 'the pictures are live again' })
        .toBe(true);
      await sleep(2500);
      const frames = await probe.stopSampler();

      const frozen = freezes(frames, itemIds, restartedAt);
      const resumedAll = Math.max(...[...frozen.values()].map((entry) => entry.resumed));
      const frozeFirst = Math.min(...[...frozen.values()].map((entry) => entry.froze));
      const states = [...new Set(frames.flatMap((frame) => frame.items.map((item) => item.state)))];
      const darkest = minLuma(frames, restartedAt);
      await recordMeasurement(
        test.info(),
        'out-09-livekit-restart',
        { restartCommandMs: returnedAt - restartedAt, servingAfterMs: servingAt - restartedAt, healthyAfterMs: healthy - restartedAt, picturesFrozeAfterMs: frozeFirst - restartedAt, freezeMs: resumedAll - frozeFirst, freshFramesAfterServingMs: resumedAll - servingAt, freshFramesAfterHealthyMs: resumedAll - healthy, states, minLumaDuringOutage: darkest, perItem: [...frozen.entries()] },
        `livekit restart: serving after ${servingAt - restartedAt} ms, healthy after ${healthy - restartedAt} ms; pictures froze ${frozeFirst - restartedAt} ms after the command and were fresh again ${resumedAll - servingAt} ms after LiveKit served HTTP / ${resumedAll - healthy} ms after the Docker healthy state (freeze ${resumedAll - frozeFirst} ms); item states seen ${states.join('/')}; darkest picture ${darkest.toFixed(0)}`,
      );
      expect(await probe.timeOrigin(), 'the page was not reloaded').toBe(timeOrigin);
      expect(frames.every((frame) => frame.slate === null), 'no slate at any time').toBe(true);
      expect(frames.every((frame) => frame.items.length === itemIds.length), 'both items stay on the stage').toBe(true);
      expect(darkest, 'the pictures freeze on the last frame, they never turn black').toBeGreaterThanOrEqual(12);
      expect(resumedAll - frozeFirst, 'the freeze was a real one').toBeGreaterThan(1000);
      expect(resumedAll - healthy, 'T-RESTART-LK: LiveKit healthy -> output and senders playing again (hard 10 s)').toBeLessThanOrEqual(THRESHOLD.restartLiveKitHardMs);
      // The Regie's view: the sources recovered, nothing stays open.
      await expect
        .poll(async () => openIncidents((await api.getSnapshot(production.id)).body), { timeout: 30_000, intervals: [500], message: 'incidents end («wieder da»)' })
        .toBe(0);
    },
  );

  test(
    'E2E-NET-08 [output, network disconnect] LiveKit unreachable for 4 s (docker network disconnect): the pictures freeze, never turn black, and fresh frames return within T-RECOVER-SHORT after the reconnect',
    t.disruptive('@p0'),
    async ({ browser, api, production, pairContext, openPhone, openLaptop, onCleanup }) => {
      requireTool('lk.disconnect');
      test.setTimeout(420_000);
      const deps = { api, production, pairContext, openPhone, openLaptop };
      const world = await liveWorld({ browser, deps, onCleanup });
      const { probe } = world.opened;
      const itemIds = (await probe.snapshot()).items.map((item) => item.id);
      await sleep(2500);
      await probe.startSampler({ luma: true });
      const cutAt = Date.now();
      await livekitCtl.disconnect();
      await sleep(4000);
      const reconnectAt = Date.now();
      await livekitCtl.connect();
      const connectedAt = Date.now();
      await expect
        .poll(async () => (await probe.snapshot()).items.every((item) => item.state === 'live'), { timeout: 60_000, intervals: [100], message: 'live again after the reconnect' })
        .toBe(true);
      await sleep(2500);
      const frames = await probe.stopSampler();
      const frozen = freezes(frames, itemIds, cutAt);
      const resumedAll = Math.max(...[...frozen.values()].map((entry) => entry.resumed));
      const frozeFirst = Math.min(...[...frozen.values()].map((entry) => entry.froze));
      const states = [...new Set(frames.flatMap((frame) => frame.items.map((item) => item.state)))];
      const darkest = minLuma(frames, cutAt);
      await recordMeasurement(
        test.info(),
        'net-08-disconnect',
        { disconnectedMs: reconnectAt - cutAt, reconnectCommandMs: connectedAt - reconnectAt, picturesFrozeAfterMs: frozeFirst - cutAt, freshFramesAfterConnectMs: resumedAll - connectedAt, freezeMs: resumedAll - frozeFirst, states, minLumaDuringOutage: darkest, perItem: [...frozen.entries()] },
        `4 s disconnect: pictures froze ${frozeFirst - cutAt} ms after the cut, fresh frames ${resumedAll - connectedAt} ms after the network was back (freeze ${resumedAll - frozeFirst} ms); states ${states.join('/')}; darkest picture ${darkest.toFixed(0)}`,
      );
      expect(frames.every((frame) => frame.slate === null)).toBe(true);
      expect(darkest, 'the pictures never turn black').toBeGreaterThanOrEqual(12);
      expect(resumedAll - connectedAt, 'T-RECOVER-SHORT: network back -> frames advancing (hard 3 s)').toBeLessThanOrEqual(3000);
    },
  );

  test(
    'E2E-NET-24 [output, media pause] LiveKit frozen (docker pause) for 10 s: the pictures freeze, no black frame, fresh frames within T-RECOVER-LONG after the unpause',
    t.disruptive('@p1'),
    async ({ browser, api, production, pairContext, openPhone, openLaptop, onCleanup }) => {
      requireTool('lk.pause');
      test.setTimeout(420_000);
      const deps = { api, production, pairContext, openPhone, openLaptop };
      const world = await liveWorld({ browser, deps, onCleanup });
      const { probe } = world.opened;
      const itemIds = (await probe.snapshot()).items.map((item) => item.id);
      await sleep(2500);
      await probe.startSampler({ luma: true });
      const pausedAt = Date.now();
      await livekitCtl.pause();
      await sleep(10_000);
      const unpausedAt = Date.now();
      await livekitCtl.unpause();
      await expect
        .poll(async () => (await probe.snapshot()).items.every((item) => item.state === 'live'), { timeout: 60_000, intervals: [100], message: 'live again after the unpause' })
        .toBe(true);
      await sleep(2500);
      const frames = await probe.stopSampler();
      const frozen = freezes(frames, itemIds, pausedAt);
      const resumedAll = Math.max(...[...frozen.values()].map((entry) => entry.resumed));
      const frozeFirst = Math.min(...[...frozen.values()].map((entry) => entry.froze));
      const states = [...new Set(frames.flatMap((frame) => frame.items.map((item) => item.state)))];
      const darkest = minLuma(frames, pausedAt);
      await recordMeasurement(
        test.info(),
        'net-24-pause',
        { pausedMs: unpausedAt - pausedAt, picturesFrozeAfterMs: frozeFirst - pausedAt, freshFramesAfterUnpauseMs: resumedAll - unpausedAt, freezeMs: resumedAll - frozeFirst, states, minLumaDuringOutage: darkest, perItem: [...frozen.entries()] },
        `10 s pause: pictures froze ${frozeFirst - pausedAt} ms after the pause, fresh frames ${resumedAll - unpausedAt} ms after the unpause (freeze ${resumedAll - frozeFirst} ms); states ${states.join('/')}; darkest picture ${darkest.toFixed(0)}`,
      );
      expect(frames.every((frame) => frame.slate === null)).toBe(true);
      expect(darkest, 'the pictures never turn black').toBeGreaterThanOrEqual(12);
      expect(resumedAll - unpausedAt, 'T-RECOVER-LONG: back -> frames advancing (hard 8 s)').toBeLessThanOrEqual(8000);
    },
  );
});

/** One measuring window of the output (no impairment, or one third of the impairment). */
interface WindowResult {
  seconds: number;
  latency: ReturnType<typeof summarize>;
  /** Decoded stamped frames per second. */
  fps: number;
  widths: number[];
  /** WebRTC freezes (inbound-rtp freezeCount / totalFreezesDuration) normalised to one minute. */
  freezesPerMin: number;
  freezeSecondsPerMin: number;
  /** Longest time the picture did not change (>= 300 ms), how many such stills, how many of them >= 1 s. */
  longestStillMs: number;
  stills: number;
  stillsOver1s: number;
  lossPct: number | null;
  /** CPU use of the whole machine during the window (the other test stacks run at the same time). */
  machineCpuBusyPct: number;
}

/** What an impairment did to the output: a baseline window, three impaired windows (medians decide), recovery. */
interface Impaired {
  profile: NetemProfile;
  baseline: WindowResult;
  windows: WindowResult[];
  /** Median over the windows (the freeze budgets of the plan are per minute and random under random loss). */
  median: { latencyP50: number; latencyP95: number; fps: number; freezesPerMin: number; freezeSecondsPerMin: number; longestStillMs: number; lossPct: number | null };
  /** Worst window (the 20 % criterion is about the longest freeze that ever happened). */
  worst: { longestStillMs: number; freezeSecondsPerMin: number };
  widths: number[];
  duringFrames: number;
  uplinkLossPct: number | null;
  recoverMs: number | null;
  recoveredWidth: number;
  states: string[];
  incidentsOpened: number;
  reloaded: boolean;
}

const medianOf = (values: number[]): number => {
  const sorted = [...values].sort((x, y) => x - y);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)]! : NaN;
};

/** Runs one netem profile against a live camera: baseline, settle, three windows, clear, recovery. */
async function impair(
  world: World,
  fx: { api: WorldDeps['api']; production: WorldDeps['production'] },
  profile: NetemProfile,
  options: { windowMs?: number; windows?: number; settleMs?: number } = {},
): Promise<Impaired> {
  const { probe, output } = world.opened;
  const frame = await output.frame();
  const camera = world.cameras[0]!;
  const itemId = world.itemIds[0]!;
  const timeOrigin = await probe.timeOrigin();
  const incidentsBefore = (await fx.api.getSnapshot(fx.production.id)).body.incidents.length;
  await probe.startSampler({ luma: true });

  const measureWindow = async (durationMs: number): Promise<WindowResult> => {
    const startedAt = Date.now();
    const cpu = startCpuMonitor();
    const before = await inboundOf(frame, fx.production, camera.source);
    const run = await collectLatencyRun(output, { durationMs, warmupMs: 0, sourceId: camera.source, pollMs: 2000 });
    const after = await inboundOf(frame, fx.production, camera.source);
    const seconds = (Date.now() - startedAt) / 1000;
    // The window is part of the running sampler series: read the frames of this window from a snapshot of the series.
    const frames = (await probe.peekSampler()).filter((sample) => sample.t >= startedAt);
    const still = freezes(frames, [itemId], startedAt, 300).get(itemId)!;
    const lost = after && before ? after.packetsLost - before.packetsLost : 0;
    const received = after && before ? after.packetsReceived - before.packetsReceived : 0;
    return {
      seconds,
      latency: run.stats,
      fps: run.samples.length / (run.windowMs / 1000),
      widths: run.widths,
      freezesPerMin: (((after?.freezeCount ?? 0) - (before?.freezeCount ?? 0)) * 60) / seconds,
      freezeSecondsPerMin: (((after?.totalFreezesDuration ?? 0) - (before?.totalFreezesDuration ?? 0)) * 60) / seconds,
      longestStillMs: still.longestMs,
      stills: still.periods,
      stillsOver1s: still.over1000,
      lossPct: after && before ? (lost / Math.max(1, received + lost)) * 100 : null,
      machineCpuBusyPct: cpu().busyPct,
    };
  };

  await sleep(2000);
  const baseline = await measureWindow(25_000);
  await livekitCtl.netem(profile);
  await sleep(options.settleMs ?? 8000);
  const windows: WindowResult[] = [];
  for (let index = 0; index < (options.windows ?? 3); index++) windows.push(await measureWindow(options.windowMs ?? 30_000));
  const telemetry = (await fx.api.getTelemetry(fx.production.id)).body;
  const uplink = telemetry.find((message) => message.deviceId === camera.device.id)?.telemetry.slots.find((slot) => slot.slot === 'camera')?.packetLossPct ?? null;
  const frames = await probe.stopSampler();
  await livekitCtl.clearNetem();
  const clearedAt = Date.now();

  // Recovery: the median of 30 samples is back within 30 ms of the baseline.
  const after = await collectLatencyRun(output, { durationMs: 20_000, warmupMs: 0, sourceId: camera.source, pollMs: 1000 });
  const origin = await probe.timeOrigin();
  let recoverMs: number | null = null;
  const ordered = [...after.samples].sort((x, y) => x.at - y.at);
  for (let index = 29; index < ordered.length; index++) {
    const window = ordered.slice(index - 29, index + 1).map((sample) => sample.latencyMs).sort((x, y) => x - y);
    if (window[15]! <= baseline.latency.p50 + 30) {
      recoverMs = origin + ordered[index]!.at - clearedAt;
      break;
    }
  }
  const recovered = await inboundOf(frame, fx.production, camera.source);
  const incidentsAfter = (await fx.api.getSnapshot(fx.production.id)).body.incidents.length;
  return {
    profile,
    baseline,
    windows,
    median: {
      latencyP50: medianOf(windows.map((w) => w.latency.p50)),
      latencyP95: medianOf(windows.map((w) => w.latency.p95)),
      fps: medianOf(windows.map((w) => w.fps)),
      freezesPerMin: medianOf(windows.map((w) => w.freezesPerMin)),
      freezeSecondsPerMin: medianOf(windows.map((w) => w.freezeSecondsPerMin)),
      longestStillMs: medianOf(windows.map((w) => w.longestStillMs)),
      lossPct: windows[0]?.lossPct === null ? null : medianOf(windows.map((w) => w.lossPct ?? NaN)),
    },
    worst: { longestStillMs: Math.max(...windows.map((w) => w.longestStillMs)), freezeSecondsPerMin: Math.max(...windows.map((w) => w.freezeSecondsPerMin)) },
    widths: [...new Set(windows.flatMap((w) => w.widths))].sort((x, y) => x - y),
    duringFrames: windows.reduce((sum, w) => sum + w.fps * w.seconds, 0),
    uplinkLossPct: uplink,
    recoverMs,
    recoveredWidth: recovered?.frameWidth ?? 0,
    states: [...new Set(frames.flatMap((sample) => sample.items.map((item) => item.state)))],
    incidentsOpened: incidentsAfter - incidentsBefore,
    reloaded: (await probe.timeOrigin()) !== timeOrigin,
  };
}

test.describe('OUT netem on LiveKit', () => {
  for (const scenario of [
    { id: 'E2E-NET-03', name: 'delay 100 ms', profile: { delayMs: 100 } as NetemProfile, priority: '@p1' as const },
    { id: 'E2E-NET-04', name: 'loss 5 %', profile: { lossPct: 5 } as NetemProfile, priority: '@p1' as const },
    { id: 'E2E-NET-05', name: 'loss 20 %', profile: { lossPct: 20 } as NetemProfile, priority: '@p1' as const },
    { id: 'E2E-NET-06', name: 'rate 1 Mbit/s', profile: { rate: '1mbit' } as NetemProfile, priority: '@p1' as const },
  ]) {
    test(
      `${scenario.id} [output, netem ${scenario.name}] the output stays up under impairment of LiveKit: no reload, no slate, latency and frame gaps recorded, recovery after clearing`,
      t.disruptive(scenario.priority),
      async ({ browser, api, production, pairContext, openPhone, openLaptop, onCleanup }) => {
        if (scenario.id === 'E2E-NET-05') outBug('OUT-06', 'with 20 % loss on the media path the picture freezes for more than 5 s in some windows (T-FREEZE hard limit), is frozen for 14-52 s of every minute and drops to 320 px / 2-15 fps');
        requireTool('netem');
        test.setTimeout(600_000);
        const deps = { api, production, pairContext, openPhone, openLaptop };
        const world = await liveWorld({ browser, deps, onCleanup }, { cameras: 1, latency: true });
        if (scenario.profile.rate) {
          // «a camera and a screen on air»: the screen is part of the load that has to fit through 1 Mbit/s.
          const screens = await addScreens(deps, 'Laptop Netem', 1);
          await placeItem(api, production, world.sceneA, screens.sources[0]!, { x: 1280, y: 0, w: 640, h: 360, fit: 'contain', radius: 0 });
          await sleep(3000);
        }
        await waitForQuietMachine({ maxBusyPct: 50, timeoutMs: 120_000 });
        const result = await impair(world, { api, production }, scenario.profile, { windowMs: 25_000, windows: scenario.id === 'E2E-NET-05' ? 8 : 3, settleMs: 8000 });
        const delta = result.median.latencyP50 - result.baseline.latency.p50;
        const m = result.median;
        await recordMeasurement(
          test.info(),
          scenario.id.toLowerCase(),
          { scenario: scenario.name, ...result, p50Delta: delta },
          `${scenario.name}: latency p50 ${result.baseline.latency.p50.toFixed(0)} -> ${m.latencyP50.toFixed(0)} ms (p95 ${m.latencyP95.toFixed(0)}), ${m.fps.toFixed(0)} fps, widest picture ${Math.max(...result.widths, 0)} px, longest still picture ${Math.round(m.longestStillMs)} ms (worst window ${Math.round(result.worst.longestStillMs)} ms), freezes per minute ${m.freezesPerMin.toFixed(1)} / ${m.freezeSecondsPerMin.toFixed(1)} s (baseline ${result.baseline.freezesPerMin.toFixed(1)} / ${result.baseline.freezeSecondsPerMin.toFixed(1)} s; windows ${result.windows.map((w) => w.freezeSecondsPerMin.toFixed(1)).join('/')}), loss ${m.lossPct?.toFixed(1)} % (sender-reported uplink ${result.uplinkLossPct ?? 'n/a'} %), back to baseline ${result.recoverMs === null ? 'not within 20 s' : `${Math.round(result.recoverMs)} ms`} after clearing, ${result.incidentsOpened} incident(s)`,
        );
        // The rule of the product: the output stays up and keeps a picture.
        expect(result.reloaded, 'the page was not reloaded').toBe(false);
        expect(result.states, 'the picture never leaves the live state or the hold frame (no slate, no missing item)').not.toContain('missing');
        expect(result.duringFrames, 'frames kept arriving').toBeGreaterThan(50);

        if (scenario.id === 'E2E-NET-03') {
          expect(delta, `a 100 ms delay in both directions adds about 200 ms (baseline ${result.baseline.latency.p50.toFixed(0)}, impaired ${m.latencyP50.toFixed(0)})`).toBeGreaterThanOrEqual(100);
          expect(delta).toBeLessThanOrEqual(300);
          expect(m.freezesPerMin, 'freeze count per minute (median of three windows)').toBeLessThanOrEqual(1);
          expect(m.freezeSecondsPerMin, 'T-FREEZE: total freeze per minute below 1 s (hard, median of three windows)').toBeLessThanOrEqual(1);
          expect(result.incidentsOpened, 'no incident').toBe(0);
          expect(result.recoverMs, 'baseline +-30 ms within 10 s after clearing').not.toBeNull();
          expect(result.recoverMs!).toBeLessThanOrEqual(10_000);
        }
        if (scenario.id === 'E2E-NET-04') {
          // The freeze budget of the plan (2 s per minute, fps >= 24) is asserted in E2E-NET-04 [freeze budget ...] below (known bug).
          // What holds whatever the luck of the dice: the picture continues, the loss is the 5 % set, no incident, quick recovery.
          expect(result.worst.longestStillMs, 'the picture is never still for 15 s or more').toBeLessThan(15_000);
          expect(m.fps, 'the picture keeps moving (median of the windows)').toBeGreaterThanOrEqual(8);
          expect(result.incidentsOpened, 'no reconnecting incident').toBe(0);
          expect(result.recoverMs, 'quality recovers within 10 s of clearing').not.toBeNull();
          expect(result.recoverMs!).toBeLessThanOrEqual(10_000);
          expect(m.lossPct, 'downlink loss seen by the output is between 2 and 9 %').not.toBeNull();
          expect(m.lossPct!).toBeGreaterThanOrEqual(2);
          expect(m.lossPct!).toBeLessThanOrEqual(9);
        }
        if (scenario.id === 'E2E-NET-05') {
          expect(result.worst.longestStillMs, 'T-FREEZE: the longest freeze stays below 5 s (hard)').toBeLessThanOrEqual(5000);
          expect(result.recoverMs, 'full quality within 10 s of clearing').not.toBeNull();
          expect(result.recoverMs!).toBeLessThanOrEqual(10_000);
          expect((await api.getSnapshot(production.id)).body.incidents.filter((incident) => incident.endedAt === null), 'no incident stays open').toEqual([]);
        }
        if (scenario.id === 'E2E-NET-06') {
          expect(Math.max(...result.widths), 'lower simulcast layers are received (the picture is below 1280 px wide)').toBeLessThan(1280);
          expect(result.worst.longestStillMs, 'no freeze above 1 s').toBeLessThanOrEqual(1000);
          expect(result.incidentsOpened, 'no incident').toBe(0);
          await expect
            .poll(async () => (await inboundOf(await world.opened.output.frame(), production, world.cameras[0]!.source))?.frameWidth ?? 0, { timeout: 15_000, message: 'the highest layer returns within 15 s of clearing' })
            .toBeGreaterThanOrEqual(1280);
        }
      },
    );
  }
});

test.describe('OUT freeze budget and sender loss report', () => {
  test(
    'E2E-NET-04 [freeze budget and sender report] with 5 % loss on the link the output freezes at most 2 s per minute with at least 24 fps (T-FREEZE, median of six windows) and the sender reports an uplink loss between 2 and 9 % (Regie «Verlust»)',
    t.disruptive('@p1'),
    async ({ browser, api, production, pairContext, openPhone, openLaptop, onCleanup }) => {
      outBug('OUT-05', 'the sender reports the loss net of NACK retransmissions (0.1-0.3 % with 5 % loss on the link), the plan expects the link loss');
      outBug('OUT-06', 'with 5 % loss on the media path the output freezes for 0-52 s per minute (26-52 s on a quiet machine, plan: <= 2 s) at 5-25 fps');
      requireTool('netem');
      test.setTimeout(900_000);
      const deps = { api, production, pairContext, openPhone, openLaptop };
      const world = await liveWorld({ browser, deps, onCleanup }, { cameras: 1, latency: true });
      await waitForQuietMachine({ maxBusyPct: 50, timeoutMs: 120_000 });
      const result = await impair(world, { api, production }, { lossPct: 5 }, { windowMs: 25_000, windows: 6, settleMs: 8000 });
      const m = result.median;
      await recordMeasurement(
        test.info(),
        'net-04-freeze-budget',
        { ...result },
        `5 % loss: freeze seconds per minute per window ${result.windows.map((w) => w.freezeSecondsPerMin.toFixed(1)).join('/')} (median ${m.freezeSecondsPerMin.toFixed(1)}, plan <= 2), fps median ${m.fps.toFixed(1)} (plan >= 24), baseline freezes ${result.baseline.freezeSecondsPerMin.toFixed(1)} s per minute; machine CPU per window ${result.windows.map((w) => w.machineCpuBusyPct).join('/')} %; sender-reported uplink loss ${result.uplinkLossPct} %`,
      );
      expect(m.freezeSecondsPerMin, 'T-FREEZE: total freeze below 2 s per minute (hard, median of six windows)').toBeLessThanOrEqual(2);
      expect(m.fps, 'output fps >= 24 (median of six windows)').toBeGreaterThanOrEqual(24);
      expect(result.uplinkLossPct, 'the sender reports its uplink loss').not.toBeNull();
      expect(result.uplinkLossPct!, 'uplink loss reported by the sender (Regie «Verlust») between 2 and 9 %').toBeGreaterThanOrEqual(2);
      expect(result.uplinkLossPct!).toBeLessThanOrEqual(9);
    },
  );
});
