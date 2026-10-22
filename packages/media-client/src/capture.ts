/**
 * Default camera / screen capture of the {@link Publisher} and the German explanations of capture failures.
 */
import {
  LocalVideoTrack,
  createLocalScreenTracks,
  createLocalVideoTrack,
  type ScreenShareCaptureOptions,
  type VideoCaptureOptions,
} from 'livekit-client';

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

/** Camera capture with livekit's `createLocalVideoTrack` (the SDK then restarts an ended camera by itself). */
export function captureCamera(options: VideoCaptureOptions): Promise<LocalVideoTrack> {
  return createLocalVideoTrack(options);
}

/**
 * Screen capture with the standalone `createLocalScreenTracks` instead of `room.localParticipant.createScreenTracks`:
 * both run the same getDisplayMedia code, but the standalone one needs no room, so a share can start while the
 * session is rejoining. Its only difference – it ignores `contentHint` – is compensated by the publisher setting the
 * hint itself. getDisplayMedia is called synchronously (no await before it), preserving the user gesture.
 */
export async function captureScreen(options: ScreenShareCaptureOptions): Promise<LocalVideoTrack> {
  const tracks = await createLocalScreenTracks(options);
  const video = tracks.find((track): track is LocalVideoTrack => track instanceof LocalVideoTrack);
  for (const track of tracks) {
    if (track !== video) {
      track.stop();
    }
  }
  if (video === undefined) {
    throw new Error('getDisplayMedia returned no video track');
  }
  return video;
}

/** Sets the encoder content hint; unsupported in Firefox, where it is silently skipped. */
export function setContentHint(track: MediaStreamTrack, hint: 'motion' | 'detail'): void {
  try {
    track.contentHint = hint;
  } catch {
    // Only an encoder hint: nothing to do where the browser rejects it.
  }
}

/** DOMException / Error name, '' for non-errors. */
export function errorName(error: unknown): string {
  return error instanceof Error ? error.name : '';
}

/** True when the user (or a policy) refused a capture, e.g. cancelled the screen picker. */
export function isPermissionRefusal(error: unknown): boolean {
  return errorName(error) === 'NotAllowedError';
}

/** Whether a camera error may go away by retrying (busy device) and how to explain it. */
export function describeCameraFailure(error: unknown): {
  readonly transient: boolean;
  readonly message: string;
} {
  switch (errorName(error)) {
    case 'NotAllowedError':
    case 'SecurityError':
      return { transient: false, message: SLOT_MESSAGES.cameraDenied };
    case 'NotFoundError':
    case 'OverconstrainedError':
    case 'DeviceUnsupportedError':
      return { transient: false, message: SLOT_MESSAGES.cameraMissing };
    default:
      return { transient: true, message: SLOT_MESSAGES.cameraBusy };
  }
}

/** Explanation of a failed screen capture (other than a cancelled picker). */
export function describeScreenFailure(error: unknown): string {
  switch (errorName(error)) {
    case 'DeviceUnsupportedError':
    case 'TypeError':
      return SLOT_MESSAGES.shareUnsupported;
    case 'InvalidStateError':
      return SLOT_MESSAGES.shareNeedsClick;
    default:
      return SLOT_MESSAGES.shareFailed;
  }
}
