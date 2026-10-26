import type { SourceKind } from './contracts';

/**
 * A source reference as stored in scene items: `{deviceId}/{slot}` for a device slot (the device id is the LiveKit
 * identity, the slot the LiveKit track name), `{assetId}` for an uploaded image or video or `{textId}` for a text.
 */
export type ParsedSourceRef =
  | { readonly kind: 'device'; readonly deviceId: string; readonly slot: string }
  | { readonly kind: 'asset'; readonly assetId: string }
  | { readonly kind: 'text'; readonly textId: string };

const SLOT_PATTERN = /^(camera|mic|screen-[1-9])$/;
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

/** The microphone slot (a device microphone, or the feed of an audio station); also the name of its LiveKit track. */
export const MIC_SLOT = 'mic';

/** Suffix of the LiveKit track that carries the sound of a screen share: `screen-1-audio`. */
export const AUDIO_TRACK_SUFFIX = '-audio';

/** Kind of a device slot name (`camera` → camera, `screen-n` → screen, `mic` → audio). */
export function slotKind(slot: string): Extract<SourceKind, 'camera' | 'screen' | 'audio'> | null {
  if (slot === 'camera') {
    return 'camera';
  }
  if (slot === MIC_SLOT) {
    return 'audio';
  }
  return /^screen-[1-9]$/.test(slot) ? 'screen' : null;
}

/** Name of the LiveKit track that carries the sound of a screen slot (`screen-2` → `screen-2-audio`). */
export function screenAudioTrackName(screen: string): string {
  return `${screen}${AUDIO_TRACK_SUFFIX}`;
}

/**
 * The source a remote track belongs to, with what the track carries: a camera or screen slot name is the `picture` of
 * that source, `mic` is the `sound` of a microphone and `screen-n-audio` the `sound` of screen n. Null for names that are
 * not StudioFlow tracks.
 */
export function trackSource(
  identity: string,
  trackName: string,
): { readonly sourceId: string; readonly carries: 'picture' | 'sound' } | null {
  if (trackName.endsWith(AUDIO_TRACK_SUFFIX)) {
    const screen = trackName.slice(0, -AUDIO_TRACK_SUFFIX.length);
    return slotKind(screen) === 'screen'
      ? { sourceId: deviceSourceRef(identity, screen), carries: 'sound' }
      : null;
  }
  switch (slotKind(trackName)) {
    case 'camera':
    case 'screen':
      return { sourceId: deviceSourceRef(identity, trackName), carries: 'picture' };
    case 'audio':
      return { sourceId: deviceSourceRef(identity, trackName), carries: 'sound' };
    default:
      return null;
  }
}

/** Name of the n-th screen slot (1-based). */
export function screenSlot(index: number): string {
  return `screen-${index}`;
}
