import { t } from '@studioflow/i18n';
import {
  canvasSizeLabel,
  formatDb,
  formatDecimal,
  formatKbpsAsMbit,
  formatRatioLabel,
  formatPercent,
  MISSING_VALUE,
  resolutionLabel,
  type BroadcastState,
  type CanvasDto,
  type OutputAudioDto,
} from '@studioflow/scene-model';
import type { HubState, SyncStatus } from '@studioflow/realtime-client';
import type { AudioSourceStats, MediaSessionState, SourceStats } from '@studioflow/media-client';

/**
 * `?debug=1`: a small panel top left with what a technician needs at the proxy, in sections: Program (production and
 * scene, revision, canvas), Connections (server and data, media server, latency and the frame rate of the picture),
 * Sources (per visible source resolution / fps / bitrate / packet loss / jitter-buffer delay), Audio, and the version
 * of the build in the last line. Lines in attention (reconnecting, freeze frame, software decoding) or failure (no
 * access) take the state colour. Updated every second; `position: fixed` and `pointer-events: none`, so the stage never
 * moves. Loaded lazily, only with the flag.
 */

/** Refresh interval of the panel. */
export const DEBUG_REFRESH_MS = 1000;

/** One visible device source. */
export interface DebugSource {
  readonly code: string | null;
  readonly label: string | null;
  readonly availability: 'live' | 'lost' | 'pending';
  readonly stats: SourceStats | null;
}

/** One channel of the audio mix. */
export interface DebugAudioChannel {
  readonly code: string | null;
  readonly label: string | null;
  /** The channel is audible in the program right now. */
  readonly audible: boolean;
  /** The channel has a sound (a live track or a playing video). */
  readonly hasSound: boolean;
  /** Peak of the last ~85 ms before the fader in dBFS, null for silence. */
  readonly levelDb: number | null;
  readonly stats: AudioSourceStats | null;
}

/** The audio mix of the page. */
export interface DebugAudio {
  readonly state: OutputAudioDto['state'];
  /** Peak of the program mix in dBFS, null for silence. */
  readonly programDb: number | null;
  readonly channels: readonly DebugAudioChannel[];
}

/** Everything the panel shows. */
export interface DebugInfo {
  readonly productionName: string | null;
  readonly sceneName: string | null;
  readonly broadcast: BroadcastState | null;
  readonly revision: number | null;
  /** The canvas of the production: what the stage is drawn at. */
  readonly canvas: CanvasDto | null;
  readonly hubState: HubState;
  readonly syncStatus: SyncStatus;
  /** Null until livekit-client is loaded. */
  readonly mediaState: MediaSessionState | null;
  readonly latencyMs: number | null;
  readonly rendererFps: number;
  readonly sources: readonly DebugSource[];
  /** The build of this page: `0.1.0+1a2b3c4` (src/build-info.ts). */
  readonly version: string;
  /** The audio mix; null until the page has one. */
  readonly audio: DebugAudio | null;
}

function ms(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value)
    ? MISSING_VALUE
    : `${Math.round(value)} ms`;
}

function sourceLine(source: DebugSource): string {
  const name =
    [source.code, source.label].filter(Boolean).join(' ') || t('output.debug.sourceFallback');
  const availability = t(`output.debug.availability.${source.availability}`);
  const stats = source.stats;
  if (!stats) {
    return `${name} · ${availability}`;
  }
  const size =
    stats.width && stats.height
      ? `${stats.width}×${stats.height}`
      : `${MISSING_VALUE}×${MISSING_VALUE}`;
  const fps = stats.fps === undefined ? MISSING_VALUE : formatDecimal(stats.fps, 0);
  return [
    name,
    size,
    `${fps} fps`,
    `${formatKbpsAsMbit(stats.bitrateKbps)} Mbit/s`,
    t('output.debug.loss', { value: formatPercent(stats.packetLossPct, 1) }),
    t('output.debug.buffer', { value: ms(stats.jitterBufferDelayMs) }),
    ...(stats.decoder === undefined ? [] : [t(`output.debug.decoder.${stats.decoder}`)]),
    ...(source.availability === 'live' ? [] : [availability]),
  ].join(' · ');
}

function dbfs(value: number | null): string {
  return value === null ? MISSING_VALUE : `${formatDb(value)} dBFS`;
}

function audioChannelLine(channel: DebugAudioChannel): string {
  const name =
    [channel.code, channel.label].filter(Boolean).join(' ') || t('output.debug.sourceFallback');
  const state = channel.hasSound
    ? t(
        channel.audible
          ? 'output.debug.audioChannelState.audible'
          : 'output.debug.audioChannelState.silent',
      )
    : t('output.debug.audioChannelState.noSound');
  const line = t('output.debug.audioChannel', { name, level: dbfs(channel.levelDb), state });
  const stats = channel.stats;
  if (!stats) {
    return line;
  }
  return [
    line,
    t('output.debug.loss', { value: formatPercent(stats.packetLossPct, 1) }),
    t('output.debug.jitter', { value: ms(stats.jitterMs) }),
    t('output.debug.buffer', { value: ms(stats.jitterBufferDelayMs) }),
    stats.codec ?? MISSING_VALUE,
  ].join(' · ');
}

/** How a line reads: as usual, in attention (still working, e.g. reconnecting) or as a failure. */
export type DebugTone = 'ok' | 'warn' | 'bad';

/** One line of the panel. */
export interface DebugLine {
  readonly text: string;
  readonly tone: DebugTone;
}

/** Lines under a heading; the build line at the end has none. */
export interface DebugSection {
  readonly heading: string | null;
  readonly lines: readonly DebugLine[];
}

const HUB_TONE: Readonly<Record<HubState, DebugTone>> = {
  connected: 'ok',
  connecting: 'warn',
  idle: 'warn',
  reconnecting: 'warn',
  stopped: 'bad',
  unauthorized: 'bad',
};

const SYNC_TONE: Readonly<Record<SyncStatus, DebugTone>> = {
  live: 'ok',
  connecting: 'warn',
  syncing: 'warn',
  offline: 'warn',
  unauthorized: 'bad',
};

const MEDIA_TONE: Readonly<Record<MediaSessionState, DebugTone>> = {
  connected: 'ok',
  connecting: 'warn',
  idle: 'warn',
  reconnecting: 'warn',
  waiting: 'warn',
  stopped: 'bad',
  replaced: 'bad',
  removed: 'bad',
  unauthorized: 'bad',
};

const AUDIO_TONE: Readonly<Record<DebugAudio['state'], DebugTone>> = {
  running: 'ok',
  off: 'ok',
  blocked: 'warn',
  unavailable: 'bad',
};

const TONE_RANK: Readonly<Record<DebugTone, number>> = { ok: 0, warn: 1, bad: 2 };

function worst(...tones: DebugTone[]): DebugTone {
  return tones.reduce<DebugTone>((a, b) => (TONE_RANK[b] > TONE_RANK[a] ? b : a), 'ok');
}

function line(text: string, tone: DebugTone = 'ok'): DebugLine {
  return { text, tone };
}

function sourceTone(source: DebugSource): DebugTone {
  return source.availability !== 'live' || source.stats?.decoder === 'software' ? 'warn' : 'ok';
}

/** The panel in sections, one entry per line (see {@link formatDebugLines} for the plain text). */
export function formatDebugSections(info: DebugInfo): DebugSection[] {
  const scene =
    info.sceneName === null
      ? t('output.debug.sceneNone')
      : t('output.debug.scene', { name: info.sceneName });
  const broadcast =
    info.broadcast === null ? MISSING_VALUE : t(`output.debug.broadcast.${info.broadcast}`);
  const sections: DebugSection[] = [
    {
      heading: t('output.debug.section.program'),
      lines: [
        line(`${info.productionName ?? t('output.debug.productionUnknown')} · ${scene}`),
        line(
          t('output.debug.revision', {
            revision: info.revision ?? MISSING_VALUE,
            state: broadcast,
          }),
        ),
        line(
          info.canvas === null
            ? t('output.debug.canvasUnknown')
            : t('output.debug.canvas', {
                size: canvasSizeLabel(info.canvas),
                format: formatRatioLabel(info.canvas.format),
                resolution: resolutionLabel(info.canvas.resolution),
              }),
        ),
      ],
    },
    {
      heading: t('output.debug.section.connections'),
      lines: [
        line(
          t('output.debug.connections', {
            hub: t(`output.debug.hub.${info.hubState}`),
            sync: t(`output.debug.sync.${info.syncStatus}`),
          }),
          worst(HUB_TONE[info.hubState], SYNC_TONE[info.syncStatus]),
        ),
        line(
          t('output.debug.mediaServer', {
            state:
              info.mediaState === null
                ? t('output.debug.mediaLoading')
                : t(`output.debug.media.${info.mediaState}`),
          }),
          info.mediaState === null ? 'warn' : MEDIA_TONE[info.mediaState],
        ),
        line(
          t('output.debug.latency', {
            latency: ms(info.latencyMs),
            fps: formatDecimal(info.rendererFps, 0),
          }),
        ),
      ],
    },
    {
      heading: t('output.debug.section.sources'),
      lines:
        info.sources.length === 0
          ? [line(t('output.debug.noSources'))]
          : info.sources.map((source) => line(sourceLine(source), sourceTone(source))),
    },
  ];
  if (info.audio) {
    sections.push({
      heading: t('output.debug.section.audio'),
      lines: [
        line(
          t('output.debug.audio', {
            state: t(`output.debug.audioState.${info.audio.state}`),
            level: dbfs(info.audio.programDb),
          }),
          AUDIO_TONE[info.audio.state],
        ),
        ...info.audio.channels.map((channel) => line(audioChannelLine(channel))),
      ],
    });
  }
  // Last, so that the lines above keep their place whatever the number of sources.
  sections.push({
    heading: null,
    lines: [line(t('output.debug.version', { version: info.version }))],
  });
  return sections;
}

/** The panel text, one entry per line. */
export function formatDebugLines(info: DebugInfo): string[] {
  return formatDebugSections(info).flatMap((section) => section.lines.map((entry) => entry.text));
}

/**
 * Draws the sections into the panel: one element per section (its heading is a `data-heading` drawn by CSS) and per
 * line, with a line break between the lines, so the text of the panel is exactly one line per measurement.
 */
function renderSections(
  doc: Document,
  panel: HTMLElement,
  sections: readonly DebugSection[],
): void {
  const total = sections.reduce((count, section) => count + section.lines.length, 0);
  let written = 0;
  const groups = sections.map((section) => {
    const group = doc.createElement('span');
    group.className =
      section.heading === null ? 'c-debug__section c-debug__section--build' : 'c-debug__section';
    if (section.heading !== null) {
      group.dataset['heading'] = section.heading;
    }
    for (const entry of section.lines) {
      const element = doc.createElement('span');
      element.className = entry.tone === 'ok' ? 'c-debug__line' : `c-debug__line is-${entry.tone}`;
      element.textContent = entry.text;
      group.append(element);
      written += 1;
      if (written < total) {
        group.append('\n');
      }
    }
    return group;
  });
  panel.replaceChildren(...groups);
}

/** Mounts the panel and refreshes it every second; returns the function that removes it. */
export function mountDebugOverlay(
  doc: Document,
  collect: () => Promise<DebugInfo>,
  intervalMs = DEBUG_REFRESH_MS,
): () => void {
  const panel = doc.createElement('pre');
  panel.className = 'c-debug';
  panel.setAttribute('aria-hidden', 'true');
  doc.body.append(panel);
  let busy = false;
  let stopped = false;
  let shown = '';
  const refresh = async (): Promise<void> => {
    if (busy || stopped) {
      return;
    }
    busy = true;
    try {
      const sections = formatDebugSections(await collect());
      const key = JSON.stringify(sections);
      if (!stopped && key !== shown) {
        shown = key;
        renderSections(doc, panel, sections);
      }
    } catch {
      // The next refresh tries again.
    } finally {
      busy = false;
    }
  };
  void refresh();
  const timer = setInterval(() => void refresh(), intervalMs);
  return () => {
    stopped = true;
    clearInterval(timer);
    panel.remove();
  };
}
