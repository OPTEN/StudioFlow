import fs from 'node:fs';
import path from 'node:path';
import type { BrowserContext, Frame } from '@playwright/test';
import { expect } from '@playwright/test';
import type { OutputPage } from '../ui/output';

/**
 * Node side of the browser-side probe of the output page (`browser/output-probe.js`, injected with `context.addInitScript`, so it also
 * runs inside the iframe of an embedding page and again after a reload). The output page has no `window.__sfOutput` and
 * no `data-state` / `data-slate` hooks (spec 12; docs/testing.md 1.7 lists hooks the product does not have), so the OUT
 * specs observe the DOM the renderer builds: layers (`[data-scene-id]`), items (`[data-item-id]`), the slate and the
 * elements it toggles for the hold frame.
 */

const PROBE_SOURCE = fs.readFileSync(path.join(__dirname, 'browser', 'output-probe.js'), 'utf8');

/** Installs the probe in every page and frame of the context that opens `/o/...` later. */
export async function installProbe(context: BrowserContext): Promise<void> {
  await context.addInitScript({ content: PROBE_SOURCE });
}

/** What an item shows (derived from the DOM, see browser/output-probe.js). */
export type ItemState = 'live' | 'connecting' | 'hold' | 'held' | 'fallback' | 'media' | 'missing';

export interface ProbeEvent {
  /** Epoch milliseconds (same clock as `Date.now()`). */
  t: number;
  type: 'layer+' | 'layer-' | 'slate+' | 'slate-' | 'video+' | 'video-';
  id?: string;
  title?: string;
  item?: string | null;
}

export interface ProbeItem {
  id: string;
  layer: string | null;
  state: ItemState;
  x: number;
  y: number;
  w: number;
  h: number;
  video: { ready: number; w: number; h: number; paused: boolean; time: number } | null;
  blur: string;
  /** Mean luminance 0..255 of the picture (only with `luma: true`). */
  luma?: number | null;
}

export interface ProbeFrame {
  t: number;
  layers: Array<{ id: string; opacity: number }>;
  items: ProbeItem[];
  slate: { opacity: number; title: string; subtitle: string } | null;
  videos: number;
  /** Running Web Animations (only with `animations: true`). */
  anims?: Array<{ scene: string | null; cls: string | null; duration: number | null; props: string[]; time: number | null }>;
}

export interface VideoFrameEntry {
  t: number;
  /** Serial of the video element. */
  v: number;
  item: string | null;
  w: number;
  h: number;
  /** `presentedFrames` of the element. */
  n: number;
  m: number;
}

/** Handle on the probe of one output page (direct, or the iframe of an embedding page). */
export class OutputProbe {
  constructor(readonly output: OutputPage) {}

  private async frame(): Promise<Frame> {
    return this.output.frame();
  }

  /** The probe exists in the document (it only starts on `/o/...`). */
  async installed(): Promise<boolean> {
    return (await this.frame()).evaluate(
      () => Boolean((window as unknown as { __outProbe?: unknown }).__outProbe),
    );
  }

  /** `performance.timeOrigin` of the output document: unchanged means the page was not reloaded. */
  async timeOrigin(): Promise<number> {
    return (await this.frame()).evaluate(() => performance.timeOrigin);
  }

  /** Events since the last call (layers and slates added/removed, videos added/removed). */
  async takeEvents(): Promise<ProbeEvent[]> {
    return (await this.frame()).evaluate(() =>
      (window as unknown as { __outProbe: { takeEvents(): ProbeEvent[] } }).__outProbe.takeEvents(),
    );
  }

  /** Has the standby slate ever been created in this document? */
  async standbySeen(): Promise<boolean> {
    return (await this.frame()).evaluate(
      () => (window as unknown as { __outProbe: { standbySeen: boolean } }).__outProbe.standbySeen,
    );
  }

  /** `navigator.userActivation.hasBeenActive` at the moment the first video started to play (undefined: none did yet). */
  async activationAtFirstPlay(): Promise<boolean | null | undefined> {
    return (await this.frame()).evaluate(
      () => (window as unknown as { __outProbe: { activationAtFirstPlay: boolean | null | undefined } }).__outProbe.activationAtFirstPlay,
    );
  }

  /** Epoch ms of the first `playing` event of a video in this document (undefined: none yet). */
  async firstPlayAt(): Promise<number | undefined> {
    return (await this.frame()).evaluate(
      () => (window as unknown as { __outProbe: { firstPlayAt: number | undefined } }).__outProbe.firstPlayAt,
    );
  }

  /** `navigator.userActivation.hasBeenActive` when the document started (true: the navigation itself carried a gesture). */
  async activationAtStart(): Promise<boolean | null> {
    return (await this.frame()).evaluate(
      () => (window as unknown as { __outProbe: { activationAtStart: boolean | null } }).__outProbe.activationAtStart,
    );
  }

  /** Has the «Kein Zugang» slate ever been created in this document? */
  async denySeen(): Promise<boolean> {
    return (await this.frame()).evaluate(
      () => (window as unknown as { __outProbe: { denySeen: boolean } }).__outProbe.denySeen,
    );
  }

  /** One snapshot of the stage now. */
  async snapshot(luma = false, animations = false): Promise<ProbeFrame> {
    return (await this.frame()).evaluate(
      (args) =>
        (
          window as unknown as {
            __outProbe: { snapshot(withLuma: boolean, withAnimations: boolean): ProbeFrame };
          }
        ).__outProbe.snapshot(args.luma, args.animations),
      { luma, animations },
    );
  }

  /** Records a snapshot per animation frame until {@link stopSampler}. */
  async startSampler(options: { luma?: boolean; animations?: boolean } = {}): Promise<void> {
    await (
      await this.frame()
    ).evaluate(
      (opts) =>
        (
          window as unknown as {
            __outProbe: { startSampler(o: { luma?: boolean; animations?: boolean }): void };
          }
        ).__outProbe.startSampler(opts),
      options,
    );
  }

  /** The frames recorded so far; the sampler keeps running. */
  async peekSampler(): Promise<ProbeFrame[]> {
    return (await this.frame()).evaluate(() => (window as unknown as { __outProbe: { frames: ProbeFrame[] | null } }).__outProbe.frames?.slice() ?? []);
  }

  async stopSampler(): Promise<ProbeFrame[]> {
    return (await this.frame()).evaluate(() =>
      (window as unknown as { __outProbe: { stopSampler(): ProbeFrame[] } }).__outProbe.stopSampler(),
    );
  }

  /** Logs every presented video frame (requestVideoFrameCallback) until {@link stopFrameLog}. */
  async startFrameLog(): Promise<void> {
    await (
      await this.frame()
    ).evaluate(() =>
      (window as unknown as { __outProbe: { startFrameLog(): void } }).__outProbe.startFrameLog(),
    );
  }

  async stopFrameLog(): Promise<VideoFrameEntry[]> {
    return (await this.frame()).evaluate(() =>
      (
        window as unknown as { __outProbe: { stopFrameLog(): VideoFrameEntry[] } }
      ).__outProbe.stopFrameLog(),
    );
  }

  /** Snapshot of the frame log without stopping it. */
  async frameLogSoFar(): Promise<VideoFrameEntry[]> {
    return (await this.frame()).evaluate(() =>
      (window as unknown as { __outProbe: { frameLog: VideoFrameEntry[] } }).__outProbe.frameLog.slice(),
    );
  }

  /** Waits until an item is in `state` (polling the DOM) and returns its snapshot. */
  async waitForItemState(
    itemId: string,
    state: ItemState | ItemState[],
    timeout = 20_000,
  ): Promise<ProbeItem> {
    const wanted = Array.isArray(state) ? state : [state];
    let last: ProbeItem | undefined;
    await expect
      .poll(
        async () => {
          last = (await this.snapshot()).items.find((item) => item.id === itemId);
          return last?.state ?? 'absent';
        },
        {
          timeout,
          intervals: [50, 100, 100, 200],
          message: `item ${itemId} reaches ${wanted.join('|')}`,
        },
      )
      .toMatch(new RegExp(`^(${wanted.join('|')})$`));
    return last!;
  }

  /** Waits until the layer of a scene is the only one on the stage (a fade has completed). */
  async waitForScene(sceneId: string, timeout = 15_000): Promise<void> {
    await expect
      .poll(async () => (await this.snapshot()).layers.map((layer) => layer.id), {
        timeout,
        intervals: [50, 100, 200],
        message: `scene ${sceneId} is the only layer`,
      })
      .toEqual([sceneId]);
  }
}

/** Longest gap in ms between consecutive entries of a presented-frame log (per video element), or null. */
export function longestGap(log: readonly VideoFrameEntry[], from?: number, to?: number): number | null {
  const byVideo = new Map<number, number[]>();
  for (const entry of log) {
    if ((from !== undefined && entry.t < from) || (to !== undefined && entry.t > to)) continue;
    const list = byVideo.get(entry.v) ?? [];
    list.push(entry.t);
    byVideo.set(entry.v, list);
  }
  let longest: number | null = null;
  for (const times of byVideo.values()) {
    for (let index = 1; index < times.length; index++) {
      const gap = times[index]! - times[index - 1]!;
      if (longest === null || gap > longest) longest = gap;
    }
  }
  return longest;
}
