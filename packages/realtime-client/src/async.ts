/**
 * Runs `callback` once after `delayMs` and returns a function that cancels it (idempotent). Injectable so tests can
 * control time without global fake timers.
 */
export type Schedule = (callback: () => void, delayMs: number) => () => void;

/** {@link Schedule} on top of `setTimeout`. */
export const defaultSchedule: Schedule = (callback, delayMs) => {
  const handle = setTimeout(callback, delayMs);
  return () => clearTimeout(handle);
};

/** True for promises and other thenables. */
export function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === 'object' || typeof value === 'function') &&
    value !== null &&
    'then' in value &&
    typeof value.then === 'function'
  );
}

/** Calls `operation` and turns a synchronous throw into a rejected promise, so callers only handle one failure path. */
export function promiseFrom<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return operation();
  } catch (error) {
    return Promise.reject(error);
  }
}
