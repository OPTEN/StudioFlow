/**
 * Classification of LiveKit disconnects and token errors for {@link MediaSession} (spec sections 7 and 8.4).
 */
import { DisconnectReason } from 'livekit-client';

/** What the session does after its room disconnected without a stop requested by the session itself. */
export type DisconnectOutcome = 'rejoin' | 'replaced' | 'removed';

/**
 * Maps a `RoomEvent.Disconnected` reason to the session's reaction.
 *
 * - DUPLICATE_IDENTITY: another tab or device took over the identity → «replaced», never reconnect (no ping-pong).
 * - PARTICIPANT_REMOVED / ROOM_DELETED: the server removed us (blocked device, rotated output key) → «removed».
 * - Everything else rejoins with a fresh token and a new `Room`: `undefined` (the SDK gave up), JOIN_FAILURE,
 *   STATE_MISMATCH, SIGNAL_CLOSE, CONNECTION_TIMEOUT, MEDIA_FAILURE, SERVER_SHUTDOWN, UNKNOWN_REASON, and
 *   CLIENT_INITIATED – the session detaches before its own `disconnect()`, so a CLIENT_INITIATED it observes comes from
 *   the SDK's page-lifecycle handling (`pagehide`, `beforeunload`, Chromium `freeze`).
 */
export function disconnectOutcome(reason: DisconnectReason | undefined): DisconnectOutcome {
  switch (reason) {
    case DisconnectReason.DUPLICATE_IDENTITY:
      return 'replaced';
    case DisconnectReason.PARTICIPANT_REMOVED:
    case DisconnectReason.ROOM_DELETED:
      return 'removed';
    default:
      return 'rejoin';
  }
}

/** Human-readable name of a disconnect reason for logs (`gave-up` for undefined). */
export function disconnectReasonName(reason: DisconnectReason | undefined): string {
  return reason === undefined ? 'gave-up' : (DisconnectReason[reason] ?? `reason-${reason}`);
}

/**
 * True when a token provider failed with HTTP 401 or 403 (expired admin session, blocked device, rotated output key).
 * Works with Angular's `HttpErrorResponse`, fetch wrappers and any error object exposing a numeric `status`.
 */
export function isAuthorizationError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('status' in error)) {
    return false;
  }
  return error.status === 401 || error.status === 403;
}
