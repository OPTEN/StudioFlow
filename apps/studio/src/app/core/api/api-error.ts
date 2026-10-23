import { HttpErrorResponse } from '@angular/common/http';
import { ERROR_CODES, type ErrorCode } from '@studioflow/scene-model';

/**
 * Error codes the API may put into `ProblemDetails.code` (spec 5): the shared `ERROR_CODES`, which include the
 * generic codes for 401, 403, 408 and 500.
 */
export const API_ERROR_CODES = ERROR_CODES;

/**
 * A machine readable API error code. Every code needs a text in {@link ERROR_CODE_MESSAGES}; the compiler enforces
 * that when the contract gains a code.
 */
export type ApiErrorCode = ErrorCode | 'unauthorized' | 'forbidden' | 'internal_error';

/**
 * Client-side failure kinds that never come from the server: `network` (no answer, status 0) and `aborted`
 * (the caller cancelled, e.g. an upload).
 */
export type ClientErrorCode = 'network' | 'aborted';

/** RFC 7807 problem body with the StudioFlow extensions `code` and (for validation) `errors`. */
export interface ProblemBody {
  readonly type?: string | null;
  readonly title?: string | null;
  readonly status?: number | null;
  readonly detail?: string | null;
  readonly code?: string | null;
  readonly errors?: Readonly<Record<string, readonly string[]>> | null;
}

/** German texts per error code (Swiss spelling). Used by {@link toGermanMessage}. */
export const ERROR_CODE_MESSAGES: Readonly<Record<ApiErrorCode | ClientErrorCode, string>> = {
  validation_failed: 'Die Eingabe ist ungültig.',
  not_found: 'Das gibt es nicht mehr. Vielleicht wurde es inzwischen gelöscht.',
  transition_running: 'Eine Blende läuft noch. Bitte kurz warten.',
  scene_is_live: 'Die Live-Szene lässt sich nicht löschen.',
  asset_in_use: 'Die Datei wird noch verwendet und lässt sich nicht löschen.',
  unsupported_media:
    'Dieser Dateityp ist nicht erlaubt. Erlaubt sind PNG, JPEG, WebP, MP4 und WebM.',
  pairing_expired: 'Die Anfrage ist abgelaufen oder wurde schon beantwortet.',
  rate_limited: 'Zu viele Versuche. Bitte später erneut versuchen.',
  device_blocked: 'Das Gerät ist gesperrt.',
  conflict: 'Das geht gerade nicht, weil sich der Zustand geändert hat.',
  limit_reached: 'Die Obergrenze ist erreicht.',
  unauthorized: 'Die Anmeldung ist abgelaufen. Bitte neu anmelden.',
  forbidden: 'Dafür fehlt die Berechtigung.',
  request_timeout: 'Der Server hat nicht rechtzeitig geantwortet. Bitte nochmals versuchen.',
  internal_error: 'Auf dem Server ist ein Fehler aufgetreten. Bitte nochmals versuchen.',
  service_unavailable: 'Der Server ist gerade nicht erreichbar. Bitte gleich nochmals versuchen.',
  network: 'Keine Verbindung zum Server. Bitte nochmals versuchen.',
  aborted: 'Abgebrochen.',
};

/** German texts per HTTP status, used when the body carries no known code. */
export const HTTP_STATUS_MESSAGES: Readonly<Record<number, string>> = {
  0: ERROR_CODE_MESSAGES.network,
  400: ERROR_CODE_MESSAGES.validation_failed,
  401: ERROR_CODE_MESSAGES.unauthorized,
  403: ERROR_CODE_MESSAGES.forbidden,
  404: ERROR_CODE_MESSAGES.not_found,
  408: ERROR_CODE_MESSAGES.request_timeout,
  409: ERROR_CODE_MESSAGES.conflict,
  410: ERROR_CODE_MESSAGES.pairing_expired,
  413: 'Die Datei ist zu gross. Bilder dürfen höchstens 25 MB, Videos höchstens 1 GB gross sein.',
  415: ERROR_CODE_MESSAGES.unsupported_media,
  429: ERROR_CODE_MESSAGES.rate_limited,
  500: ERROR_CODE_MESSAGES.internal_error,
  502: 'Der Server ist gerade nicht erreichbar. Bitte gleich nochmals versuchen.',
  503: 'Der Server ist gerade nicht erreichbar. Bitte gleich nochmals versuchen.',
  504: 'Der Server hat nicht rechtzeitig geantwortet. Bitte nochmals versuchen.',
};

const KNOWN_CODES: ReadonlySet<string> = new Set(Object.keys(ERROR_CODE_MESSAGES));

/** Codes whose server `detail` is more specific than the generic text (e.g. which limit was reached). */
const DETAIL_PREFERRED: ReadonlySet<string> = new Set([
  'validation_failed',
  'limit_reached',
  'conflict',
]);

function isProblemBody(value: unknown): value is ProblemBody {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseBody(body: unknown): ProblemBody | null {
  if (isProblemBody(body)) {
    return body;
  }
  if (typeof body === 'string' && body.trim().startsWith('{')) {
    try {
      const parsed: unknown = JSON.parse(body);
      return isProblemBody(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

/** Seconds from a `Retry-After` header (delta seconds or HTTP date); null when absent or unparsable. */
export function parseRetryAfter(
  value: string | null | undefined,
  nowMs = Date.now(),
): number | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed);
  }
  const date = Date.parse(trimmed);
  return Number.isNaN(date) ? null : Math.max(0, Math.ceil((date - nowMs) / 1000));
}

function normalizeFieldErrors(
  errors: ProblemBody['errors'],
): Readonly<Record<string, readonly string[]>> {
  if (!errors || typeof errors !== 'object') {
    return {};
  }
  const result: Record<string, readonly string[]> = {};
  for (const [field, messages] of Object.entries(errors)) {
    if (Array.isArray(messages)) {
      result[field] = messages.filter((message): message is string => typeof message === 'string');
    }
  }
  return result;
}

/**
 * Error of a REST call: HTTP status (0 = no answer), the StudioFlow `code`, title/detail of the problem body, field
 * errors of a validation problem and `Retry-After`. Every `StudioApiService` method rejects with an `ApiError`.
 * The numeric `status` also lets `MediaSession` recognise 401/403 from the token provider.
 */
export class ApiError extends Error {
  override readonly name = 'ApiError';
  /** HTTP status; 0 when the server could not be reached. */
  readonly status: number;
  /** Problem code (`ERROR_CODES` and `unauthorized`/`forbidden`/`internal_error`), `network`, `aborted` or null. */
  readonly code: ApiErrorCode | ClientErrorCode | null;
  /** Problem title as sent by the server (German), or null. */
  readonly title: string | null;
  /** Problem detail as sent by the server (German), or null. */
  readonly detail: string | null;
  /** Validation messages per field (camelCase field names as sent by the server). */
  readonly fieldErrors: Readonly<Record<string, readonly string[]>>;
  /** Seconds from `Retry-After` (429 lockout), or null. */
  readonly retryAfterSeconds: number | null;

  constructor(init: {
    status: number;
    code?: string | null;
    title?: string | null;
    detail?: string | null;
    fieldErrors?: Readonly<Record<string, readonly string[]>>;
    retryAfterSeconds?: number | null;
  }) {
    super(init.detail ?? init.title ?? `HTTP ${init.status}`);
    this.status = init.status;
    this.code =
      init.code && KNOWN_CODES.has(init.code)
        ? (init.code as ApiErrorCode | ClientErrorCode)
        : null;
    this.title = init.title ?? null;
    this.detail = init.detail ?? null;
    this.fieldErrors = init.fieldErrors ?? {};
    this.retryAfterSeconds = init.retryAfterSeconds ?? null;
  }

  /** True when the error carries `code`. */
  is(code: ApiErrorCode | ClientErrorCode): boolean {
    return this.code === code;
  }

  /** First validation message of any field, or null. */
  get firstFieldError(): string | null {
    for (const messages of Object.values(this.fieldErrors)) {
      if (messages.length > 0) {
        return messages[0];
      }
    }
    return null;
  }

  /** Builds an ApiError from an Angular `HttpErrorResponse`. */
  static fromHttpError(error: HttpErrorResponse): ApiError {
    const body = parseBody(error.error);
    return new ApiError({
      status: error.status,
      code: body?.code ?? (error.status === 0 ? 'network' : null),
      title: body?.title ?? null,
      detail: body?.detail ?? null,
      fieldErrors: normalizeFieldErrors(body?.errors),
      retryAfterSeconds: parseRetryAfter(error.headers?.get('Retry-After')),
    });
  }

  /** Builds an ApiError from a raw status, body text and `Retry-After` value (XHR uploads). */
  static fromResponse(status: number, bodyText: string, retryAfter: string | null): ApiError {
    const body = parseBody(bodyText);
    return new ApiError({
      status,
      code: body?.code ?? (status === 0 ? 'network' : null),
      title: body?.title ?? null,
      detail: body?.detail ?? null,
      fieldErrors: normalizeFieldErrors(body?.errors),
      retryAfterSeconds: parseRetryAfter(retryAfter),
    });
  }

  /** Converts anything thrown by HttpClient, fetch or XHR into an ApiError (unknown errors count as `network`). */
  static from(error: unknown): ApiError {
    if (error instanceof ApiError) {
      return error;
    }
    if (error instanceof HttpErrorResponse) {
      return ApiError.fromHttpError(error);
    }
    if (error instanceof DOMException && error.name === 'AbortError') {
      return new ApiError({ status: 0, code: 'aborted' });
    }
    return new ApiError({ status: 0, code: 'network' });
  }
}

/** Optional per-call texts that replace the generic ones, e.g. `{ conflict: '…' }` for a specific dialog. */
export type ErrorMessageOverrides = Partial<
  Record<ApiErrorCode | ClientErrorCode | `${number}`, string>
>;

/**
 * German, user-facing message for any error (toasts, inline errors). Order: caller overrides (by code, then by
 * status) → server detail for codes where it is more specific (validation, limits, conflicts) → the text of the code
 * → the text of the HTTP status → a generic text with the status number.
 */
export function toGermanMessage(error: unknown, overrides: ErrorMessageOverrides = {}): string {
  const apiError = ApiError.from(error);
  const { code, status } = apiError;
  if (code && overrides[code]) {
    return overrides[code];
  }
  const byStatus = overrides[`${status}`];
  if (byStatus) {
    return byStatus;
  }
  if (code === 'validation_failed' && apiError.firstFieldError) {
    return apiError.firstFieldError;
  }
  if (code && DETAIL_PREFERRED.has(code) && apiError.detail) {
    return apiError.detail;
  }
  if (status === 413) {
    return HTTP_STATUS_MESSAGES[413];
  }
  if (code === 'rate_limited' && apiError.retryAfterSeconds !== null) {
    return `Zu viele Versuche. Bitte in ${minutesText(apiError.retryAfterSeconds)} erneut versuchen.`;
  }
  if (code) {
    return ERROR_CODE_MESSAGES[code];
  }
  return HTTP_STATUS_MESSAGES[status] ?? `Das hat nicht geklappt (Fehler ${status}).`;
}

/** «1 Minute», «15 Minuten» for a wait in seconds (rounded up to whole minutes, at least one). */
export function minutesText(seconds: number): string {
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return minutes === 1 ? '1 Minute' : `${minutes} Minuten`;
}
