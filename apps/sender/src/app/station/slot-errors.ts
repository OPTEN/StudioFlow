import { msg, tm, type Msg } from '@studioflow/i18n';
import { ERROR_CODES, LIMITS } from '@studioflow/scene-model';
import { ApiError, toApiError } from '../core/api-error';

/**
 * The error of a refused user action as the station keeps it: a message of the `sender.station.error.*` catalogue, or
 * the {@link ApiError} for the general cases. Both are turned into text when they are shown ({@link actionErrorText}),
 * so an error on screen follows a language switch.
 */
export type ActionError = Msg | ApiError;

/** The text of an {@link ActionError} in the active language. */
export function actionErrorText(error: ActionError): string {
  return error instanceof ApiError ? error.userMessage : tm(error);
}

/** Messages for the refused slot requests of a station (GAP-05, GAP-19). */
export const SLOT_ERRORS = {
  phoneScreen: msg('sender.station.error.phoneScreen'),
  screenLimit: msg('sender.station.error.screenLimit', { max: LIMITS.screensPerDevice }),
  cameraLimit: msg('sender.station.error.cameraLimit'),
  phoneCamera: msg('sender.station.error.phoneCamera'),
  micLimit: msg('sender.audio.error.micLimit'),
} as const satisfies Readonly<Record<string, Msg>>;

/**
 * Error for a failed `POST /api/device/slots`: 400 when a phone asks for a screen, 409 `limit_reached` for the
 * tenth screen or a second camera, otherwise the general API message (e.g. “The server is not reachable right now”).
 */
export function allocateSlotError(
  error: unknown,
  kind: 'camera' | 'screen' | 'audio',
): ActionError {
  const apiError = toApiError(error);
  if (apiError.status === 400 && kind === 'screen') {
    return SLOT_ERRORS.phoneScreen;
  }
  if (apiError.status === 409 && apiError.code === ERROR_CODES.limitReached) {
    if (kind === 'audio') {
      return SLOT_ERRORS.micLimit;
    }
    return kind === 'screen' ? SLOT_ERRORS.screenLimit : SLOT_ERRORS.cameraLimit;
  }
  return apiError;
}

/**
 * Error for a failed `DELETE /api/device/slots/{slot}` (409 `conflict`: a phone's only camera cannot be removed),
 * or null for 404: the slot does not exist on the server any more (removed in another tab), so the goal is reached.
 */
export function releaseSlotError(error: unknown, slot: string): ActionError | null {
  const apiError = toApiError(error);
  if (apiError.status === 404) {
    return null;
  }
  if (apiError.status === 409 && slot === 'camera') {
    return SLOT_ERRORS.phoneCamera;
  }
  return apiError;
}
