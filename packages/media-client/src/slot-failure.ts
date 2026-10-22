/**
 * Why a publisher slot failed (or a screen share was cancelled): a stable code for program logic and a German message
 * for people. Free of livekit-client, so UIs can use the codes without loading the SDK.
 */

/**
 * Stable cause of a `failed` slot or a cancelled share, reported with the German message by `Publisher.onSlotState`:
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

/** A failure code with its German message. */
export interface SlotProblem {
  readonly failure: SlotFailure;
  readonly message: string;
}

/** German slot messages shown by the sender. */
export const SLOT_MESSAGES = {
  cameraDenied: 'Kein Zugriff auf die Kamera. Bitte den Zugriff im Browser erlauben.',
  cameraMissing: 'Keine Kamera gefunden.',
  cameraBusy: 'Die Kamera ist nicht verfügbar. Wird sie von einer anderen App verwendet?',
  cameraLost: 'Die Kamera liefert kein Bild mehr.',
  cameraSwitchFailed: 'Kamerawechsel fehlgeschlagen.',
  publishFailed: 'Das Bild konnte nicht gesendet werden.',
  shareCancelled: 'Freigabe abgebrochen',
  shareEnded: 'Freigabe beendet',
  shareUnsupported: 'Dieser Browser kann den Bildschirm nicht teilen.',
  shareNeedsClick: 'Bitte die Freigabe direkt per Klick starten.',
  shareFailed: 'Der Bildschirm konnte nicht geteilt werden.',
} as const;

/** Problems that do not depend on a browser error. */
export const SLOT_PROBLEMS = {
  cameraLost: { failure: 'track-lost', message: SLOT_MESSAGES.cameraLost },
  publishFailed: { failure: 'publish-failed', message: SLOT_MESSAGES.publishFailed },
  shareCancelled: { failure: 'cancelled', message: SLOT_MESSAGES.shareCancelled },
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
      return {
        transient: false,
        failure: 'permission-denied',
        message: SLOT_MESSAGES.cameraDenied,
      };
    case 'NotFoundError':
    case 'OverconstrainedError':
    case 'DeviceUnsupportedError':
      return { transient: false, failure: 'not-found', message: SLOT_MESSAGES.cameraMissing };
    default:
      return { transient: true, failure: 'in-use', message: SLOT_MESSAGES.cameraBusy };
  }
}

/** Explanation of a failed screen capture (other than a cancelled picker). */
export function describeScreenFailure(error: unknown): SlotProblem {
  switch (errorName(error)) {
    case 'DeviceUnsupportedError':
    case 'TypeError':
      return { failure: 'not-supported', message: SLOT_MESSAGES.shareUnsupported };
    case 'InvalidStateError':
      return { failure: 'needs-gesture', message: SLOT_MESSAGES.shareNeedsClick };
    default:
      return { failure: 'unknown', message: SLOT_MESSAGES.shareFailed };
  }
}
