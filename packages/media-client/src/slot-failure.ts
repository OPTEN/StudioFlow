/**
 * Why a publisher slot failed (or a screen share was cancelled): a stable code for program logic and a message key for
 * people. Free of livekit-client, so UIs can use the codes without loading the SDK.
 */
import type { MessageKey } from '@studioflow/i18n';

/**
 * Stable cause of a `failed` slot or a cancelled share, reported with its message key by `Publisher.onSlotState`:
 * - `permission-denied`: camera access refused (by the user, the browser settings or a policy);
 * - `in-use`: the camera is busy or did not start (another app, a call), also after three retries;
 * - `not-found`: no camera, or none that matches the requested settings;
 * - `not-supported`: this browser cannot share a screen;
 * - `needs-gesture`: the share was not started directly from a click;
 * - `cancelled`: the screen picker was closed without choosing anything (slot `idle` or back to `ended`);
 * - `track-lost`: the camera stopped delivering frames and could not be re-acquired;
 * - `publish-failed`: the picture could not be sent to the server;
 * - `unknown`: anything else.
 */
export type SlotFailure =
  | 'permission-denied'
  | 'in-use'
  | 'not-found'
  | 'not-supported'
  | 'needs-gesture'
  | 'cancelled'
  | 'track-lost'
  | 'publish-failed'
  | 'unknown';

/**
 * Message keys of a slot: one per {@link SlotFailure} (`media.slot.failure.<code>`) plus the two messages without a
 * failure code. None of them has a parameter, so `t(key)` resolves any of them.
 */
export type SlotMessageKey = Extract<MessageKey, `media.slot.${string}`>;

/** A failure code with the key of its message. */
export interface SlotProblem {
  readonly failure: SlotFailure;
  readonly messageKey: SlotMessageKey;
}

function problemOf(failure: SlotFailure): SlotProblem {
  return { failure, messageKey: `media.slot.failure.${failure}` };
}

/** Problems that do not depend on a browser error. */
export const SLOT_PROBLEMS = {
  cameraLost: problemOf('track-lost'),
  publishFailed: problemOf('publish-failed'),
  shareCancelled: problemOf('cancelled'),
} as const satisfies Readonly<Record<string, SlotProblem>>;

/** DOMException / Error name, '' for non-errors. */
export function errorName(error: unknown): string {
  return error instanceof Error ? error.name : '';
}

/** True when the user (or a policy) refused a capture, e.g. cancelled the screen picker. */
export function isPermissionRefusal(error: unknown): boolean {
  return errorName(error) === 'NotAllowedError';
}

/** Whether a camera error may go away by retrying (busy device) and how to explain it. */
export function describeCameraFailure(
  error: unknown,
): SlotProblem & { readonly transient: boolean } {
  switch (errorName(error)) {
    case 'NotAllowedError':
    case 'SecurityError':
      return { transient: false, ...problemOf('permission-denied') };
    case 'NotFoundError':
    case 'OverconstrainedError':
    case 'DeviceUnsupportedError':
      return { transient: false, ...problemOf('not-found') };
    default:
      return { transient: true, ...problemOf('in-use') };
  }
}

/** Explanation of a failed screen capture (other than a cancelled picker). */
export function describeScreenFailure(error: unknown): SlotProblem {
  switch (errorName(error)) {
    case 'DeviceUnsupportedError':
    case 'TypeError':
      return problemOf('not-supported');
    case 'InvalidStateError':
      return problemOf('needs-gesture');
    default:
      return problemOf('unknown');
  }
}
