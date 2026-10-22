/** Receives errors from foreign code (provider, callbacks) instead of letting them escape. */
export type ErrorSink = (error: unknown) => void;

/** Default sink: a warning in the console, so failures stay visible without breaking the picture. */
export const consoleErrorSink: ErrorSink = (error) => {
  console.warn('[scene-renderer]', error);
};

/**
 * Runs foreign code; a thrown error goes to the sink and `fallback` is returned. A throwing sink is ignored, because the
 * renderer must keep rendering whatever the host does.
 */
export function guarded<T>(sink: ErrorSink, run: () => T, fallback: T): T {
  try {
    return run();
  } catch (error) {
    try {
      sink(error);
    } catch {
      // The sink itself failed; nothing sensible is left to report to.
    }
    return fallback;
  }
}
