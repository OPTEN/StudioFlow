import { HttpErrorResponse } from '@angular/common/http';
import { msg, tm, type MessageKey, type Msg, type PlainMessageKey } from '@studioflow/i18n';
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

/** Message key per error code (`errors.code.*`); the user never reads the server's own texts. */
export const ERROR_CODE_MESSAGES = {
  validation_failed: 'errors.code.validation_failed',
  not_found: 'errors.code.not_found',
  transition_running: 'errors.code.transition_running',
  scene_is_live: 'errors.code.scene_is_live',
  asset_in_use: 'errors.code.asset_in_use',
  unsupported_media: 'errors.code.unsupported_media',
  pairing_expired: 'errors.code.pairing_expired',
  rate_limited: 'errors.code.rate_limited',
  device_blocked: 'errors.code.device_blocked',
  conflict: 'errors.code.conflict',
  limit_reached: 'errors.code.limit_reached',
  unauthorized: 'errors.code.unauthorized',
  forbidden: 'errors.code.forbidden',
  request_timeout: 'errors.code.request_timeout',
  internal_error: 'errors.code.internal_error',
  service_unavailable: 'errors.code.service_unavailable',
  setup_code_invalid: 'errors.code.setup_code_invalid',
  setup_closed: 'errors.code.setup_closed',
  password_incorrect: 'errors.code.password_incorrect',
  network: 'errors.code.network',
  aborted: 'errors.code.aborted',
} as const satisfies Readonly<Record<ApiErrorCode | ClientErrorCode, MessageKey>>;

/** Message key per HTTP status, used when the body carries no known code. */
export const HTTP_STATUS_MESSAGES: Readonly<Record<number, PlainMessageKey>> = {
  0: ERROR_CODE_MESSAGES.network,
  400: ERROR_CODE_MESSAGES.validation_failed,
  401: ERROR_CODE_MESSAGES.unauthorized,
  403: ERROR_CODE_MESSAGES.forbidden,
  404: ERROR_CODE_MESSAGES.not_found,
  408: ERROR_CODE_MESSAGES.request_timeout,
  409: ERROR_CODE_MESSAGES.conflict,
  410: ERROR_CODE_MESSAGES.pairing_expired,
  413: 'errors.status.413',
  415: ERROR_CODE_MESSAGES.unsupported_media,
  429: ERROR_CODE_MESSAGES.rate_limited,
  500: ERROR_CODE_MESSAGES.internal_error,
  502: ERROR_CODE_MESSAGES.service_unavailable,
  503: ERROR_CODE_MESSAGES.service_unavailable,
  504: ERROR_CODE_MESSAGES.request_timeout,
};

const KNOWN_CODES: ReadonlySet<string> = new Set(Object.keys(ERROR_CODE_MESSAGES));

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
 * Title, detail and field errors are English diagnostics: the UI shows {@link toUserMessage} instead.
 */
export class ApiError extends Error {
  override readonly name = 'ApiError';
  /** HTTP status; 0 when the server could not be reached. */
  readonly status: number;
  /** Problem code (`ERROR_CODES` and `unauthorized`/`forbidden`/`internal_error`), `network`, `aborted` or null. */
  readonly code: ApiErrorCode | ClientErrorCode | null;
  /** Problem title as sent by the server (English, for diagnostics), or null. */
  readonly title: string | null;
  /** Problem detail as sent by the server (English, for diagnostics), or null. */
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

/**
 * Optional per-call texts that replace the generic ones, e.g. `{ conflict: msg('regie.scenes.error.conflict') }`
 * for a specific dialog. A plain string is shown as it is (it cannot follow a language switch).
 */
export type ErrorMessageOverrides = Partial<
  Record<ApiErrorCode | ClientErrorCode | `${number}`, string | Msg>
>;

/**
 * The message for any error as a {@link Msg}, which stays correct when the language changes while it is shown
 * (inline errors). Order: a rate limit with a known wait → the text of the code → the text of the HTTP status → a
 * generic text with the status number. The server's own texts are never used (D7).
 */
export function toUserMsg(error: unknown): Msg {
  const apiError = ApiError.from(error);
  const { code, status } = apiError;
  if (status === 413) {
    return msg('errors.status.413');
  }
  if (code === 'rate_limited' && apiError.retryAfterSeconds !== null) {
    return msg('errors.rateLimited.wait', { count: waitMinutes(apiError.retryAfterSeconds) });
  }
  if (code) {
    return msg(ERROR_CODE_MESSAGES[code]);
  }
  const byStatus = HTTP_STATUS_MESSAGES[status];
  return byStatus ? msg(byStatus) : msg('errors.status.unknown', { status });
}

/**
 * User-facing text for any error (toasts, one-shot messages). Order: caller overrides (by code, then by status) → the
 * server `detail` as a last resort for an unknown code without any text of its own → {@link toUserMsg}.
 */
export function toUserMessage(error: unknown, overrides: ErrorMessageOverrides = {}): string {
  const apiError = ApiError.from(error);
  const { code, status } = apiError;
  const override = (code ? overrides[code] : undefined) ?? overrides[`${status}`];
  if (override !== undefined) {
    return typeof override === 'string' ? override : tm(override);
  }
  if (code === null && apiError.detail !== null && HTTP_STATUS_MESSAGES[status] === undefined) {
    return apiError.detail;
  }
  return tm(toUserMsg(apiError));
}

/** Whole minutes to wait for a lockout of `seconds`, rounded up and at least one: 30 → 1, 61 → 2, 900 → 15. */
export function waitMinutes(seconds: number): number {
  return Math.max(1, Math.ceil(seconds / 60));
}
