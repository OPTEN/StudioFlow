import type { OutputReport } from '@flowstudio/scene-model';

/** Cadence of `OutputReport` over the hub (spec 4.8: «every 2 s»). */
export const REPORT_INTERVAL_MS = 2000;
/** Cadence of the REST fallback while the hub is not connected. */
export const REST_REPORT_INTERVAL_MS = 10_000;

/** How reports leave the page. */
export interface ReportTransport {
  /** True while the hub is connected. */
  hubConnected(): boolean;
  /** `Report(OutputReport)` on the output hub. */
  sendViaHub(report: OutputReport): Promise<void>;
  /** `POST /api/output/{slug}/report`. */
  sendViaRest(report: OutputReport): Promise<void>;
}

/** Options of {@link StatusReporter}. */
export interface StatusReporterOptions {
  /** Builds the current report (latency needs WebRTC stats, hence async). */
  readonly collect: () => Promise<OutputReport>;
  readonly transport: ReportTransport;
  /** False suspends reporting (while «Kein Zugang» is shown: no requests faster than the 30 s access retry). */
  readonly enabled?: () => boolean;
  /** Runs before every report (autoplay check), so the page needs only one housekeeping timer. */
  readonly onTick?: () => void;
  readonly intervalMs?: number;
  readonly restIntervalMs?: number;
  readonly now?: () => number;
}

/**
 * Reports the output state every {@link REPORT_INTERVAL_MS} over the hub; while the hub is not connected (or a hub
 * send fails) it falls back to REST, at most every {@link REST_REPORT_INTERVAL_MS}. Never throws, never overlaps.
 */
export class StatusReporter {
  readonly #intervalMs: number;
  readonly #restIntervalMs: number;
  readonly #now: () => number;
  #timer: ReturnType<typeof setInterval> | null = null;
  #busy = false;
  #lastRestAt = Number.NEGATIVE_INFINITY;

  constructor(private readonly options: StatusReporterOptions) {
    this.#intervalMs = options.intervalMs ?? REPORT_INTERVAL_MS;
    this.#restIntervalMs = options.restIntervalMs ?? REST_REPORT_INTERVAL_MS;
    this.#now = options.now ?? (() => Date.now());
  }

  /** Starts the timer (first report after one interval). Idempotent. */
  start(): void {
    if (this.#timer === null) {
      this.#timer = setInterval(() => void this.tick(), this.#intervalMs);
    }
  }

  /** Stops the timer. */
  stop(): void {
    if (this.#timer !== null) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
  }

  /** One reporting round (exposed for tests and for an immediate report). */
  async tick(): Promise<void> {
    try {
      this.options.onTick?.();
    } catch {
      // Housekeeping must not stop reporting.
    }
    if (this.#busy || this.options.enabled?.() === false) {
      return;
    }
    this.#busy = true;
    try {
      const report = await this.options.collect();
      const { transport } = this.options;
      if (transport.hubConnected()) {
        try {
          await transport.sendViaHub(report);
          return;
        } catch {
          // The connection dropped during the send: fall through to REST.
        }
      }
      await this.#sendViaRest(report);
    } catch {
      // Reports are best effort; the next round tries again.
    } finally {
      this.#busy = false;
    }
  }

  async #sendViaRest(report: OutputReport): Promise<void> {
    const at = this.#now();
    if (at - this.#lastRestAt < this.#restIntervalMs) {
      return;
    }
    this.#lastRestAt = at;
    await this.options.transport.sendViaRest(report);
  }
}
