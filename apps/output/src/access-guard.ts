/**
 * «Kein Zugang» handling (spec 9.3: no retry loop faster than 30 s). Two connections can be refused independently:
 * the output hub (negotiate 401/403: wrong or rotated key, IP not allowed) and the media side (token endpoint
 * 401/403/404, or LiveKit removed the participant after a key rotation). While any side is refused the page shows
 * «Kein Zugang»; every {@link ACCESS_RETRY_MS} the refused sides are tried again, so a corrected IP rule (or a key
 * that becomes valid again) recovers by itself without anybody touching the proxy.
 */

/** Minimum time between two attempts with a refused link. */
export const ACCESS_RETRY_MS = 30_000;

/** A connection that can be refused. */
export type AccessSide = 'hub' | 'media';

/** Timer seam (fake timers in tests). */
export type ScheduleFn = (callback: () => void, delayMs: number) => () => void;

/** Options of {@link AccessGuard}. */
export interface AccessGuardOptions {
  /** The first side was refused: show «Kein Zugang». */
  readonly onDenied: () => void;
  /** The last refused side connected again. */
  readonly onAllowed: () => void;
  /** Try a refused side again (e.g. `hub.restart()`). */
  readonly retry: (side: AccessSide) => void;
  readonly retryMs?: number;
  readonly now?: () => number;
  readonly schedule?: ScheduleFn;
}

const defaultSchedule: ScheduleFn = (callback, delayMs) => {
  const handle = setTimeout(callback, delayMs);
  return () => clearTimeout(handle);
};

/** Tracks refused sides and schedules the slow retries. */
export class AccessGuard {
  readonly #denied = new Set<AccessSide>();
  readonly #retryMs: number;
  readonly #now: () => number;
  readonly #schedule: ScheduleFn;
  #cancelRetry: (() => void) | null = null;
  /** Start of the current waiting period: the first refusal, then every retry. */
  #lastAttemptAt: number | null = null;
  #disposed = false;

  constructor(private readonly options: AccessGuardOptions) {
    this.#retryMs = options.retryMs ?? ACCESS_RETRY_MS;
    this.#now = options.now ?? (() => Date.now());
    this.#schedule = options.schedule ?? defaultSchedule;
  }

  /** True while at least one side is refused. */
  get denied(): boolean {
    return this.#denied.size > 0;
  }

  /** True while this side is refused. */
  isDenied(side: AccessSide): boolean {
    return this.#denied.has(side);
  }

  /** A side was refused (again). Retries are scheduled at most every {@link ACCESS_RETRY_MS}. */
  deny(side: AccessSide): void {
    if (this.#disposed) {
      return;
    }
    const wasDenied = this.denied;
    this.#denied.add(side);
    if (!wasDenied) {
      this.#lastAttemptAt = this.#now();
      this.options.onDenied();
    }
    this.#ensureRetry();
  }

  /** A side connected. */
  allow(side: AccessSide): void {
    if (this.#disposed || !this.#denied.delete(side)) {
      return;
    }
    if (this.#denied.size === 0) {
      this.#clearRetry();
      this.#lastAttemptAt = null;
      this.options.onAllowed();
    }
  }

  /** Cancels the pending retry for good. */
  dispose(): void {
    this.#disposed = true;
    this.#clearRetry();
    this.#denied.clear();
  }

  #ensureRetry(): void {
    if (this.#cancelRetry || this.#denied.size === 0) {
      return;
    }
    const since = this.#lastAttemptAt ?? this.#now();
    const delay = Math.max(0, since + this.#retryMs - this.#now());
    this.#cancelRetry = this.#schedule(() => this.#runRetry(), delay);
  }

  #runRetry(): void {
    this.#cancelRetry = null;
    if (this.#disposed || this.#denied.size === 0) {
      return;
    }
    this.#lastAttemptAt = this.#now();
    for (const side of [...this.#denied]) {
      try {
        this.options.retry(side);
      } catch {
        // A failing restart is reported through the state listeners; the next retry follows below.
      }
    }
    // A side that stays refused without a new state change (still connecting) gets the next slot as well.
    this.#ensureRetry();
  }

  #clearRetry(): void {
    this.#cancelRetry?.();
    this.#cancelRetry = null;
  }
}
