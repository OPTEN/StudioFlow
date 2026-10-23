import { HttpErrorResponse } from '@angular/common/http';
import { t, tFor } from '@studioflow/i18n';
import { ERROR_CODES } from '@studioflow/scene-model';

/** Error codes the API may add beyond `ERROR_CODES` (spec 5, `ErrorCodes.cs`). */
export const EXTRA_ERROR_CODES = {
  unauthorized: 'unauthorized',
  forbidden: 'forbidden',
  internalError: 'internal_error',
} as const;

/**
 * Failure of an API call. `status` is the HTTP status, 0 when the server was not reachable (network error, timeout).
 * Carries a numeric `status`, so `MediaSession` recognises 401/403 token refusals.
 *
 * `message` is an English snapshot for logs and diagnostics. The text for the person using the device is
 * {@link userMessage}: it is built from the fields when it is read, so it follows the active language.
 */
export class ApiError extends Error {
  override readonly name = 'ApiError';

  constructor(
    readonly status: number,
    readonly code: string | null,
    message: string,
    readonly retryAfterSeconds: number | null = null,
    readonly fieldErrors: Readonly<Record<string, readonly string[]>> = {},
    /** The request timed out (status 0 as well); only changes the wording of {@link userMessage}. */
    readonly timedOut = false,
  ) {
    super(message);
  }

  /** The text for the person using the device, in the active language. Read it when showing it. */
  get userMessage(): string {
    return describeFailure(t, this);
  }

  /** The server was not reachable (no HTTP answer). */
  get isNetwork(): boolean {
    return this.status === 0;
  }

  /** Worth retrying automatically: no answer, a server error or a gateway problem. */
  get isTransient(): boolean {
    return this.status === 0 || this.status === 408 || this.status >= 500;
  }

  /**
   * The server is up but cannot serve right now (503 `service_unavailable`, e.g. a short database outage, or a
   * gateway error while the API restarts): retry calmly, never show an error screen for it.
   */
  get isUnavailable(): boolean {
    return (
      this.code === ERROR_CODES.serviceUnavailable ||
      this.status === 502 ||
      this.status === 503 ||
      this.status === 504
    );
  }

  /** The device credentials are unknown or wrong (removed by the Regie). */
  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  /** The device is blocked by the Regie. */
  get isBlocked(): boolean {
    return this.status === 403 && (this.code === ERROR_CODES.deviceBlocked || this.code === null);
  }
}

/** "Please try again in 40 seconds / 3 minutes", or "later" when the wait is unknown. */
function rateLimitedMessage(translate: typeof t, seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) {
    return translate('errors.device.rateLimitedLater');
  }
  if (seconds < 60) {
    return translate('errors.device.rateLimitedSeconds', {
      count: Math.max(1, Math.round(seconds)),
    });
  }
  return translate('errors.device.rateLimitedMinutes', { count: Math.ceil(seconds / 60) });
}

/** The message for a failure, by code first, then by HTTP status. The server's own texts are never used (D7). */
function describeFailure(
  translate: typeof t,
  failure: Pick<ApiError, 'status' | 'code' | 'retryAfterSeconds' | 'timedOut'>,
): string {
  const { status, code, retryAfterSeconds } = failure;
  switch (code) {
    case ERROR_CODES.deviceBlocked:
      return translate('errors.device.blocked');
    case ERROR_CODES.pairingExpired:
      return translate('errors.device.expired');
    case ERROR_CODES.rateLimited:
      return rateLimitedMessage(translate, retryAfterSeconds);
    case ERROR_CODES.limitReached:
      return translate('errors.device.limit');
    case ERROR_CODES.validationFailed:
      return translate('errors.device.invalid');
    case ERROR_CODES.serviceUnavailable:
      return translate('errors.device.unavailable');
    default:
      break;
  }
  switch (status) {
    case 0:
      return translate(failure.timedOut ? 'errors.device.timeout' : 'errors.device.network');
    case 401:
      return translate('errors.device.unauthorized');
    case 403:
      return translate('errors.device.forbidden');
    case 404:
      return translate('errors.device.notFound');
    case 409:
      return translate('errors.device.conflict');
    case 410:
      return translate('errors.device.expired');
    case 413:
    case 415:
      return translate('errors.device.tooLarge');
    case 429:
      return rateLimitedMessage(translate, retryAfterSeconds);
    case 400:
    case 422:
      return translate('errors.device.invalid');
    case 502:
    case 503:
    case 504:
      return translate('errors.device.unavailable');
    default:
      return translate('errors.device.server');
  }
}

/** Parses `Retry-After` (seconds or HTTP date) into seconds. */
export function parseRetryAfter(value: string | null, nowMs: number = Date.now()): number | null {
  if (value === null || value.trim() === '') {
    return null;
  }
  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds);
  }
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, Math.round((date - nowMs) / 1000));
}

interface ProblemBody {
  readonly code?: unknown;
  readonly detail?: unknown;
  readonly title?: unknown;
  readonly errors?: unknown;
}

function problemOf(body: unknown): ProblemBody {
  if (typeof body === 'string') {
    try {
      return problemOf(JSON.parse(body));
    } catch {
      return {};
    }
  }
  return typeof body === 'object' && body !== null ? (body as ProblemBody) : {};
}

function fieldErrorsOf(errors: unknown): Record<string, readonly string[]> {
  if (typeof errors !== 'object' || errors === null) {
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

/** Converts anything thrown by HttpClient (or a timeout) into an {@link ApiError}. */
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error;
  }
  const english = tFor('en');
  if (error instanceof HttpErrorResponse) {
    const problem = problemOf(error.error);
    const code = typeof problem.code === 'string' ? problem.code : null;
    const retryAfter =
      error.status === 0 ? null : parseRetryAfter(error.headers?.get('Retry-After') ?? null);
    const message = describeFailure(english, {
      status: error.status,
      code,
      retryAfterSeconds: retryAfter,
      timedOut: false,
    });
    return new ApiError(error.status, code, message, retryAfter, fieldErrorsOf(problem.errors));
  }
  const timedOut = error instanceof Error && error.name === 'TimeoutError';
  const message = describeFailure(english, {
    status: 0,
    code: null,
    retryAfterSeconds: null,
    timedOut,
  });
  return new ApiError(0, null, message, null, {}, timedOut);
}
