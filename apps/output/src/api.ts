import type { LiveKitTokenDto, OutputReport } from '@studioflow/scene-model';

/**
 * REST calls of the output page (`ApiSurface.cs`, group `/api/output/{slug}`). The key travels only in the
 * `X-Output-Key` header (Caddy drops that header from its logs); no cookies are sent.
 */

/** A non-success HTTP answer that is worth retrying (5xx, 429, unexpected codes). */
export class HttpError extends Error {
  override readonly name = 'HttpError';

  constructor(readonly status: number) {
    super(`The API answered HTTP ${status}.`);
  }
}

/**
 * The API refused this link: 401/403 (wrong or rotated key, IP not allowed) or 404 (unknown slug). `status` is 403 in
 * every case because `MediaSession` stops retrying only for errors with a numeric `status` of 401 or 403;
 * `httpStatus` keeps the real code.
 */
export class AccessDeniedError extends Error {
  override readonly name = 'AccessDeniedError';
  readonly status = 403;

  constructor(readonly httpStatus: number) {
    super(`The API refused the output link (HTTP ${httpStatus}).`);
  }
}

/** True for answers that mean «this link does not work» rather than «the server has a problem». */
export function isAccessDeniedStatus(status: number): boolean {
  return status === 401 || status === 403 || status === 404;
}

/** REST client of one output link. */
export interface OutputApi {
  /** `POST /api/output/{slug}/livekit-token`. Rejects with {@link AccessDeniedError} or {@link HttpError}. */
  liveKitToken(): Promise<LiveKitTokenDto>;
  /** `POST /api/output/{slug}/report` (fallback while the hub is not connected). */
  report(report: OutputReport): Promise<void>;
}

/** Options of {@link createOutputApi}. */
export interface OutputApiOptions {
  readonly slug: string;
  readonly key: string;
  /** Default `globalThis.fetch`. */
  readonly fetch?: typeof fetch;
  /** Default `/api` (same origin; Caddy and the Vite dev server proxy it). */
  readonly apiBase?: string;
}

/** Upper bound of one REST call: a hanging request must not block the next report or attempt. */
export const REQUEST_TIMEOUT_MS = 10_000;

/** An abort signal that fires after `ms`, where the browser supports it. */
export function timeoutSignal(ms: number): AbortSignal | undefined {
  return typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(ms)
    : undefined;
}

function failure(status: number): Error {
  return isAccessDeniedStatus(status) ? new AccessDeniedError(status) : new HttpError(status);
}

/** Creates the REST client. */
export function createOutputApi(options: OutputApiOptions): OutputApi {
  const doFetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const base = `${options.apiBase ?? '/api'}/output/${encodeURIComponent(options.slug)}`;
  const headers = (extra: Record<string, string> = {}): Record<string, string> => ({
    'X-Output-Key': options.key,
    ...extra,
  });

  return {
    async liveKitToken(): Promise<LiveKitTokenDto> {
      const response = await doFetch(`${base}/livekit-token`, {
        method: 'POST',
        headers: headers({ Accept: 'application/json' }),
        credentials: 'omit',
        cache: 'no-store',
        signal: timeoutSignal(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) {
        throw failure(response.status);
      }
      return (await response.json()) as LiveKitTokenDto;
    },

    async report(report: OutputReport): Promise<void> {
      const response = await doFetch(`${base}/report`, {
        method: 'POST',
        headers: headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(report),
        credentials: 'omit',
        cache: 'no-store',
        keepalive: true,
        signal: timeoutSignal(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) {
        throw failure(response.status);
      }
    },
  };
}

/** Appends the key to an asset content URL (`?k=`, spec 4.7); the asset endpoint accepts it instead of a cookie. */
export function withOutputKey(contentUrl: string, key: string): string {
  const separator = contentUrl.includes('?') ? '&' : '?';
  return `${contentUrl}${separator}k=${encodeURIComponent(key)}`;
}
