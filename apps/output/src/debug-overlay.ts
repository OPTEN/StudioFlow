import { t } from '@studioflow/i18n';
import {
  canvasSizeLabel,
  formatDecimal,
  formatKbpsAsMbit,
  formatRatioLabel,
  formatPercent,
  MISSING_VALUE,
  resolutionLabel,
  type BroadcastState,
  type CanvasDto,
} from '@studioflow/scene-model';
import type { HubState, SyncStatus } from '@studioflow/realtime-client';
import type { MediaSessionState, SourceStats } from '@studioflow/media-client';

/**
 * `?debug=1`: a small mono panel top left with what a technician needs at the proxy: production and scene, revision,
 * connection states, per visible source resolution / fps / bitrate / packet loss / jitter-buffer delay, the estimated
 * latency and the renderer frame rate, and the version of the build in the last line. Updated every second; `position: fixed` and `pointer-events: none`, so the
 * stage never moves. Loaded lazily, only with the flag.
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

/** The panel text, one entry per line. */
export function formatDebugLines(info: DebugInfo): string[] {
  const scene =
    info.sceneName === null
      ? t('output.debug.sceneNone')
      : t('output.debug.scene', { name: info.sceneName });
  const broadcast =
    info.broadcast === null ? MISSING_VALUE : t(`output.debug.broadcast.${info.broadcast}`);
  const lines = [
    `${info.productionName ?? t('output.debug.productionUnknown')} · ${scene}`,
    t('output.debug.revision', { revision: info.revision ?? MISSING_VALUE, state: broadcast }),
    info.canvas === null
      ? t('output.debug.canvasUnknown')
      : t('output.debug.canvas', {
          size: canvasSizeLabel(info.canvas),
          format: formatRatioLabel(info.canvas.format),
          resolution: resolutionLabel(info.canvas.resolution),
        }),
    t('output.debug.connections', {
      hub: t(`output.debug.hub.${info.hubState}`),
      sync: t(`output.debug.sync.${info.syncStatus}`),
    }),
    t('output.debug.livekit', {
      state:
        info.mediaState === null
          ? t('output.debug.livekitLoading')
          : t(`output.debug.media.${info.mediaState}`),
    }),
    t('output.debug.latency', {
      latency: ms(info.latencyMs),
      fps: formatDecimal(info.rendererFps, 0),
    }),
  ];
  if (info.sources.length === 0) {
    lines.push(t('output.debug.noSources'));
  }
  for (const source of info.sources) {
    lines.push(sourceLine(source));
  }
  // Last, so that the lines above keep their place whatever the number of sources.
  lines.push(t('output.debug.version', { version: info.version }));
  return lines;
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
  const refresh = async (): Promise<void> => {
    if (busy || stopped) {
      return;
    }
    busy = true;
    try {
      const text = formatDebugLines(await collect()).join('\n');
      if (!stopped && panel.textContent !== text) {
        panel.textContent = text;
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
