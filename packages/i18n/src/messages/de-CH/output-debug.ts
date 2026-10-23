import type { Translation } from '../../types';
import type { outputDebug as en } from '../en/output-debug';

export const outputDebug: Translation<typeof en> = {
  'output.debug.availability.live': 'live',
  'output.debug.availability.lost': 'Standbild',
  'output.debug.availability.pending': 'kein Bild',

  'output.debug.broadcast.ended': 'beendet',
  'output.debug.broadcast.live': 'live',
  'output.debug.broadcast.standby': 'bereit',

  'output.debug.buffer': 'Puffer {value}',
  'output.debug.connections': 'Hub {hub} · Sync {sync}',

  'output.debug.hub.connected': 'verbunden',
  'output.debug.hub.connecting': 'verbindet …',
  'output.debug.hub.idle': 'bereit',
  'output.debug.hub.reconnecting': 'verbindet neu',
  'output.debug.hub.stopped': 'gestoppt',
  'output.debug.hub.unauthorized': 'kein Zugang',

  'output.debug.latency': 'Latenz ≈ {latency} · Renderer {fps} fps',
  'output.debug.livekit': 'LiveKit {state}',
  'output.debug.livekitLoading': 'lädt …',
  'output.debug.loss': 'Verlust {value}',

  'output.debug.media.connected': 'verbunden',
  'output.debug.media.connecting': 'verbindet …',
  'output.debug.media.idle': 'bereit',
  'output.debug.media.reconnecting': 'verbindet neu',
  'output.debug.media.removed': 'entfernt',
  'output.debug.media.replaced': 'ersetzt',
  'output.debug.media.stopped': 'gestoppt',
  'output.debug.media.unauthorized': 'kein Zugang',
  'output.debug.media.waiting': 'wartet auf neuen Versuch',

  'output.debug.noSources': 'Keine Kamera- oder Screen-Quelle im Bild',
  'output.debug.productionUnknown': 'Produktion unbekannt',
  'output.debug.revision': 'Revision {revision} · Sendung {state}',
  'output.debug.scene': 'Szene «{name}»',
  'output.debug.sceneNone': 'keine Szene',
  'output.debug.sourceFallback': 'Quelle',

  'output.debug.sync.connecting': 'verbindet …',
  'output.debug.sync.live': 'aktuell',
  'output.debug.sync.offline': 'offline, letzter Stand',
  'output.debug.sync.syncing': 'gleicht ab',
  'output.debug.sync.unauthorized': 'kein Zugang',
};
