/**
 * A set of callbacks with error isolation: one throwing listener neither breaks the others nor the emitting state
 * machine (errors go to `onError`). Emission iterates over a snapshot, so listeners may (un)subscribe re-entrantly.
 */
export class Listeners<TArgs extends readonly unknown[]> {
  readonly #listeners = new Set<(...args: TArgs) => void>();

  constructor(private readonly onError: (error: unknown) => void) {}

  /** Adds a listener; returns the matching unsubscribe function (idempotent). */
  add(listener: (...args: TArgs) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /** Calls every listener with the given arguments. */
  emit(...args: TArgs): void {
    for (const listener of [...this.#listeners]) {
      try {
        listener(...args);
      } catch (error) {
        this.onError(error);
      }
    }
  }

  /** Removes all listeners (dispose). */
  clear(): void {
    this.#listeners.clear();
  }
}
