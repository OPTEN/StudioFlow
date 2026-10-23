import { LogLevel, type ILogger } from '@microsoft/signalr';
import { redactSecrets } from '@studioflow/realtime-client';
import type { MediaLogger } from '@studioflow/media-client';

/**
 * Console logging of the output page. The page may run for days in a proxy and retries forever during outages, so
 * repeated warnings are written at most once per {@link REPEAT_WINDOW_MS}. Nothing passed here may contain the
 * output key; messages are redacted (`k=`, `access_token=`) as a second line of defence.
 */

/** Identical messages within this window are dropped. */
export const REPEAT_WINDOW_MS = 60_000;
/** Bound of the repeat memory. */
const MAX_REMEMBERED = 200;

/** Minimal logging seam of the page. */
export interface OutputLog {
  warn(message: string): void;
}

/** The console methods the log uses. */
export interface ConsoleLike {
  warn(...data: unknown[]): void;
}

/** Creates the page log (deduplicated warnings). */
export function createOutputLog(
  target: ConsoleLike = console,
  now: () => number = () => Date.now(),
  windowMs = REPEAT_WINDOW_MS,
): OutputLog {
  const lastWritten = new Map<string, number>();
  return {
    warn(message: string): void {
      const text = redactSecrets(message);
      const at = now();
      const last = lastWritten.get(text);
      if (last !== undefined && at - last < windowMs) {
        return;
      }
      if (lastWritten.size >= MAX_REMEMBERED) {
        lastWritten.clear();
      }
      lastWritten.set(text, at);
      target.warn(`[StudioFlow Output] ${text}`);
    },
  };
}

/** SignalR logger: warnings and errors go to the page log (SignalR's own lines are redacted by realtime-client). */
export function signalRLogger(log: OutputLog): ILogger {
  return {
    log(level: LogLevel, message: string): void {
      if (level >= LogLevel.Warning && level !== LogLevel.None) {
        log.warn(`hub: ${message}`);
      }
    },
  };
}

/** Media client logger: warnings with the (secret-free) error message and status of the context. */
export function mediaLogger(log: OutputLog): MediaLogger {
  return {
    debug: () => undefined,
    warn(message, context): void {
      const detail = context?.['message'] ?? context?.['status'];
      log.warn(`media: ${message}${detail === undefined ? '' : ` (${String(detail)})`}`);
    },
  };
}
