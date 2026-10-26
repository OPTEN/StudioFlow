import type {
  AudioChannelDto,
  AudioMode,
  BroadcastState,
  DeviceKind,
  SourceKind,
} from './contracts';
import { parseSourceRef } from './source-ref';

/**
 * The audio mixer (spec 4.4, issue #7): limits, the gain scale, the rule that decides which channels are audible in the
 * program, and the targets the output page (and the Regie's own copy of the mix) set on its Web Audio graph. Mirrors
 * `AudioMixerRules` in the API; the API is authoritative, the numbers and the audibility rule are the same.
 */

/** Limits of a channel. */
export const AUDIO_LIMITS = {
  /** The lowest fader position: silence, shown as −∞. */
  minGainDb: -100,
  /** The highest fader position. */
  maxGainDb: 10,
  /** The longest sync offset (delay of the sound) in milliseconds. */
  maxSyncOffsetMs: 500,
} as const;

/** The modes of a channel in the order the Regie lists them. */
export const AUDIO_MODES: readonly AudioMode[] = ['always', 'follow', 'off'];

/**
 * Ramp of a switch on a cut, a mute or a fader move in milliseconds: long enough that the waveform does not click,
 * short enough that nobody notices a delay.
 */
export const AUDIO_RAMP_MS = 20;

/** An audible channel that has been silent for this long is reported by the Regie as a warning (not an incident). */
export const AUDIO_SILENCE_WARNING_MS = 10_000;

/** Peak level (dBFS) below which a channel counts as silent. */
export const AUDIO_SILENCE_DB = -60;

/** Lowest level the meters show (dBFS). */
export const AUDIO_METER_FLOOR_DB = -60;

/** The gain a fader position gives as a linear factor: 0 dB is 1, −6 dB about 0.5; the floor is exactly 0. */
export function dbToGain(db: number): number {
  return !Number.isFinite(db) || db <= AUDIO_LIMITS.minGainDb ? 0 : 10 ** (db / 20);
}

/** The level of a linear amplitude in dBFS; silence (and anything below the fader floor) is {@link AUDIO_LIMITS.minGainDb}. */
export function gainToDb(gain: number): number {
  return !Number.isFinite(gain) || gain <= 0
    ? AUDIO_LIMITS.minGainDb
    : Math.max(AUDIO_LIMITS.minGainDb, 20 * Math.log10(gain));
}

/** Keeps a fader position inside its limits; NaN becomes unity gain. */
export function clampGainDb(db: number): number {
  if (Number.isNaN(db)) {
    return 0;
  }
  return Math.min(AUDIO_LIMITS.maxGainDb, Math.max(AUDIO_LIMITS.minGainDb, db));
}

/** Keeps a sync offset inside its limits, rounded to whole milliseconds. */
export function clampSyncOffsetMs(ms: number): number {
  return Number.isFinite(ms)
    ? Math.min(AUDIO_LIMITS.maxSyncOffsetMs, Math.max(0, Math.round(ms)))
    : 0;
}

/** Below this level the fader is a coarse scale down to silence; above it, one dB takes the same travel everywhere. */
const FADER_USABLE_MIN_DB = -60;

/** Share of the fader travel that the range from silence up to {@link FADER_USABLE_MIN_DB} takes. */
const FADER_FLOOR_SHARE = 0.04;

/**
 * Position of the fader (0 at silence, 1 at +10 dB). The useful range −60 … +10 dB is linear in dB and takes 96 % of the
 * travel; the last 4 % at the bottom are the drop from −60 dB to silence.
 */
export function faderPosition(db: number): number {
  const clamped = clampGainDb(db);
  if (clamped <= FADER_USABLE_MIN_DB) {
    return (
      FADER_FLOOR_SHARE *
      ((clamped - AUDIO_LIMITS.minGainDb) / (FADER_USABLE_MIN_DB - AUDIO_LIMITS.minGainDb))
    );
  }
  return (
    FADER_FLOOR_SHARE +
    (1 - FADER_FLOOR_SHARE) *
      ((clamped - FADER_USABLE_MIN_DB) / (AUDIO_LIMITS.maxGainDb - FADER_USABLE_MIN_DB))
  );
}

/** The inverse of {@link faderPosition}: the dB value of a position between 0 and 1, rounded to 0.1 dB. */
export function faderValue(position: number): number {
  const p = Math.min(1, Math.max(0, position));
  const db =
    p <= FADER_FLOOR_SHARE
      ? AUDIO_LIMITS.minGainDb +
        (p / FADER_FLOOR_SHARE) * (FADER_USABLE_MIN_DB - AUDIO_LIMITS.minGainDb)
      : FADER_USABLE_MIN_DB +
        ((p - FADER_FLOOR_SHARE) / (1 - FADER_FLOOR_SHARE)) *
          (AUDIO_LIMITS.maxGainDb - FADER_USABLE_MIN_DB);
  return clampGainDb(Math.round(db * 10) / 10);
}

/** The channel a source starts with when the server creates it (mirrors `AudioMixerRules.DefaultChannel`). */
export function defaultAudioChannel(
  sourceId: string,
  kind: SourceKind,
  deviceKind?: DeviceKind | null,
): AudioChannelDto {
  if (kind === 'audio') {
    return deviceKind === 'audioStation'
      ? { sourceId, gainDb: 0, muted: false, mode: 'always', syncOffsetMs: 0 }
      : { sourceId, gainDb: 0, muted: true, mode: 'follow', syncOffsetMs: 0 };
  }
  return { sourceId, gainDb: 0, muted: false, mode: 'follow', syncOffsetMs: 0 };
}

/** True for sources that can have a channel when they carry sound: a microphone, a screen, a video. */
export function canCarrySound(kind: SourceKind): boolean {
  return kind === 'audio' || kind === 'screen' || kind === 'video';
}

/** The modes a channel of this source allows: the sound of a video always belongs to its picture. */
export function allowedAudioModes(kind: SourceKind): readonly AudioMode[] {
  return kind === 'video' ? ['follow', 'off'] : AUDIO_MODES;
}

/**
 * The picture a channel follows: a screen or a video follows its own item, a microphone follows every source of its
 * device (the camera of the phone it sits in, the screens of the laptop).
 */
export function followsPicture(
  channelSourceId: string,
  visibleSources: ReadonlySet<string>,
): boolean {
  const ref = parseSourceRef(channelSourceId);
  if (ref?.kind !== 'device' || ref.slot !== 'mic') {
    return visibleSources.has(channelSourceId);
  }
  for (const source of visibleSources) {
    const shown = parseSourceRef(source);
    if (shown?.kind === 'device' && shown.deviceId === ref.deviceId) {
      return true;
    }
  }
  return false;
}

/**
 * True when the channel is audible: the broadcast is live (nothing is on air in standby and after the end), it is not
 * muted, its fader is up and its mode lets it through. `programSources` are the sources of the visible items of the
 * program scene; the Studio Mode preview never counts.
 */
export function isChannelAudible(
  channel: AudioChannelDto,
  broadcast: BroadcastState,
  programSources: ReadonlySet<string>,
): boolean {
  if (broadcast !== 'live' || channel.muted || channel.gainDb <= AUDIO_LIMITS.minGainDb) {
    return false;
  }
  switch (channel.mode) {
    case 'always':
      return true;
    case 'follow':
      return followsPicture(channel.sourceId, programSources);
    case 'off':
      return false;
  }
}

/** True when a changed channel differs from the stored one in a way the mix hears (gain, mute, mode or delay). */
export function sameChannel(
  a: AudioChannelDto | undefined,
  b: AudioChannelDto | undefined,
): boolean {
  return (
    a !== undefined &&
    b !== undefined &&
    a.sourceId === b.sourceId &&
    a.gainDb === b.gainDb &&
    a.muted === b.muted &&
    a.mode === b.mode &&
    a.syncOffsetMs === b.syncOffsetMs
  );
}
