import { AUDIO_SILENCE_DB, AUDIO_SILENCE_WARNING_MS } from './audio';

/**
 * Silence detection of the Regie (issue #7): an audible channel that delivers no signal for 10 seconds is a warning, not
 * an incident – a presenter who stops talking is not a failure. A channel whose source is gone (no sound at all) is not
 * silent but missing: the incident of the source says so, and nothing is measured.
 */

/** What the tracker needs to know about one channel at one moment. */
export interface SilenceReading {
  readonly sourceId: string;
  /** The channel is audible in the program right now. */
  readonly audible: boolean;
  /** The channel has a sound to measure (a live track, a playing video). */
  readonly hasSound: boolean;
  /** Peak level before the fader in dBFS. */
  readonly levelDb: number;
}

/** Options of {@link SilenceTracker}. */
export interface SilenceTrackerOptions {
  /** Levels below this are silence (default −60 dBFS). */
  readonly thresholdDb?: number;
  /** How long the silence must last before the warning (default 10 s). */
  readonly afterMs?: number;
}

/** Follows how long each audible channel has been quiet. */
export class SilenceTracker {
  readonly #thresholdDb: number;
  readonly #afterMs: number;
  readonly #since = new Map<string, number>();

  constructor(options: SilenceTrackerOptions = {}) {
    this.#thresholdDb = options.thresholdDb ?? AUDIO_SILENCE_DB;
    this.#afterMs = options.afterMs ?? AUDIO_SILENCE_WARNING_MS;
  }

  /** Takes the readings of one moment (milliseconds) and returns the channels that have been silent long enough. */
  update(nowMs: number, readings: Iterable<SilenceReading>): ReadonlySet<string> {
    const silent = new Set<string>();
    const seen = new Set<string>();
    for (const reading of readings) {
      seen.add(reading.sourceId);
      const quiet = reading.audible && reading.hasSound && reading.levelDb < this.#thresholdDb;
      if (!quiet) {
        this.#since.delete(reading.sourceId);
        continue;
      }
      const since = this.#since.get(reading.sourceId) ?? nowMs;
      this.#since.set(reading.sourceId, since);
      if (nowMs - since >= this.#afterMs) {
        silent.add(reading.sourceId);
      }
    }
    for (const sourceId of [...this.#since.keys()]) {
      if (!seen.has(sourceId)) {
        this.#since.delete(sourceId);
      }
    }
    return silent;
  }

  /** Forgets everything (the broadcast ended, the production changed). */
  reset(): void {
    this.#since.clear();
  }
}
