/** Handle returned by {@link Clock.setTimeout}; opaque to callers. */
export type TimerHandle = ReturnType<typeof globalThis.setTimeout>;

/**
 * Time source and timers, injectable so tests can drive every delay deterministically. `now()` is monotonic
 * (performance.now() time base, the same base the renderer uses for `SourceAvailability.since`).
 */
export interface Clock {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): TimerHandle;
  clearTimeout(handle: TimerHandle): void;
}

/** Browser clock. Reads the globals on every call so test fake timers installed later still apply. */
export const systemClock: Clock = {
  now: () => globalThis.performance.now(),
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (handle) => globalThis.clearTimeout(handle),
};

/** Rejection reason of {@link withTimeout}. */
export class TimeoutError extends Error {
  override readonly name = 'TimeoutError';

  constructor(readonly timeoutMs: number) {
    super(`Timed out after ${timeoutMs} ms`);
  }
}

/**
 * Races a promise against a timer so a hanging network call (fetch without timeout, a stalled SDK connect) cannot block
 * a retry loop forever. A late rejection of the original promise is swallowed (no unhandled rejection).
 */
export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  clock: Clock = systemClock,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = clock.setTimeout(() => reject(new TimeoutError(timeoutMs)), timeoutMs);
    promise.then(
      (value) => {
        clock.clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clock.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * A cancellable pause: resolves `true` after `delayMs`, or `false` as soon as {@link CancellableDelay.cancel} is called,
 * so awaiting code never hangs after a dispose.
 */
export interface CancellableDelay {
  readonly done: Promise<boolean>;
  cancel(): void;
}

/** Starts a {@link CancellableDelay}. */
export function cancellableDelay(delayMs: number, clock: Clock = systemClock): CancellableDelay {
  let settle: (elapsed: boolean) => void = () => undefined;
  const done = new Promise<boolean>((resolve) => (settle = resolve));
  const timer = clock.setTimeout(() => settle(true), delayMs);
  return {
    done,
    cancel: () => {
      clock.clearTimeout(timer);
      settle(false);
    },
  };
}
