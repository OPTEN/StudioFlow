import { t } from '@studioflow/i18n';
import {
  allowedAudioModes,
  audibleChannelIds,
  audioChannelRows,
  faderPosition,
  formatDb,
  type AudioChannelDto,
  type AudioMode,
  type ProductionState,
  type SourceDto,
} from '@studioflow/scene-model';
import type { IconName } from '../../core/ui/icon.component';

/**
 * Pure view model of the Audio dock (spec 9.1, issue #7): which channels get a row and what each row says. No Angular, no
 * DOM; the level of the meters is not here (it changes twenty times a second and is read by the row itself).
 */

/** What kind of sound a row is. */
export type AudioRole = 'station' | 'microphone' | 'screen' | 'video';

/** Icon per role. */
export const AUDIO_ROLE_ICON: Readonly<Record<AudioRole, IconName>> = {
  station: 'mic',
  microphone: 'mic',
  screen: 'screen',
  video: 'video',
};

/** One row of the Audio dock. */
export interface AudioRowView {
  readonly sourceId: string;
  readonly code: string;
  readonly name: string;
  readonly role: AudioRole;
  readonly roleText: string;
  readonly icon: IconName;
  /** The channel as the controls show it (changes that wait for their confirmation included). */
  readonly channel: AudioChannelDto;
  /** The modes the channel allows, in the order of the segmented control. */
  readonly modes: readonly AudioMode[];
  /** The channel is audible in the program right now. */
  readonly onAir: boolean;
  /** The channel has a sound to measure. */
  readonly hasSound: boolean;
  /** Fader position (0 silence, 1 = +10 dB). */
  readonly position: number;
  /** Fader value as the mixer prints it: "−6.0", "0.0", "−∞". */
  readonly dbText: string;
}

/** The name of a role in the active language. */
export function roleText(role: AudioRole): string {
  switch (role) {
    case 'station':
      return t('regie.audio.role.station');
    case 'microphone':
      return t('regie.audio.role.microphone');
    case 'screen':
      return t('regie.audio.role.screen');
    case 'video':
      return t('regie.audio.role.video');
  }
}

/**
 * True when a channel gets a row. A microphone (a person's or the audio station) always does: it is the thing to look
 * at when it is silent. The channel of a video does when the file has sound. The channel of a screen exists for every
 * screen, but only the ones that share sound have something to mix.
 */
export function showsRow(
  role: AudioRole,
  source: SourceDto,
  state: ProductionState,
  sounding: ReadonlySet<string>,
): boolean {
  switch (role) {
    case 'station':
    case 'microphone':
      return true;
    case 'video':
      return state.assets.get(source.id)?.hasAudio === true;
    case 'screen':
      return sounding.has(source.id);
  }
}

/**
 * The rows of the Audio dock: audio stations first, then microphones, screens and videos by code.
 * `channels` lays the controls' pending changes over the stored channels.
 */
export function audioRowViews(
  state: ProductionState,
  channels: ReadonlyMap<string, AudioChannelDto>,
  sounding: ReadonlySet<string>,
): AudioRowView[] {
  const audible = audibleChannelIds(state);
  const rows: AudioRowView[] = [];
  for (const row of audioChannelRows(state)) {
    if (!showsRow(row.role, row.source, state, sounding)) {
      continue;
    }
    const channel = channels.get(row.channel.sourceId) ?? row.channel;
    rows.push({
      sourceId: channel.sourceId,
      code: row.source.code,
      name: row.source.label,
      role: row.role,
      roleText: roleText(row.role),
      icon: AUDIO_ROLE_ICON[row.role],
      channel,
      modes: allowedAudioModes(row.source.kind),
      onAir: audible.has(channel.sourceId),
      hasSound: sounding.has(channel.sourceId),
      position: faderPosition(channel.gainDb),
      dbText: formatDb(channel.gainDb),
    });
  }
  return rows;
}

/** Message key of a mode. */
export function modeLabel(mode: AudioMode): string {
  switch (mode) {
    case 'always':
      return t('regie.audio.mode.always');
    case 'follow':
      return t('regie.audio.mode.follow');
    case 'off':
      return t('regie.audio.mode.off');
  }
}

/** The explanation of a mode (tooltip). */
export function modeHint(mode: AudioMode): string {
  switch (mode) {
    case 'always':
      return t('regie.audio.mode.alwaysHint');
    case 'follow':
      return t('regie.audio.mode.followHint');
    case 'off':
      return t('regie.audio.mode.offHint');
  }
}

/** The state word under the name of a row, or null when there is nothing to say. */
export function rowStateWord(row: AudioRowView, silent: boolean): string | null {
  if (silent) {
    return t('regie.audio.state.silent');
  }
  if (row.channel.muted) {
    return t('regie.audio.state.muted');
  }
  if (!row.hasSound && row.channel.mode !== 'off') {
    return t('regie.audio.state.noSound');
  }
  return null;
}

/** Level of a meter as the share of its width: −60 dBFS is empty, 0 dBFS is full. */
export function meterFill(levelDb: number | undefined): number {
  if (levelDb === undefined || !Number.isFinite(levelDb)) {
    return 0;
  }
  return Math.min(1, Math.max(0, (levelDb + 60) / 60));
}
