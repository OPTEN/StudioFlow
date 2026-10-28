import os from 'node:os';
import { chromium, expect, type Browser, type BrowserContext, type Frame, type Page } from '@playwright/test';
import type { AdminApi, SceneDto } from '../api';
import { CHROMIUM_ARGS } from '../fake-media';
import type { Production } from '../production';
import { openProbedOutput, type ProbedOutput } from '../output/open';
import { FULL, addCamera, addScreens, goLive, placeItem, type Camera, type Screens } from '../output/world';
import { newUiContext } from '../ui/init';
import { RegiePage } from '../ui/regie';
import { LaptopSender, PhoneSender } from '../ui/sender';
import { trackSids } from '../output/rtc';
import { BrowserCpu, PageMetrics, cpuUse, mainThreadUse, type CpuSample, type CpuUse, type MainThreadUse, type MetricsSample } from './cpu';
import { decodeWindow, encodeWindow, readRtc, type DecodeWindow, type EncodeWindow, type RtcSnapshot } from './rtc';
import type { WorldDeps } from '../output/world';

/**
 * The reference scenario of the performance harness (issue #12, docs/testing.md 2.20): 4 phones (camera 1080p) and 2
 * laptop screens (1440p), 6 scenes, Studio Mode on, the Regie on a 14 inch laptop (1280 x 800 CSS pixels at a device pixel
 * ratio of 1.5) and the output on a second "machine" (a browser of its own, 1920 x 1080). Everything runs on fake media in
 * three Chromium instances, one per role, so the CPU time of the senders, the Regie and the output can be told apart
 * (`SystemInfo.getProcessInfo` per browser).
 *
 * Scenes (canvas 1920 x 1080), K1..K4 are the phones, S1 and S2 the screens:
 *   1 Host        K1 full
 *   2 Panel       K1 | K2                       <- program
 *   3 Four        K1 K2 / K3 K4
 *   4 Slides      S1 full, K1 picture in picture <- preview (Studio Mode)
 *   5 Two screens S1 | S2
 *   6 Everything  S1 left, K1..K4 stacked right
 */

export const REFERENCE = {
  phones: 4,
  screens: 2,
  scenes: 6,
  camera: { width: 1920, height: 1080, fps: 30 },
  screen: { width: 2560, height: 1440, fps: 30 },
  regieViewport: { width: 1280, height: 800 },
  regieScale: 1.5,
  outputViewport: { width: 1920, height: 1080 },
} as const;

export const SCENE_NAMES = ['Host', 'Panel', 'Four', 'Slides', 'Two screens', 'Everything'] as const;
/** Index in {@link SCENE_NAMES}. */
export const PROGRAM_SCENE = 1;
export const PREVIEW_SCENE = 3;
/** A scene whose sources are neither in the program nor in the preview scene. */
export const COLD_SCENE = 2;

export interface ReferenceWorld {
  phones: Camera[];
  laptops: Screens[];
  /** K1..K4 then S1, S2. */
  sources: string[];
  sceneIds: string[];
  regie: RegiePage;
  regieContext: BrowserContext;
  output: ProbedOutput;
  browsers: { senders: Browser; regie: Browser; output: Browser };
}

/** Source references in the order K1..K4, S1, S2. */
function allSources(phones: readonly Camera[], laptops: readonly Screens[]): string[] {
  return [...phones.map((phone) => phone.source), ...laptops.map((laptop) => laptop.sources[0]!)];
}

export interface WorldFixtures {
  api: AdminApi;
  production: Production;
  pairContext: WorldDeps['pairContext'];
  onCleanup: (fn: () => Promise<unknown> | unknown) => void;
}

/** Launches a browser the harness closes after the test. */
async function launch(fx: Pick<WorldFixtures, 'onCleanup'>): Promise<Browser> {
  const browser = await chromium.launch({ args: CHROMIUM_ARGS });
  fx.onCleanup(() => browser.close());
  return browser;
}

/** Items of the six scenes. Returns the scene ids. */
async function buildScenes(api: AdminApi, production: Production, sources: readonly string[]): Promise<string[]> {
  await production.seed([...SCENE_NAMES]);
  const [k1, k2, k3, k4, s1, s2] = sources as [string, string, string, string, string, string];
  const [host, panel, four, slides, twoScreens, everything] = production.sceneIds as [string, string, string, string, string, string];
  const half = { w: 960, h: 540, fit: 'cover' as const, radius: 0 };
  await placeItem(api, production, host, k1, FULL);
  await placeItem(api, production, panel, k1, { ...half, x: 0, y: 270 });
  await placeItem(api, production, panel, k2, { ...half, x: 960, y: 270 });
  await placeItem(api, production, four, k1, { ...half, x: 0, y: 0 });
  await placeItem(api, production, four, k2, { ...half, x: 960, y: 0 });
  await placeItem(api, production, four, k3, { ...half, x: 0, y: 540 });
  await placeItem(api, production, four, k4, { ...half, x: 960, y: 540 });
  await placeItem(api, production, slides, s1, FULL);
  await placeItem(api, production, slides, k1, { x: 1400, y: 790, w: 480, h: 270, fit: 'cover', radius: 0 });
  await placeItem(api, production, twoScreens, s1, { ...half, x: 0, y: 270 });
  await placeItem(api, production, twoScreens, s2, { ...half, x: 960, y: 270 });
  await placeItem(api, production, everything, s1, { x: 0, y: 0, w: 1280, h: 720, fit: 'contain', radius: 0 });
  for (const [index, source] of [k1, k2, k3, k4].entries()) {
    await placeItem(api, production, everything, source, { x: 1280, y: index * 270, w: 640, h: 270, fit: 'cover', radius: 0 });
  }
  return production.sceneIds;
}

/**
 * Builds the whole scenario: senders, scenes, a live broadcast with the Panel scene on program and Slides in the preview,
 * the Regie in Studio Mode and the output page. Resolves when every video plays.
 */
export async function buildReferenceWorld(fx: WorldFixtures): Promise<ReferenceWorld> {
  const browsers = { senders: await launch(fx), regie: await launch(fx), output: await launch(fx) };
  const deps: WorldDeps = {
    api: fx.api,
    production: fx.production,
    pairContext: fx.pairContext,
    openPhone: async (options) => {
      const phone = await PhoneSender.open(browsers.senders, options);
      fx.onCleanup(() => phone.close());
      return phone;
    },
    openLaptop: async (options) => {
      const laptop = await LaptopSender.open(browsers.senders, options);
      fx.onCleanup(() => laptop.close());
      return laptop;
    },
  };
  const phones: Camera[] = [];
  for (let index = 1; index <= REFERENCE.phones; index++) {
    const phone = await addCamera(deps, `Phone ${index}`, { camera: REFERENCE.camera });
    // The phone sends 1080p (three simulcast layers 1080p / 540p / 270p).
    await phone.phone.setResolution(1080);
    await phone.phone.waitForCamera('live', 45_000);
    phones.push(phone);
  }
  const laptops: Screens[] = [];
  for (let index = 1; index <= REFERENCE.screens; index++) {
    laptops.push(await addScreens(deps, `Laptop ${index}`, 1, { screen: { ...REFERENCE.screen, colors: [index === 1 ? '#3e63dd' : '#30a46c'] } }));
  }
  const sources = allSources(phones, laptops);
  const sceneIds = await buildScenes(fx.api, fx.production, sources);
  await goLive(fx.api, fx.production);
  expect((await fx.api.switchProgram(fx.production.id, { sceneId: sceneIds[PROGRAM_SCENE]!, transition: { kind: 'cut', durationMs: 0 } })).status).toBe(200);
  expect((await fx.api.setPreview(fx.production.id, { sceneId: sceneIds[PREVIEW_SCENE]! })).status).toBe(200);

  // The Regie: Studio Mode on, a 14 inch laptop screen.
  const regieContext = await newUiContext(browsers.regie, {
    context: { viewport: REFERENCE.regieViewport, deviceScaleFactor: REFERENCE.regieScale },
  });
  await regieContext.addInitScript(() => localStorage.setItem('studioflow.studio', '1'));
  const regie = await RegiePage.open(regieContext, { login: 'api', cookie: fx.api.cookie });
  fx.onCleanup(() => regieContext.close());
  await expect(regie.studioModeSwitch()).toBeChecked();

  const output = await openProbedOutput({ browser: browsers.output, onCleanup: fx.onCleanup }, fx.production, {}, { viewport: REFERENCE.outputViewport });
  await output.output.waitForPlayingVideos(2, { minFps: 5, timeout: 120_000 });
  return { phones, laptops, sources, sceneIds, regie, regieContext, output, browsers };
}

/** What one browser (role) used in a window. */
export interface RoleWindow {
  cpu: CpuUse;
}

export interface PageWindow extends RoleWindow {
  mainThread: MainThreadUse;
  decode: DecodeWindow;
}

export interface SenderWindow {
  name: string;
  encode: EncodeWindow;
}

/** Elements of a page that cost something to show. */
export interface DomCounts {
  videos: number;
  /** Videos that are painted: visible, not transparent, more than one pixel. */
  paintedVideos: number;
  canvases: number;
  elements: number;
}

export interface WindowResult {
  seconds: number;
  /** Busy share of the whole machine (0..1) during the window: the numbers are only comparable at similar load. */
  machineBusy: number;
  dom: { output: DomCounts; regie: DomCounts };
  output: PageWindow;
  regie: PageWindow;
  /** CPU of the browser that runs all senders (6 pages). */
  senders: RoleWindow & { streams: SenderWindow[]; cpuLimited: boolean };
}

/** The meters of the three roles; sample them at the start and the end of a window. */
export class Meters {
  private constructor(
    private readonly world: ReferenceWorld,
    private readonly senders: BrowserCpu,
    private readonly regieCpu: BrowserCpu,
    private readonly outputCpu: BrowserCpu,
    private readonly regieMetrics: PageMetrics,
    private readonly outputMetrics: PageMetrics,
  ) {}

  static async attach(world: ReferenceWorld): Promise<Meters> {
    const outputFrame = await world.output.output.frame();
    return new Meters(
      world,
      await BrowserCpu.attach(world.browsers.senders),
      await BrowserCpu.attach(world.browsers.regie),
      await BrowserCpu.attach(world.browsers.output),
      await PageMetrics.attach(world.regieContext, world.regie.page),
      await PageMetrics.attach(world.output.context, outputFrame.page()),
    );
  }

  async sample(): Promise<WindowSample> {
    const outputFrame = await this.world.output.output.frame();
    const rtc = async (scope: Page | Frame): Promise<RtcSnapshot> => readRtc(scope);
    const senders = [...this.world.phones, ...this.world.laptops];
    return {
      at: Date.now(),
      sendersCpu: await this.senders.sample(),
      regieCpu: await this.regieCpu.sample(),
      outputCpu: await this.outputCpu.sample(),
      regieMetrics: await this.regieMetrics.sample(),
      outputMetrics: await this.outputMetrics.sample(),
      regieRtc: await rtc(this.world.regie.page),
      outputRtc: await rtc(outputFrame),
      machine: os.cpus().map((cpu) => ({ idle: cpu.times.idle, total: Object.values(cpu.times).reduce((sum, value) => sum + value, 0) })),
      dom: { output: await domCounts(outputFrame), regie: await domCounts(this.world.regie.page) },
      senderRtc: await Promise.all(senders.map(async (sender) => ({ name: sender.name, rtc: await rtc(('phone' in sender ? sender.phone : sender.laptop).page) }))),
    };
  }

  async detach(): Promise<void> {
    await Promise.all([this.senders.detach(), this.regieCpu.detach(), this.outputCpu.detach(), this.regieMetrics.detach(), this.outputMetrics.detach()]);
  }
}

export interface WindowSample {
  at: number;
  sendersCpu: CpuSample;
  regieCpu: CpuSample;
  outputCpu: CpuSample;
  regieMetrics: MetricsSample;
  outputMetrics: MetricsSample;
  regieRtc: RtcSnapshot;
  outputRtc: RtcSnapshot;
  senderRtc: Array<{ name: string; rtc: RtcSnapshot }>;
  machine: Array<{ idle: number; total: number }>;
  dom: { output: DomCounts; regie: DomCounts };
}

/** Counts the video, canvas and other elements of a page. */
async function domCounts(scope: Page | Frame): Promise<DomCounts> {
  return scope.evaluate(() => {
    const videos = [...document.querySelectorAll('video')];
    const painted = videos.filter((video) => {
      const style = getComputedStyle(video);
      const box = video.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0 && box.width > 1 && box.height > 1;
    });
    return { videos: videos.length, paintedVideos: painted.length, canvases: document.querySelectorAll('canvas').length, elements: document.getElementsByTagName('*').length };
  });
}

function machineBusy(before: WindowSample['machine'], after: WindowSample['machine']): number {
  let idle = 0;
  let total = 0;
  after.forEach((cpu, index) => {
    idle += cpu.idle - before[index]!.idle;
    total += cpu.total - before[index]!.total;
  });
  return total === 0 ? 0 : 1 - idle / total;
}

export function windowResult(before: WindowSample, after: WindowSample): WindowResult {
  const streams = after.senderRtc.map((entry, index) => ({
    name: entry.name,
    encode: encodeWindow(before.senderRtc[index]!.rtc, entry.rtc),
  }));
  return {
    seconds: (after.at - before.at) / 1000,
    machineBusy: machineBusy(before.machine, after.machine),
    dom: after.dom,
    output: {
      cpu: cpuUse(before.outputCpu, after.outputCpu),
      mainThread: mainThreadUse(before.outputMetrics, after.outputMetrics),
      decode: decodeWindow(before.outputRtc, after.outputRtc),
    },
    regie: {
      cpu: cpuUse(before.regieCpu, after.regieCpu),
      mainThread: mainThreadUse(before.regieMetrics, after.regieMetrics),
      decode: decodeWindow(before.regieRtc, after.regieRtc),
    },
    senders: { cpu: cpuUse(before.sendersCpu, after.sendersCpu), streams, cpuLimited: streams.some((stream) => stream.encode.cpuLimited) },
  };
}

/** Measures a window of `seconds` with nothing else going on. */
export async function measureIdle(meters: Meters, seconds: number): Promise<WindowResult> {
  const before = await meters.sample();
  await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
  return windowResult(before, await meters.sample());
}

/**
 * Drags the picture-in-picture camera in the preview monitor around for `seconds` (the Regie edit overlay: the element
 * follows the pointer, positions go to the API) while the window is measured; also counts the animation frames of the Regie page.
 */
export async function measureDragging(meters: Meters, world: ReferenceWorld, seconds: number): Promise<WindowResult & { regieRafFps: number }> {
  const page = world.regie.page;
  const screen = page.locator('.c-monitor--preview .c-monitor__screen');
  await expect(screen).toBeVisible();
  const box = (await screen.boundingBox())!;
  const at = (canvasX: number, canvasY: number) => ({ x: box.x + (canvasX / 1920) * box.width, y: box.y + (canvasY / 1080) * box.height });
  // The picture-in-picture camera of the Slides scene: 1400/790/480/270 on the canvas.
  const grab = at(1640, 925);
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.click(grab.x, grab.y);
  await page.evaluate(() => {
    const w = window as unknown as { __perfRaf?: { frames: number; running: boolean } };
    w.__perfRaf = { frames: 0, running: true };
    const tick = () => {
      if (!w.__perfRaf?.running) return;
      w.__perfRaf.frames += 1;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const before = await meters.sample();
  await page.mouse.down();
  const started = Date.now();
  let step = 0;
  while (Date.now() - started < seconds * 1000) {
    step += 1;
    const angle = step / 12;
    const target = at(1640 - 500 + Math.cos(angle) * 450, 925 - 300 + Math.sin(angle) * 220);
    await page.mouse.move(target.x, target.y);
    await page.waitForTimeout(16);
  }
  const after = await meters.sample();
  await page.mouse.up();
  const frames = await page.evaluate(() => {
    const w = window as unknown as { __perfRaf?: { frames: number; running: boolean } };
    if (w.__perfRaf) w.__perfRaf.running = false;
    return w.__perfRaf?.frames ?? 0;
  });
  return { ...windowResult(before, after), regieRafFps: frames / ((after.at - before.at) / 1000) };
}

/**
 * Time from the request of a program change until every video on the output stage shows a picture (milliseconds), for a
 * scene whose sources were or were not subscribed before.
 */
export async function measureSwitch(api: AdminApi, production: Production, output: ProbedOutput, sceneId: string, expectedVideos: number): Promise<{ ms: number; videoWidths: number[] }> {
  const frame = await output.output.frame();
  const sentAt = Date.now();
  const switched = await api.switchProgram(production.id, { sceneId, transition: { kind: 'cut', durationMs: 0 } });
  expect(switched.status, 'switch accepted').toBe(200);
  const widths = await frame.evaluate(
    async ({ scene, count, from }) => {
      const deadline = from + 15_000;
      for (;;) {
        const layer = document.querySelector(`[data-scene-id="${scene}"]`);
        const videos = layer ? [...layer.querySelectorAll('video')] : [];
        const shown = videos.filter((video) => video.videoWidth > 0 && video.readyState >= 2 && video.getVideoPlaybackQuality().totalVideoFrames > 0);
        if (videos.length === count && shown.length === count) return { at: Date.now(), widths: shown.map((video) => video.videoWidth) };
        if (Date.now() > deadline) return { at: -1, widths: shown.map((video) => video.videoWidth) };
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    },
    { scene: sceneId, count: expectedVideos, from: sentAt },
  );
  return { ms: widths.at === -1 ? Number.POSITIVE_INFINITY : widths.at - sentAt, videoWidths: widths.widths };
}

/** Maps the track SIDs of a window to source references (for the report: which sources does a page decode?). */
export async function sourcesOfStreams(production: Pick<Production, 'id'>, window: DecodeWindow): Promise<string[]> {
  const sids = await trackSids(production);
  const bySid = new Map([...sids].map(([source, sid]) => [sid, source]));
  return window.streams.map((stream) => bySid.get(stream.sid) ?? `?${stream.sid}`).sort();
}

export type { SceneDto };
