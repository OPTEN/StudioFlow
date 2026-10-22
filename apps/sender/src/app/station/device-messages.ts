import type {
  DeviceCommandDto,
  DeviceSelfDto,
  DeviceSlotDto,
  TallyDto,
  TallyState,
} from '@flowstudio/scene-model';

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

/** Validates a `command` message; null for malformed or unknown commands. */
export function parseCommand(value: unknown): DeviceCommandDto | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const command = value as Partial<Record<keyof DeviceCommandDto, unknown>>;
  if (
    typeof command.id !== 'string' ||
    (command.kind !== 'reshare' && command.kind !== 'switchCamera' && command.kind !== 'message')
  ) {
    return null;
  }
  return {
    id: command.id,
    kind: command.kind,
    slot: typeof command.slot === 'string' ? command.slot : null,
    text: typeof command.text === 'string' ? command.text : null,
    at: typeof command.at === 'string' ? command.at : new Date().toISOString(),
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

/** True for a hub error that says the device is blocked (`HubException` text «device_blocked: …»). */
export function isBlockedHubError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('device_blocked');
}

/** Number of a screen slot (`screen-3` → 3), 0 for the camera. */
export function slotNumber(slot: string): number {
  return slot === 'camera' ? 0 : Number(slot.slice('screen-'.length)) || 0;
}
