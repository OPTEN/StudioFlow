import type { SourceKind } from './contracts';

/**
 * A source reference as stored in scene items: `{deviceId}/{slot}` for a device slot (the device id is the LiveKit
 * identity, the slot the LiveKit track name), `{assetId}` for an uploaded image or video or `{textId}` for a text.
 */
export type ParsedSourceRef =
  | { readonly kind: 'device'; readonly deviceId: string; readonly slot: string }
  | { readonly kind: 'asset'; readonly assetId: string }
  | { readonly kind: 'text'; readonly textId: string };

const SLOT_PATTERN = /^(camera|screen-[1-9])$/;
const ID_PATTERN = /^[a-z]{3}_[a-z0-9]{4,40}$/;

/** Parses a source reference; returns null for malformed input. */
export function parseSourceRef(ref: string): ParsedSourceRef | null {
  const slash = ref.indexOf('/');
  if (slash < 0) {
    if (!ID_PATTERN.test(ref)) {
      return null;
    }
    if (ref.startsWith('ast_')) {
      return { kind: 'asset', assetId: ref };
    }
    return ref.startsWith('txt_') ? { kind: 'text', textId: ref } : null;
  }
  const deviceId = ref.slice(0, slash);
  const slot = ref.slice(slash + 1);
  if (!ID_PATTERN.test(deviceId) || !deviceId.startsWith('dev_') || !SLOT_PATTERN.test(slot)) {
    return null;
  }
  return { kind: 'device', deviceId, slot };
}

/** Builds the reference of a device slot. */
export function deviceSourceRef(deviceId: string, slot: string): string {
  return `${deviceId}/${slot}`;
}

/** True for `{deviceId}/{slot}` references. */
export function isDeviceSourceRef(ref: string): boolean {
  return parseSourceRef(ref)?.kind === 'device';
}

/** Kind of a device slot name (`camera` → camera, `screen-n` → screen). */
export function slotKind(slot: string): Extract<SourceKind, 'camera' | 'screen'> | null {
  if (slot === 'camera') {
    return 'camera';
  }
  return /^screen-[1-9]$/.test(slot) ? 'screen' : null;
}

/** Name of the n-th screen slot (1-based). */
export function screenSlot(index: number): string {
  return `screen-${index}`;
}
