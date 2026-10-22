import { HttpErrorResponse } from '@angular/common/http';
import { ERROR_CODES } from '@flowstudio/scene-model';

/** Error codes the API may add beyond `ERROR_CODES` (spec 5, `ErrorCodes.cs`). */
export const EXTRA_ERROR_CODES = {
  unauthorized: 'unauthorized',
  forbidden: 'forbidden',
  internalError: 'internal_error',
} as const;

/**
 * Failure of an API call with a German message for the UI. `status` is the HTTP status, 0 when the server was not
 * reachable (network error, timeout). Carries a numeric `status`, so `MediaSession` recognises 401/403 token refusals.
 */
export class ApiError extends Error {
  override readonly name = 'ApiError';

  constructor(
    readonly status: number,
    readonly code: string | null,
    message: string,
    readonly retryAfterSeconds: number | null = null,
    readonly fieldErrors: Readonly<Record<string, readonly string[]>> = {},
  ) {
    super(message);
  }

  /** The server was not reachable (no HTTP answer). */
  get isNetwork(): boolean {
    return this.status === 0;
  }

  /** Worth retrying automatically: no answer, a server error or a gateway problem. */
  get isTransient(): boolean {
    return this.status === 0 || this.status === 408 || this.status >= 500;
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

/** German default messages. */
export const API_MESSAGES = {
  network: 'Der Server ist nicht erreichbar. Bitte WLAN prüfen.',
  timeout: 'Der Server antwortet nicht. Bitte WLAN prüfen.',
  unauthorized: 'Dieses Gerät ist nicht mehr gekoppelt.',
  blocked: 'Dieses Gerät ist gesperrt. Die Regie kann es wieder freigeben.',
  forbidden: 'Kein Zugriff.',
  notFound: 'Nicht gefunden.',
  expired: 'Diese Einladung ist abgelaufen oder wurde schon verwendet.',
  conflict: 'Das geht gerade nicht.',
  limit: 'Die Grenze ist erreicht.',
  invalid: 'Die Eingabe ist ungültig.',
  tooLarge: 'Die Daten sind zu gross.',
  server: 'Der Server hat einen Fehler gemeldet. Bitte gleich noch einmal versuchen.',
} as const;

/** «in 40 Sekunden» / «in 3 Minuten» for a Retry-After value. */
export function formatRetryAfter(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) {
    return 'später';
  }
  if (seconds < 60) {
    const rounded = Math.max(1, Math.round(seconds));
    return `in ${rounded} ${rounded === 1 ? 'Sekunde' : 'Sekunden'}`;
  }
  const minutes = Math.ceil(seconds / 60);
  return `in ${minutes} ${minutes === 1 ? 'Minute' : 'Minuten'}`;
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

function messageFor(
  status: number,
  code: string | null,
  detail: string | null,
  retryAfter: number | null,
  fieldErrors: Record<string, readonly string[]>,
): string {
  switch (code) {
    case ERROR_CODES.deviceBlocked:
      return API_MESSAGES.blocked;
    case ERROR_CODES.pairingExpired:
      return API_MESSAGES.expired;
    case ERROR_CODES.rateLimited:
      return `Zu viele Versuche. Bitte ${formatRetryAfter(retryAfter)} noch einmal versuchen.`;
    case ERROR_CODES.limitReached:
      return detail ?? API_MESSAGES.limit;
    case ERROR_CODES.validationFailed:
      return Object.values(fieldErrors).flat()[0] ?? detail ?? API_MESSAGES.invalid;
    default:
      break;
  }
  if (status === 401) {
    return API_MESSAGES.unauthorized;
  }
  if (status === 403) {
    return API_MESSAGES.forbidden;
  }
  if (status === 404) {
    return detail ?? API_MESSAGES.notFound;
  }
  if (status === 409) {
    return detail ?? API_MESSAGES.conflict;
  }
  if (status === 410) {
    return API_MESSAGES.expired;
  }
  if (status === 413 || status === 415) {
    return API_MESSAGES.tooLarge;
  }
  if (status === 429) {
    return `Zu viele Versuche. Bitte ${formatRetryAfter(retryAfter)} noch einmal versuchen.`;
  }
  if (status === 400 || status === 422) {
    return Object.values(fieldErrors).flat()[0] ?? detail ?? API_MESSAGES.invalid;
  }
  return API_MESSAGES.server;
}

/** Converts anything thrown by HttpClient (or a timeout) into an {@link ApiError}. */
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error;
  }
  if (error instanceof HttpErrorResponse) {
    if (error.status === 0) {
      return new ApiError(0, null, API_MESSAGES.network);
    }
    const problem = problemOf(error.error);
    const code = typeof problem.code === 'string' ? problem.code : null;
    const detail =
      typeof problem.detail === 'string' && problem.detail !== '' ? problem.detail : null;
    const retryAfter = parseRetryAfter(error.headers?.get('Retry-After') ?? null);
    const fieldErrors = fieldErrorsOf(problem.errors);
    return new ApiError(
      error.status,
      code,
      messageFor(error.status, code, detail, retryAfter, fieldErrors),
      retryAfter,
      fieldErrors,
    );
  }
  if (error instanceof Error && error.name === 'TimeoutError') {
    return new ApiError(0, null, API_MESSAGES.timeout);
  }
  return new ApiError(0, null, API_MESSAGES.network);
}
