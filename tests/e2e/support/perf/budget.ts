/**
 * The performance budget of the reference scenario (issue #12, docs/testing.md 5.1) and the check against it.
 *
 * Two kinds of lines: a `count` (decoded streams, videos in the DOM, frame rate cap) is exact and does not depend on the
 * speed of the machine, so any rise fails; a `load` (CPU cores, main-thread share, dropped frames, switching time) is
 * measured in a container without a GPU that is shared with other work, so it fails only when it exceeds the budget by
 * more than 20 % ({@link TOLERANCE}). `PERF_BUDGET_SCALE` multiplies the load lines for a slower or faster machine. The
 * budget is the worst value seen on the reference machine after the optimisations (docs/testing.md 5.1); the values
 * before them are in the same table.
 */

export interface RoleSummary {
  /** CPU seconds per wall-clock second of all processes of the role's browser (1.0 = one core). */
  cores: number;
  coresByType: Record<string, number>;
  /** Main-thread busy share of the page (`TaskDuration` per second). */
  mainThreadBusy: number;
  decodedStreams: number;
  subscribedStreams: number;
  softwareStreams: number;
  decodeLoad: number;
  megapixelsPerSecond: number;
  /** Megapixels of one frame of every decoding stream: the decoding work independent of the achieved frame rate. */
  framePixels: number;
  droppedFrames: number;
  droppedShare: number;
}

export interface WindowSummary {
  seconds: number;
  /** Busy share of the whole machine during the window (0..1). */
  machineBusy: number;
  dom: { output: { videos: number; paintedVideos: number; canvases: number }; regie: { videos: number; paintedVideos: number; canvases: number } };
  output: RoleSummary;
  regie: RoleSummary;
  senders: {
    cores: number;
    phoneEncodeLoad: number;
    screenEncodeLoad: number;
    screenCodec: string | null;
    screenEncoder: string | null;
    screenEncoderPowerEfficient: boolean | null;
    screenFps: number;
    phoneCodec: string | null;
    phoneEncoder: string | null;
    cpuLimited: boolean;
  };
}

export interface PerfSummary {
  idle: WindowSummary;
  dragging: WindowSummary & { regieRafFps: number };
  switching: { previewSceneMs: number; coldSceneMs: number; coldVideoWidths: number[] };
  /** Sources the pages decoded in the idle window. */
  decodedSources: { output: string[]; regie: string[] };
  /** The busiest functions of the main thread of the Regie and of the output over a sampled window (self time per second). */
  profiles: { regie: Array<{ name: string; where: string; selfShare: number }>; output: Array<{ name: string; where: string; selfShare: number }> };
}

/** `[key, value]` pairs of a summary in a stable order (the recorded table). */
export function flatten(summary: PerfSummary): Array<[string, number | string | boolean | null]> {
  const rows: Array<[string, number | string | boolean | null]> = [];
  for (const [window, value] of [['idle', summary.idle], ['dragging', summary.dragging]] as const) {
    for (const role of ['output', 'regie'] as const) {
      const r = value[role];
      rows.push(
        [`${window}.${role}.cores`, r.cores],
        [`${window}.${role}.gpuCores`, r.coresByType['GPU'] ?? 0],
        [`${window}.${role}.mainThreadBusy`, r.mainThreadBusy],
        [`${window}.${role}.decodedStreams`, r.decodedStreams],
        [`${window}.${role}.subscribedStreams`, r.subscribedStreams],
        [`${window}.${role}.softwareStreams`, r.softwareStreams],
        [`${window}.${role}.decodeLoad`, r.decodeLoad],
        [`${window}.${role}.megapixelsPerSecond`, r.megapixelsPerSecond],
        [`${window}.${role}.framePixels`, r.framePixels],
        [`${window}.${role}.droppedShare`, r.droppedShare],
      );
    }
    const s = value.senders;
    rows.push(
      [`${window}.machineBusy`, value.machineBusy],
      [`${window}.regie.videos`, value.dom.regie.videos],
      [`${window}.regie.paintedVideos`, value.dom.regie.paintedVideos],
      [`${window}.output.videos`, value.dom.output.videos],
      [`${window}.regie.canvases`, value.dom.regie.canvases],
      [`${window}.output.canvases`, value.dom.output.canvases],
      [`${window}.senders.cores`, s.cores],
      [`${window}.senders.phoneEncodeLoad`, s.phoneEncodeLoad],
      [`${window}.senders.screenEncodeLoad`, s.screenEncodeLoad],
      [`${window}.senders.screenCodec`, s.screenCodec],
      [`${window}.senders.screenEncoder`, s.screenEncoder],
      [`${window}.senders.screenFps`, s.screenFps],
      [`${window}.senders.cpuLimited`, s.cpuLimited],
    );
  }
  rows.push(
    ['dragging.regieRafFps', summary.dragging.regieRafFps],
    ['switching.previewSceneMs', summary.switching.previewSceneMs],
    ['switching.coldSceneMs', summary.switching.coldSceneMs],
    ['decodedSources.output', summary.decodedSources.output.join(' ')],
    ['decodedSources.regie', summary.decodedSources.regie.join(' ')],
  );
  return rows;
}

/** A load may exceed its budget by this share before the check fails. */
export const TOLERANCE = 0.2;

/** One line of the budget: the value of a key of {@link flatten} must not exceed `max`, or must equal `equals`. */
export type BudgetLine =
  | { key: string; kind: 'count' | 'load'; max: number; why: string }
  | { key: string; kind: 'count'; equals: string | boolean; why: string };

/**
 * The budget of the reference scenario: 4 phones (camera 1080p), 2 laptop screens (1440p), 6 scenes, Studio Mode on,
 * fake media, Chromium without a GPU (everything decodes and encodes in software).
 */
export const BUDGET: readonly BudgetLine[] = [
  // What the output page decodes: the program scene (K1, K2) and the preview scene (S1, K1), nothing else.
  { key: 'idle.output.decodedStreams', kind: 'count', max: 3, why: 'the output decodes only the sources of the program and the preview scene' },
  { key: 'dragging.output.decodedStreams', kind: 'count', max: 3, why: 'the output decodes only the sources of the program and the preview scene' },
  { key: 'idle.output.videos', kind: 'count', max: 2, why: 'only the program scene has videos on the output stage' },
  { key: 'dragging.output.videos', kind: 'count', max: 2, why: 'only the program scene has videos on the output stage' },
  // What the Regie decodes: one picture per station (the thumbnails of the stations) and nothing for the scene thumbnails.
  { key: 'idle.regie.decodedStreams', kind: 'count', max: 6, why: 'the Regie decodes one stream per source' },
  { key: 'dragging.regie.decodedStreams', kind: 'count', max: 6, why: 'the Regie decodes one stream per source' },
  { key: 'idle.regie.videos', kind: 'count', max: 16, why: 'scene thumbnails are stills, not videos' },
  // A canvas on screen is a layer the compositor keeps drawing: the Regie has the hold-frame canvases of its monitors and
  // none for thumbnails (their stills are images); measured with 16 canvases for the stills, the GPU process needed twice
  // the time and the animation frame rate fell from 30 to 3.
  { key: 'idle.regie.canvases', kind: 'count', max: 8, why: 'thumbnail stills are images, not canvases' },
  { key: 'dragging.regie.canvases', kind: 'count', max: 8, why: 'thumbnail stills are images, not canvases' },
  { key: 'idle.output.canvases', kind: 'count', max: 4, why: 'the output has the hold-frame canvases of the program only' },
  { key: 'dragging.regie.videos', kind: 'count', max: 16, why: 'scene thumbnails are stills, not videos' },
  // The senders: screens go out as H.264 (this machine has no power-efficient VP9 encoder) at 15 fps at most.
  { key: 'idle.senders.screenCodec', kind: 'count', equals: 'h264', why: 'a screen uses VP9 only where the encoder is power-efficient' },
  { key: 'idle.senders.screenFps', kind: 'count', max: 16, why: 'a screen sends 15 fps unless the slot has "Video in screen"' },
  // CPU seconds per second of all processes of a role's browser.
  { key: 'idle.output.cores', kind: 'load', max: 0.5, why: 'output page CPU, idle' },
  { key: 'dragging.output.cores', kind: 'load', max: 0.45, why: 'output page CPU while the Regie edits' },
  { key: 'idle.regie.cores', kind: 'load', max: 0.8, why: 'Regie CPU, idle' },
  { key: 'dragging.regie.cores', kind: 'load', max: 1.2, why: 'Regie CPU while an item is dragged' },
  { key: 'idle.regie.gpuCores', kind: 'load', max: 0.35, why: 'GPU process of the Regie (software rendering here), idle' },
  { key: 'dragging.regie.gpuCores', kind: 'load', max: 0.35, why: 'GPU process of the Regie while an item is dragged' },
  { key: 'idle.senders.cores', kind: 'load', max: 2.3, why: 'six senders (software encoding), all together' },
  { key: 'dragging.senders.cores', kind: 'load', max: 2.3, why: 'six senders (software encoding), all together' },
  // Share of the time the main thread of the page is busy.
  { key: 'idle.output.mainThreadBusy', kind: 'load', max: 0.1, why: 'output page main thread, idle' },
  { key: 'dragging.output.mainThreadBusy', kind: 'load', max: 0.1, why: 'output page main thread while the Regie edits' },
  { key: 'idle.regie.mainThreadBusy', kind: 'load', max: 0.3, why: 'Regie main thread, idle' },
  { key: 'dragging.regie.mainThreadBusy', kind: 'load', max: 0.65, why: 'Regie main thread while an item is dragged' },
  // Frames the browser dropped (the machine cannot keep up) as a share of the decoded frames; the output warns from 5 %.
  { key: 'idle.output.droppedShare', kind: 'load', max: 0.05, why: 'dropped frames on the output' },
  { key: 'dragging.output.droppedShare', kind: 'load', max: 0.05, why: 'dropped frames on the output' },
  { key: 'idle.regie.droppedShare', kind: 'load', max: 0.05, why: 'dropped frames in the Regie' },
  // Milliseconds from the program change until every video of the new scene shows a picture.
  { key: 'switching.previewSceneMs', kind: 'load', max: 1500, why: 'a switch to the preview scene is immediate (typically 0.2 to 0.6 s here, including the API call and a busy machine)' },
  { key: 'switching.coldSceneMs', kind: 'load', max: 2000, why: 'a switch to another scene waits for its first keyframes (about half a second)' },
  // A measurement on a machine that starves the senders says nothing about the product: say so instead of passing or blaming it.
  { key: 'idle.senders.cpuLimited', kind: 'count', equals: false, why: 'a sender was at its CPU limit: the machine is too busy for a valid measurement, repeat it when the machine is quiet' },
  { key: 'dragging.senders.cpuLimited', kind: 'count', equals: false, why: 'a sender was at its CPU limit: the machine is too busy for a valid measurement, repeat it when the machine is quiet' },
];

/** The multiplier of the load lines from `PERF_BUDGET_SCALE` (1 when unset or invalid). */
export function budgetScale(env: Record<string, string | undefined> = process.env): number {
  const scale = Number(env['PERF_BUDGET_SCALE'] ?? 1);
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

/** Lines of the budget the summary exceeds (empty when it is within the budget). */
export function checkBudget(summary: PerfSummary, budget: readonly BudgetLine[] = BUDGET, scale = budgetScale()): string[] {
  const values = new Map(flatten(summary));
  const problems: string[] = [];
  for (const line of budget) {
    const value = values.get(line.key);
    if ('equals' in line) {
      if (value !== line.equals) problems.push(`${line.key} is ${String(value)}, expected ${String(line.equals)} (${line.why})`);
      continue;
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      problems.push(`${line.key} was not measured (${line.why})`);
      continue;
    }
    const limit = line.kind === 'count' ? line.max : line.max * scale * (1 + TOLERANCE);
    if (value > limit) {
      problems.push(`${line.key} is ${round(value)}, budget ${line.kind === 'count' ? 'exactly' : 'with 20 % tolerance'} ${round(limit)} (${line.why})`);
    }
  }
  return problems;
}

/**
 * Whether a line depends on how much headroom the machine had: the loads (CPU, main thread, switching time) and the
 * starvation of the senders. Counts (decoded streams, videos, canvases, the screen codec) do not: a stream more is a
 * stream more on any machine.
 */
export function isLoadDependent(line: BudgetLine): boolean {
  return line.key.endsWith('.cpuLimited') || line.kind === 'load';
}

/**
 * {@link checkBudget} in two parts. The counts are enforced on any machine. The loads are only worth holding against the
 * budget if the machine had headroom: a run in which a sender was at its CPU limit says nothing about the product
 * (docs/testing.md 6.8), so its loads are recorded, not judged.
 */
export function checkBudgetParts(summary: PerfSummary, budget: readonly BudgetLine[] = BUDGET, scale = budgetScale()): { counts: string[]; loads: string[] } {
  return {
    counts: checkBudget(summary, budget.filter((line) => !isLoadDependent(line)), scale),
    loads: checkBudget(summary, budget.filter(isLoadDependent), scale),
  };
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
