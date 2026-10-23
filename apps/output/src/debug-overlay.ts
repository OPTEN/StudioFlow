import {
  formatDecimal,
  formatKbpsAsMbit,
  formatPercent,
  MISSING_VALUE,
  type BroadcastState,
} from '@studioflow/scene-model';
import type { HubState, SyncStatus } from '@studioflow/realtime-client';
import type { MediaSessionState, SourceStats } from '@studioflow/media-client';

/**
 * `?debug=1`: a small mono panel top left with what a technician needs at the proxy: production and scene, revision,
 * connection states, per visible source resolution / fps / bitrate / packet loss / jitter-buffer delay, the estimated
 * latency and the renderer frame rate. Updated every second; `position: fixed` and `pointer-events: none`, so the
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
  readonly hubState: HubState;
  readonly syncStatus: SyncStatus;
  /** Null until livekit-client is loaded. */
  readonly mediaState: MediaSessionState | null;
  readonly latencyMs: number | null;
  readonly rendererFps: number;
  readonly sources: readonly DebugSource[];
}

const HUB_WORDS: Record<HubState, string> = {
  idle: 'bereit',
  connecting: 'verbindet …',
  connected: 'verbunden',
  reconnecting: 'verbindet neu',
  unauthorized: 'kein Zugang',
  stopped: 'gestoppt',
};

const SYNC_WORDS: Record<SyncStatus, string> = {
  connecting: 'verbindet …',
  syncing: 'gleicht ab',
  live: 'aktuell',
  offline: 'offline, letzter Stand',
  unauthorized: 'kein Zugang',
};

const MEDIA_WORDS: Record<MediaSessionState, string> = {
  idle: 'bereit',
  connecting: 'verbindet …',
  connected: 'verbunden',
  reconnecting: 'verbindet neu',
  waiting: 'wartet auf neuen Versuch',
  stopped: 'gestoppt',
  replaced: 'ersetzt',
  removed: 'entfernt',
  unauthorized: 'kein Zugang',
};

const BROADCAST_WORDS: Record<BroadcastState, string> = {
  standby: 'bereit',
  live: 'live',
  ended: 'beendet',
};

const AVAILABILITY_WORDS: Record<DebugSource['availability'], string> = {
  live: 'live',
  lost: 'Standbild',
  pending: 'kein Bild',
};

function ms(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value)
    ? MISSING_VALUE
    : `${Math.round(value)} ms`;
}

function sourceLine(source: DebugSource): string {
  const name = [source.code, source.label].filter(Boolean).join(' ') || 'Quelle';
  const stats = source.stats;
  if (!stats) {
    return `${name} · ${AVAILABILITY_WORDS[source.availability]}`;
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
    `Verlust ${formatPercent(stats.packetLossPct, 1)}`,
    `Puffer ${ms(stats.jitterBufferDelayMs)}`,
    ...(source.availability === 'live' ? [] : [AVAILABILITY_WORDS[source.availability]]),
  ].join(' · ');
}

/** The panel text, one entry per line. */
export function formatDebugLines(info: DebugInfo): string[] {
  const scene = info.sceneName === null ? 'keine Szene' : `Szene «${info.sceneName}»`;
  const broadcast = info.broadcast === null ? MISSING_VALUE : BROADCAST_WORDS[info.broadcast];
  const lines = [
    `${info.productionName ?? 'Produktion unbekannt'} · ${scene}`,
    `Revision ${info.revision ?? MISSING_VALUE} · Sendung ${broadcast}`,
    `Hub ${HUB_WORDS[info.hubState]} · Sync ${SYNC_WORDS[info.syncStatus]}`,
    `LiveKit ${info.mediaState === null ? 'lädt …' : MEDIA_WORDS[info.mediaState]}`,
    `Latenz ≈ ${ms(info.latencyMs)} · Renderer ${formatDecimal(info.rendererFps, 0)} fps`,
  ];
  if (info.sources.length === 0) {
    lines.push('Keine Kamera- oder Screen-Quelle im Bild');
  }
  for (const source of info.sources) {
    lines.push(sourceLine(source));
  }
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
