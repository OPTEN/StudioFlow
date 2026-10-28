import { expect, type Frame, type Page } from '@playwright/test';
import type { OutputPage } from './output';

/**
 * Helpers of the audio specs (issue #7, docs/testing.md 2.21 AUD). The pages are measured with the audio probe of
 * `support/browser/audio-probe.js` (install it with `audioProbe: true`): it reads what a page sends to its speakers, so a
 * frequency in the spectrum means that a source really got through the whole chain (microphone, LiveKit, output page,
 * mixer), and silence means that it did not.
 */

export interface AudioPeak {
  frequency: number;
  db: number;
}

export interface AudioMeasure {
  state: string;
  sampleRate: number;
  peakDb: number;
  rmsDb: number;
  /** Dominant frequency in Hz, null below -60 dBFS. */
  frequency: number | null;
  peaks: AudioPeak[];
}

/** A level that counts as "no sound": 40 dB under the quietest tone the specs play (-6 dBFS * fader). */
export const SILENT_DB = -60;
/** The tone of a source at the fader's default is 0.5 (-6 dBFS); anything above this level is sound. */
export const AUDIBLE_DB = -35;
/** How far a measured frequency may be from the one that was played (the spectrum has 5.9 Hz bins). */
export const TONE_TOLERANCE_HZ = 12;

type Target = Page | Frame;

/** Polls `ready` until it is true; a timeout names what was waited for and the last measurement. */
async function pollUntil(
  what: string,
  ready: () => Promise<boolean>,
  last: () => unknown,
  options: { timeout: number; interval: number },
): Promise<void> {
  try {
    await expect.poll(ready, { timeout: options.timeout, intervals: [options.interval], message: what }).toBe(true);
  } catch (error) {
    throw new Error(`${(error as Error).message}\nlast measurement: ${JSON.stringify(last())}`);
  }
}

/** One measurement of the page, or null before any node was connected to its speakers. */
export async function measureAudio(target: Target): Promise<AudioMeasure | null> {
  return target.evaluate(
    () =>
      (
        window as unknown as { __sfAudioProbe?: { measure(): AudioMeasure | null } }
      ).__sfAudioProbe?.measure() ?? null,
  );
}

/** The frame of the output document (the page itself, or the iframe when embedded). */
export async function outputTarget(output: OutputPage): Promise<Target> {
  return output.embedded ? output.frame() : output.page;
}

/** Waits until the page plays a tone near `frequency` (and at least `minDb` loud); returns the measurement. */
export async function waitForTone(
  target: Target,
  frequency: number,
  options: { minDb?: number; timeout?: number; tolerance?: number } = {},
): Promise<AudioMeasure> {
  const { minDb = AUDIBLE_DB, timeout = 20_000, tolerance = TONE_TOLERANCE_HZ } = options;
  let last: AudioMeasure | null = null;
  await pollUntil(
    `a tone of ${frequency} Hz`,
    async () => {
      last = await measureAudio(target);
      return (
        last !== null &&
        last.peakDb >= minDb &&
        last.peaks.some((peak) => Math.abs(peak.frequency - frequency) <= tolerance)
      );
    },
    () => last,
    { timeout, interval: 100 },
  );
  return last!;
}

/**
 * Waits until the peak level of the page is within `toleranceDb` of `db` (a source that just came in still ramps up for
 * up to 300 ms); returns the measurement.
 */
export async function waitForPeak(
  target: Target,
  db: number,
  options: { toleranceDb?: number; timeout?: number } = {},
): Promise<AudioMeasure> {
  const { toleranceDb = 2.5, timeout = 10_000 } = options;
  let last: AudioMeasure | null = null;
  await pollUntil(
    `a peak level of ${db} dBFS ± ${toleranceDb}`,
    async () => {
      last = await measureAudio(target);
      return last !== null && Math.abs(last.peakDb - db) <= toleranceDb;
    },
    () => last,
    { timeout, interval: 50 },
  );
  return last!;
}

/** Waits until the page plays nothing (peak under {@link SILENT_DB}). */
export async function waitForSilence(
  target: Target,
  options: { timeout?: number; belowDb?: number } = {},
): Promise<AudioMeasure | null> {
  const { timeout = 10_000, belowDb = SILENT_DB } = options;
  let last: AudioMeasure | null = null;
  await pollUntil(
    'silence',
    async () => {
      last = await measureAudio(target);
      return last === null || last.peakDb < belowDb;
    },
    () => last,
    { timeout, interval: 100 },
  );
  return last;
}

/** True when the page plays a tone near `frequency` right now. */
export async function playsTone(
  target: Target,
  frequency: number,
  tolerance = TONE_TOLERANCE_HZ,
): Promise<boolean> {
  const measure = await measureAudio(target);
  return (
    measure !== null &&
    measure.peakDb >= AUDIBLE_DB &&
    measure.peaks.some((peak) => Math.abs(peak.frequency - frequency) <= tolerance)
  );
}

/**
 * Starts watching the page for the moment its sound drops under `belowDb`; the promise resolves with `Date.now()` of that
 * moment. Call it BEFORE the action (the page polls every 10 ms), await it after, and compare with the `Date.now()` taken
 * when the action was sent – both clocks are the clock of this machine.
 */
export function silenceAt(target: Target, belowDb = SILENT_DB, timeoutMs = 10_000): Promise<number> {
  return target.evaluate(
    ({ belowDb: limit, timeoutMs: timeout }) =>
      (
        window as unknown as {
          __sfAudioProbe: { waitFor(test: string, timeoutMs: number): Promise<number> };
        }
      ).__sfAudioProbe.waitFor(`(m) => !m || m.peakDb < ${limit}`, timeout),
    { belowDb, timeoutMs },
  );
}

/** Like {@link silenceAt} for the moment a tone near `frequency` is back. */
export function toneAt(target: Target, frequency: number, timeoutMs = 10_000): Promise<number> {
  return target.evaluate(
    ({ frequency: wanted, timeoutMs: timeout, audibleDb, tolerance }) =>
      (
        window as unknown as {
          __sfAudioProbe: { waitFor(test: string, timeoutMs: number): Promise<number> };
        }
      ).__sfAudioProbe.waitFor(
        `(m) => !!m && m.peakDb > ${audibleDb} && m.peaks.some((p) => Math.abs(p.frequency - ${wanted}) <= ${tolerance})`,
        timeout,
      ),
    { frequency, timeoutMs, audibleDb: AUDIBLE_DB, tolerance: TONE_TOLERANCE_HZ },
  );
}

/** `count` peak/RMS measurements `everyMs` apart (a fade, a ramp). */
export async function levelSeries(
  target: Target,
  count: number,
  everyMs: number,
): Promise<Array<{ at: number; peakDb: number | null; rmsDb: number | null }>> {
  return target.evaluate(
    ({ count: n, everyMs: step }) =>
      (
        window as unknown as {
          __sfAudioProbe: {
            series(
              n: number,
              everyMs: number,
            ): Promise<Array<{ at: number; peakDb: number | null; rmsDb: number | null }>>;
          };
        }
      ).__sfAudioProbe.series(n, step),
    { count, everyMs },
  );
}

/**
 * `count` readings `everyMs` apart of the strength of each frequency (dB of the analyser, comparable only for the same
 * frequency; -120 when it is absent). The window is 170 ms long, so this suits fades of a second or more.
 */
export async function toneSeries(
  target: Target,
  frequencies: readonly number[],
  count: number,
  everyMs: number,
): Promise<Array<{ at: number; db: number[] }>> {
  return target.evaluate(
    ({ frequencies: list, count: n, everyMs: step }) =>
      (
        window as unknown as {
          __sfAudioProbe: {
            toneSeries(
              frequencies: number[],
              n: number,
              everyMs: number,
            ): Promise<Array<{ at: number; db: number[] }>>;
          };
        }
      ).__sfAudioProbe.toneSeries([...list], n, step),
    { frequencies, count, everyMs },
  );
}

/** Strength of one frequency right now (see {@link toneSeries}). */
export async function toneDb(target: Target, frequency: number): Promise<number> {
  return target.evaluate(
    (wanted) =>
      (
        window as unknown as { __sfAudioProbe: { toneDb(frequency: number): number } }
      ).__sfAudioProbe.toneDb(wanted),
    frequency,
  );
}

/** A click on the output page: the browser lets its audio context start (the page asks for it, as OBS would not). */
export async function unlockSound(output: OutputPage): Promise<void> {
  await output.page.mouse.click(8, 8);
}

/** The sources of the page's fake microphones (`window.__sfAudioFake`). */
export async function fakeTones(
  page: Page,
): Promise<Array<{ kind: string; frequency: number; level: number; live: boolean; maxGapMs: number }>> {
  return page.evaluate(
    () =>
      (
        window as unknown as {
          __sfAudioFake?: {
            sources: Array<{
              kind: string;
              frequency: number;
              level: number;
              track: MediaStreamTrack;
              stats: { maxGapMs: number };
            }>;
          };
        }
      ).__sfAudioFake?.sources.map((entry) => ({
        kind: entry.kind,
        frequency: entry.frequency,
        level: entry.level,
        live: entry.track.readyState === 'live',
        maxGapMs: entry.stats.maxGapMs,
      })) ?? [],
  );
}

/** Changes the tone of the live fake sources of a kind (level 0 is silence). */
export async function setFakeTone(
  page: Page,
  kind: 'mic' | 'screen',
  patch: { frequency?: number; level?: number },
): Promise<void> {
  await page.evaluate(
    ({ kind: which, patch: values }) =>
      (
        window as unknown as {
          __sfAudioFake: { setTone(kind: string, patch: object): void };
        }
      ).__sfAudioFake.setTone(which, values),
    { kind, patch },
  );
}

/** The microphone is pulled out (`true`) or plugged back in (`false`). */
export async function plugMic(page: Page, plugged: boolean): Promise<void> {
  await page.evaluate(
    (back) =>
      (
        window as unknown as {
          __sfAudioFake: { unplugMic(): void; replugMic(): void };
        }
      ).__sfAudioFake[back ? 'replugMic' : 'unplugMic'](),
    plugged,
  );
}
