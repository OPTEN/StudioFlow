import type { BrowserContext } from '@playwright/test';
import {
  installUiInit,
  type FakeScreenOptions,
  type FakeSourceOptions,
  type UiInitOptions,
} from './init';
import { latencyStats, type LatencySample, type LatencyStats } from './output';

/**
 * The latency stamp publisher (docs/testing.md 1.3 «timecode camera», research 2026-10-22 «Glass-to-glass latency»):
 * a fake camera that draws the stamp of `support/browser/latency-codec.js` (the codec of `apps/output/src/
 * latency-stamp.ts`: 34 blocks of 16 x 48 px on a 640 x 360 grid, current time in ms) onto a canvas and is handed to
 * the app through a `getUserMedia` override. The real sender publishes it to the real SFU; the output page, opened
 * with `?latency=1`, decodes the stamp of every presented frame into `window.__studioflowLatency`.
 *
 * Publisher and output must run on the same machine (they share the OS clock). Use one browser; the latency numbers
 * include everything between the canvas and the output's video frame: capture, encode, SFU, decode and render.
 */

export interface StampCameraOptions extends FakeSourceOptions {
  /** Also make the screen shares stamped canvases (default true, flat colour per screen). */
  screen?: UiInitOptions['screen'];
}

/** The init options for a context whose sender uses the stamp camera. */
export function stampCameraInit(options: StampCameraOptions = {}): UiInitOptions {
  const { screen = 'canvas', ...camera } = options;
  return {
    camera: { width: 1280, height: 720, fps: 30, ...camera },
    screen: screen as 'canvas' | 'native' | FakeScreenOptions,
  };
}

/** Installs the stamp camera in a context (before its pages navigate). */
export async function installStampCamera(
  context: BrowserContext,
  options: StampCameraOptions = {},
): Promise<void> {
  await installUiInit(context, stampCameraInit(options));
}

/** Pass criteria of docs/testing.md T-LATENCY applied to a measurement: monotone, plausible and enough samples. */
export function describeLatency(
  samples: readonly LatencySample[],
  options: { sourceId?: string; skip?: number } = {},
): LatencyStats & { summary: string } {
  const stats = latencyStats(samples, options);
  return {
    ...stats,
    summary: `${stats.count} frames, p50 ${Math.round(stats.p50)} ms, p95 ${Math.round(stats.p95)} ms, max ${Math.round(stats.max)} ms, widths ${stats.widths.join('/')}`,
  };
}
