import { SCREEN_COLORS } from '../ui/init';
import { parseHex } from '../ui/pixels';
import type { ProbeEvent, ProbeFrame, ProbeItem } from './probe';

/** Euclidean distance of two RGB colours. */
export function colourDistance(a: readonly number[], b: readonly number[]): number {
  return Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
}

export type Tone = 'red' | 'green' | 'blue' | 'yellow' | 'violet' | 'dark' | 'mixed';

/** The colour of the stage ground in a scene without a picture (`#0d1117`, the default scene background). */
export const GROUND: readonly [number, number, number] = [13, 17, 23];

const TONES: Array<[Tone, readonly number[]]> = [
  ['red', parseHex(SCREEN_COLORS[0])],
  ['green', parseHex(SCREEN_COLORS[1])],
  ['blue', parseHex(SCREEN_COLORS[2])],
  ['yellow', parseHex(SCREEN_COLORS[3])],
  ['violet', parseHex(SCREEN_COLORS[4])],
  ['dark', GROUND],
];

/**
 * Which flat colour a mean pixel is: one of the fake screens' colours (within `tolerance`, the codec shifts them a
 * little), the dark scene ground, or something in between (`mixed`, a cross-fade).
 */
export function toneOf(rgb: readonly number[], tolerance = 45): Tone {
  let best: Tone = 'mixed';
  let distance = Infinity;
  for (const [tone, colour] of TONES) {
    const d = colourDistance(rgb, colour);
    if (d < distance) {
      distance = d;
      best = tone;
    }
  }
  return distance <= tolerance ? best : 'mixed';
}

/** First event of a type (optionally for a layer id) at or after a time. */
export function firstEvent(events: readonly ProbeEvent[], type: ProbeEvent['type'], options: { id?: string; after?: number } = {}): ProbeEvent | undefined {
  return events.find((event) => event.type === type && (options.id === undefined || event.id === options.id) && (options.after === undefined || event.t >= options.after));
}

/** An item of the given layer in a sampled frame. */
export function itemsOfLayer(frame: ProbeFrame, layer: string): ProbeItem[] {
  return frame.items.filter((item) => item.layer === layer);
}

/** Linear regression slope of y over x. */
export function slope(points: ReadonlyArray<readonly [number, number]>): number {
  const n = points.length;
  if (n < 2) return 0;
  const mx = points.reduce((s, p) => s + p[0], 0) / n;
  const my = points.reduce((s, p) => s + p[1], 0) / n;
  const den = points.reduce((s, p) => s + (p[0] - mx) ** 2, 0);
  return den === 0 ? 0 : points.reduce((s, p) => s + (p[0] - mx) * (p[1] - my), 0) / den;
}

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
