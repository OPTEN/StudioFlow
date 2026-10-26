import type { AudioChannelDto, SourceDto } from './contracts';
import { AUDIO_LIMITS, clampSyncOffsetMs, dbToGain, isChannelAudible } from './audio';
import type { ProductionState } from './production-state';
import { compareCodes, programScene, sourcesInScene } from './selectors';

/**
 * Selectors of the audio mixer on a production state: which channels are audible in the program, the targets of the mix
 * and the rows of the Audio dock. The rules themselves are in `audio.ts`.
 */

/** The sources of the visible items of the program scene. */
function programSourceSet(state: ProductionState): ReadonlySet<string> {
  return new Set(sourcesInScene(programScene(state)));
}

/** The channel of a source, or null when it has none. */
export function audioChannelOf(state: ProductionState, sourceId: string): AudioChannelDto | null {
  return state.audioChannels.get(sourceId) ?? null;
}

/** True when the source's channel is audible in the program (the selector “audible in the program”). */
export function isAudibleInProgram(state: ProductionState, sourceId: string): boolean {
  const channel = state.audioChannels.get(sourceId);
  return (
    channel !== undefined &&
    isChannelAudible(channel, state.production.broadcast, programSourceSet(state))
  );
}

/** The sources whose channels are audible in the program. */
export function audibleChannelIds(state: ProductionState): ReadonlySet<string> {
  const program = programSourceSet(state);
  const broadcast = state.production.broadcast;
  const audible = new Set<string>();
  for (const channel of state.audioChannels.values()) {
    if (isChannelAudible(channel, broadcast, program)) {
      audible.add(channel.sourceId);
    }
  }
  return audible;
}

/** What one channel of the mix should do: its gain as a linear factor (0 when it is not audible) and its delay. */
export interface ChannelTarget {
  /** Linear gain, 0 while the channel is not audible. */
  readonly gain: number;
  /** Delay in milliseconds (the sync offset). */
  readonly delayMs: number;
  /** The channel is audible in the program (gain above 0). */
  readonly audible: boolean;
}

/** The targets of every channel of the state: the one input of the output page's mix and of the Regie's copy of it. */
export function audioTargets(state: ProductionState): ReadonlyMap<string, ChannelTarget> {
  const program = programSourceSet(state);
  const broadcast = state.production.broadcast;
  const targets = new Map<string, ChannelTarget>();
  for (const channel of state.audioChannels.values()) {
    const audible = isChannelAudible(channel, broadcast, program);
    targets.set(channel.sourceId, {
      gain: audible ? dbToGain(channel.gainDb) : 0,
      delayMs: clampSyncOffsetMs(channel.syncOffsetMs),
      audible,
    });
  }
  return targets;
}

/**
 * True when the mix is expected to make sound for whoever listens to the output: at least one channel could be heard
 * if the broadcast were live (not muted, fader up, not off). The “Audio blocked” warning only matters then.
 */
export function audioExpected(state: ProductionState): boolean {
  for (const channel of state.audioChannels.values()) {
    if (!channel.muted && channel.gainDb > AUDIO_LIMITS.minGainDb && channel.mode !== 'off') {
      return true;
    }
  }
  return false;
}

/** A channel with its source, for the Audio dock. */
export interface AudioChannelRow {
  readonly channel: AudioChannelDto;
  readonly source: SourceDto;
  /** Audio station, device microphone, screen audio or video sound. */
  readonly role: 'station' | 'microphone' | 'screen' | 'video';
}

/** The channels of the sources the state knows, audio stations first, then microphones, screens and videos by code. */
export function audioChannelRows(state: ProductionState): AudioChannelRow[] {
  const rows: AudioChannelRow[] = [];
  for (const channel of state.audioChannels.values()) {
    const source = state.sources.get(channel.sourceId);
    if (!source) {
      continue;
    }
    rows.push({ channel, source, role: audioRoleOf(state, source) });
  }
  const rank = { station: 0, microphone: 1, screen: 2, video: 3 } as const;
  return rows.sort(
    (a, b) => rank[a.role] - rank[b.role] || compareCodes(a.source.code, b.source.code),
  );
}

/** What kind of audio source a source is. */
export function audioRoleOf(state: ProductionState, source: SourceDto): AudioChannelRow['role'] {
  switch (source.kind) {
    case 'audio':
      return state.devices.get(source.deviceId ?? '')?.kind === 'audioStation'
        ? 'station'
        : 'microphone';
    case 'screen':
      return 'screen';
    default:
      return 'video';
  }
}
