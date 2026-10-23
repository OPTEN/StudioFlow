import { ERROR_CODES, LIMITS } from '@studioflow/scene-model';
import { toApiError } from '../core/api-error';

/** German messages for the refused slot requests of a station (GAP-05, GAP-19). */
export const SLOT_ERROR_MESSAGES = {
  phoneScreen: 'Ein Handy kann keinen Bildschirm teilen. Dafür bitte einen Laptop koppeln.',
  screenLimit: `Pro Gerät sind höchstens ${LIMITS.screensPerDevice} Bildschirme möglich.`,
  cameraLimit: 'Dieses Gerät hat schon eine Kamera.',
  phoneCamera:
    'Die Kamera eines Handys lässt sich nicht entfernen. Die Regie kann das ganze Gerät entfernen.',
} as const;

/**
 * Message for a failed `POST /api/device/slots`: 400 when a phone asks for a screen, 409 `limit_reached` for the
 * tenth screen or a second camera, otherwise the general API message (e.g. «Der Server ist gerade nicht erreichbar»).
 */
export function allocateSlotErrorMessage(error: unknown, kind: 'camera' | 'screen'): string {
  const apiError = toApiError(error);
  if (apiError.status === 400 && kind === 'screen') {
    return SLOT_ERROR_MESSAGES.phoneScreen;
  }
  if (apiError.status === 409 && apiError.code === ERROR_CODES.limitReached) {
    return kind === 'screen' ? SLOT_ERROR_MESSAGES.screenLimit : SLOT_ERROR_MESSAGES.cameraLimit;
  }
  return apiError.message;
}

/**
 * Message for a failed `DELETE /api/device/slots/{slot}` (409 `conflict`: a phone's only camera cannot be removed),
 * or null for 404: the slot does not exist on the server any more (removed in another tab), so the goal is reached.
 */
export function releaseSlotErrorMessage(error: unknown, slot: string): string | null {
  const apiError = toApiError(error);
  if (apiError.status === 404) {
    return null;
  }
  if (apiError.status === 409 && slot === 'camera') {
    return SLOT_ERROR_MESSAGES.phoneCamera;
  }
  return apiError.message;
}
