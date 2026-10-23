import { LogLevel, type ILogger } from '@microsoft/signalr';

/**
 * Query parameters that carry secrets: SignalR appends the hub token as `access_token` to WebSocket and SSE URLs and
 * logs those URLs (e.g. «WebSocket connected to wss://…?access_token=…»); the output page carries its key as `k`.
 */
const SECRET_QUERY_PATTERN = /([?&](?:access_token|k)=)[^&#\s'"]*/gi;

/** Replaces secret query parameter values in a text (log line, error message) with `REDACTED`. */
export function redactSecrets(text: string): string {
  return text.replace(SECRET_QUERY_PATTERN, '$1REDACTED');
}

/** Wraps a logger so no message reaches it with a hub token or output key in a URL. */
export function redactingLogger(inner: ILogger): ILogger {
  return {
    log(level: LogLevel, message: string): void {
      inner.log(level, redactSecrets(message));
    },
  };
}

/** Console logger that drops everything below `minimum`; the default for hubs without an explicit logger. */
export function consoleLogger(minimum: LogLevel): ILogger {
  return {
    log(level: LogLevel, message: string): void {
      if (level < minimum || level === LogLevel.None) {
        return;
      }
      const line = `[StudioFlow realtime] ${message}`;
      if (level >= LogLevel.Error) {
        console.error(line);
      } else if (level === LogLevel.Warning) {
        console.warn(line);
      } else if (level === LogLevel.Information) {
        console.info(line);
      } else {
        console.debug(line);
      }
    },
  };
}

/** Readable, redacted description of anything that was thrown or passed as a close reason. */
export function describeError(error: unknown): string {
  if (error instanceof Error) {
    return redactSecrets(error.message || error.name);
  }
  if (typeof error === 'string') {
    return redactSecrets(error);
  }
  return error === undefined ? 'no error' : redactSecrets(String(error));
}

/** Logs without ever throwing: a broken logger must not break the connection logic. */
export function logSafely(logger: ILogger | undefined, level: LogLevel, message: string): void {
  if (!logger) {
    return;
  }
  try {
    logger.log(level, redactSecrets(message));
  } catch {
    // Logging is best effort; the reconnect and sync logic must keep running.
  }
}
