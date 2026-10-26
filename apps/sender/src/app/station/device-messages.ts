import { isCameraControl } from '@studioflow/media-client/device';
import { hubErrorCode } from '@studioflow/realtime-client';
import {
  ERROR_CODES,
  type DeviceCommandDto,
  type DeviceCommandKind,
  type DeviceSelfDto,
  type DeviceSlotDto,
  type TallyDto,
  type TallyState,
} from '@studioflow/scene-model';

/** Tally while nothing is known or nothing is on air. */
export const OFF_TALLY: TallyDto = { overall: 'off', slots: {} };

const TALLY_STATES = new Set<TallyState>(['off', 'preview', 'program']);

function isTallyState(value: unknown): value is TallyState {
  return typeof value === 'string' && TALLY_STATES.has(value as TallyState);
}

/** Validates a `tally` message (hub data is unchecked); null for malformed input. */
export function parseTally(value: unknown): TallyDto | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const { overall, slots } = value as { overall?: unknown; slots?: unknown };
  if (!isTallyState(overall)) {
    return null;
  }
  const perSlot: Record<string, TallyState> = {};
  if (typeof slots === 'object' && slots !== null) {
    for (const [slot, state] of Object.entries(slots)) {
      if (isTallyState(state)) {
        perSlot[slot] = state;
      }
    }
  }
  return { overall, slots: perSlot };
}

const COMMAND_KINDS = new Set<DeviceCommandKind>([
  'reshare',
  'switchCamera',
  'message',
  'cameraControl',
]);

/**
 * Validates a `command` message; null for malformed or unknown commands, and for a camera control without a valid
 * payload of the version this sender speaks.
 */
export function parseCommand(value: unknown): DeviceCommandDto | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const command = value as Partial<Record<keyof DeviceCommandDto, unknown>>;
  if (typeof command.id !== 'string' || !COMMAND_KINDS.has(command.kind as DeviceCommandKind)) {
    return null;
  }
  const camera = isCameraControl(command.camera) ? command.camera : null;
  if (command.kind === 'cameraControl' && camera === null) {
    return null;
  }
  return {
    id: command.id,
    kind: command.kind as DeviceCommandKind,
    slot: typeof command.slot === 'string' ? command.slot : null,
    text: typeof command.text === 'string' ? command.text : null,
    at: typeof command.at === 'string' ? command.at : new Date().toISOString(),
    camera,
  };
}

function isSlot(value: unknown): value is DeviceSlotDto {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const slot = value as Partial<Record<keyof DeviceSlotDto, unknown>>;
  return (
    typeof slot.slot === 'string' &&
    typeof slot.code === 'string' &&
    (slot.kind === 'camera' || slot.kind === 'screen')
  );
}

/** Validates a `self` message or `DeviceSelfDto` answer. */
export function isDeviceSelf(value: unknown): value is DeviceSelfDto {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const self = value as Partial<Record<keyof DeviceSelfDto, unknown>>;
  return (
    typeof self.id === 'string' &&
    typeof self.name === 'string' &&
    (self.kind === 'phone' || self.kind === 'laptop') &&
    (self.state === 'active' || self.state === 'blocked') &&
    Array.isArray(self.slots) &&
    self.slots.every(isSlot)
  );
}

/** True for a hub error that says the device is blocked (`HubException` text “device_blocked: …”). */
export function isBlockedHubError(error: unknown): boolean {
  return hubErrorCode(error) === ERROR_CODES.deviceBlocked;
}

/** Number of a screen slot (`screen-3` → 3), 0 for the camera. */
export function slotNumber(slot: string): number {
  return slot === 'camera' ? 0 : Number(slot.slice('screen-'.length)) || 0;
}
