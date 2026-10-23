/**
 * Error codes of failed hub invocations. The API turns use case errors into `HubException("{code}: {message}")`
 * (`HubErrorFilter`, e.g. «service_unavailable: Die Datenbank ist gerade nicht erreichbar.»); the SignalR client
 * rejects the invocation with an `Error` whose message is
 * «An unexpected error occurred invoking 'Subscribe' on the server. HubException: not_found: …».
 */

/** `{code}:` at the start of the server message, or right after SignalR's «HubException: » prefix. */
const HUB_ERROR_CODE = /(?:^|HubException: )([a-z][a-z0-9_]*):/;

/**
 * The StudioFlow error code (`ERROR_CODES`: `not_found`, `device_blocked`, `service_unavailable` …) of a rejected
 * hub invocation, or null for anything else (connection loss, timeouts, unexpected values).
 */
export function hubErrorCode(error: unknown): string | null {
  const message = messageOf(error);
  return message === null ? null : (HUB_ERROR_CODE.exec(message)?.[1] ?? null);
}

function messageOf(error: unknown): string | null {
  if (typeof error === 'string') {
    return error;
  }
  return typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string'
    ? error.message
    : null;
}
