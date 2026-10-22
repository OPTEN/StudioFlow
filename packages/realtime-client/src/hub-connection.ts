import {
  HubConnectionBuilder,
  JsonHubProtocol,
  LogLevel,
  type HubConnection,
  type IHttpConnectionOptions,
  type ILogger,
  type IRetryPolicy,
  type RetryContext,
} from '@microsoft/signalr';
import { backoffDelay } from './backoff';
import { consoleLogger, redactingLogger } from './logging';

/** Client timeout: the server sends a keep-alive every 2 s, so 5 s of silence means the connection is gone (spec 6, 12). */
export const SERVER_TIMEOUT_MS = 5000;

/** Client keep-alive interval; the server's client timeout is 6 s. */
export const KEEP_ALIVE_INTERVAL_MS = 2000;

/** Options for a hub connection. */
export interface HubConnectionOptions {
  /** Hub URL, usually relative to the page (`/hubs/studio`). */
  readonly url: string;
  /** Token sent as `access_token` (device `{id}.{secret}`, output key); called before every (re)connect. */
  readonly accessTokenFactory?: () => string | Promise<string>;
  /** Receives SignalR's and the wrapper's log lines (secrets redacted). Default: console, warnings and errors. */
  readonly logger?: ILogger;
}

/**
 * Matches SignalR's error texts for an HTTP 401/403 from the negotiate request («Unauthorized: Status code '401'»,
 * wrapped in «Failed to complete negotiation with the server: …»). Only negotiate surfaces the status, which is why
 * the connection never uses `skipNegotiation`.
 */
const UNAUTHORIZED_PATTERN = /Status code '(401|403)'/;

/**
 * True when an error means «not allowed» (expired session, blocked device, rotated output key) rather than «not
 * reachable». Such errors must stop every retry loop.
 */
export function isUnauthorizedError(error: unknown): boolean {
  if (typeof error === 'string') {
    return UNAUTHORIZED_PATTERN.test(error);
  }
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  if ('statusCode' in error && (error.statusCode === 401 || error.statusCode === 403)) {
    return true;
  }
  return (
    'message' in error &&
    typeof error.message === 'string' &&
    UNAUTHORIZED_PATTERN.test(error.message)
  );
}

/**
 * Automatic reconnect policy: retries forever with the shared backoff (0, 300, 600, 1200 … 5000 ms + jitter) and gives
 * up only for authorization failures, so `onclose` fires and the caller can show «Gesperrt» / «Kein Zugang».
 * The default SignalR policy gives up after about 42 s, which a live production must never do.
 */
export const hubRetryPolicy: IRetryPolicy = {
  nextRetryDelayInMilliseconds(context: RetryContext): number | null {
    return isUnauthorizedError(context.retryReason)
      ? null
      : backoffDelay(context.previousRetryCount);
  },
};

/**
 * Builds (does not start) a SignalR connection configured as spec 6 requires: JSON hub protocol (camelCase, string
 * enums), transport negotiated by SignalR (WebSockets first, falling back to SSE or long polling; never
 * `skipNegotiation`), 6 s server timeout, 2 s keep-alive and the endless {@link hubRetryPolicy}.
 * Log lines are redacted because SignalR logs WebSocket URLs including `access_token`.
 */
export function createHubConnection(options: HubConnectionOptions): HubConnection {
  const httpOptions: IHttpConnectionOptions = options.accessTokenFactory
    ? { accessTokenFactory: options.accessTokenFactory }
    : {};
  return new HubConnectionBuilder()
    .withUrl(options.url, httpOptions)
    .withHubProtocol(new JsonHubProtocol())
    .withServerTimeout(SERVER_TIMEOUT_MS)
    .withKeepAliveInterval(KEEP_ALIVE_INTERVAL_MS)
    .withAutomaticReconnect(hubRetryPolicy)
    .configureLogging(redactingLogger(options.logger ?? consoleLogger(LogLevel.Warning)))
    .build();
}
