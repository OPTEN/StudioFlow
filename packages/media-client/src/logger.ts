/**
 * Minimal logging seam of the media client. Callers pass their own implementation (or {@link silentLogger} in tests);
 * the default writes warnings to the browser console. Tokens and other secrets are never passed to a logger.
 */
export interface MediaLogger {
  /** Diagnostic detail (connection steps, state changes). */
  debug(message: string, context?: Readonly<Record<string, unknown>>): void;
  /** Recoverable problems (failed attempts, rejected SDK calls, listener errors). */
  warn(message: string, context?: Readonly<Record<string, unknown>>): void;
}

/** Logger that drops everything (tests, embedding pages that want silence). */
export const silentLogger: MediaLogger = {
  debug: () => undefined,
  warn: () => undefined,
};

/** Default logger: warnings to the console with a `[media]` prefix, debug output dropped. */
export const consoleLogger: MediaLogger = {
  debug: () => undefined,
  warn: (message, context) => console.warn(`[media] ${message}`, context ?? {}),
};

/**
 * Reduces an unknown error to loggable, secret-free fields (name, message, HTTP status if present). Never includes the
 * error object itself, because SDK errors may carry URLs with access tokens.
 */
export function errorContext(error: unknown): Readonly<Record<string, unknown>> {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, ...statusOf(error) };
  }
  return { error: typeof error === 'string' ? error : typeof error };
}

function statusOf(error: Error): { status?: number } {
  const status: unknown = (error as Error & { status?: unknown }).status;
  return typeof status === 'number' ? { status } : {};
}
