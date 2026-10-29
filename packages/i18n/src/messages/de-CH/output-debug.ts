import type { Translation } from '../../types';
import type { outputDebug as en } from '../en/output-debug';

export const outputDebug: Translation<typeof en> = {
  'output.debug.audio': 'Ton {state} · Program {level}',
  'output.debug.audioChannel': '{name} · {level} · {state}',
  'output.debug.audioChannelState.audible': 'hörbar',
  'output.debug.audioChannelState.noSound': 'kein Ton',
  'output.debug.audioChannelState.silent': 'still',
  'output.debug.audioState.blocked': 'gesperrt (Seite anklicken)',
  'output.debug.audioState.off': 'aus',
  'output.debug.audioState.running': 'läuft',
  'output.debug.audioState.unavailable': 'nicht verfügbar',
  'output.debug.availability.live': 'live',
  'output.debug.availability.lost': 'Standbild',
  'output.debug.availability.pending': 'kein Bild',

  'output.debug.broadcast.ended': 'beendet',
  'output.debug.broadcast.live': 'live',
  'output.debug.broadcast.standby': 'bereit',

  'output.debug.buffer': 'Puffer {value}',
  'output.debug.canvas': 'Leinwand {size} · {format} · {resolution}',
  'output.debug.canvasUnknown': 'Leinwand unbekannt',
  'output.debug.connections': 'Server {hub} · Daten {sync}',

  'output.debug.decoder.hardware': 'Hardware-Decodierung',
  'output.debug.decoder.software': 'Software-Decodierung',

  'output.debug.hub.connected': 'verbunden',
  'output.debug.hub.connecting': 'verbindet …',
  'output.debug.hub.idle': 'nicht gestartet',
  'output.debug.hub.reconnecting': 'verbindet neu',
  'output.debug.hub.stopped': 'gestoppt',
  'output.debug.hub.unauthorized': 'kein Zugang',

  'output.debug.jitter': 'Jitter {value}',
  'output.debug.latency': 'Latenz ≈ {latency} · Bild {fps} fps',
  'output.debug.loss': 'Verlust {value}',

  'output.debug.media.connected': 'verbunden',
  'output.debug.media.connecting': 'verbindet …',
  'output.debug.media.idle': 'nicht gestartet',
  'output.debug.media.reconnecting': 'verbindet neu',
  'output.debug.media.removed': 'entfernt',
  'output.debug.media.replaced': 'ersetzt',
  'output.debug.media.stopped': 'gestoppt',
  'output.debug.media.unauthorized': 'kein Zugang',
  'output.debug.media.waiting': 'wartet auf neuen Versuch',
  'output.debug.mediaLoading': 'lädt …',
  'output.debug.mediaServer': 'Medienserver {state}',

  'output.debug.noSources': 'Keine Kamera- oder Screen-Quelle im Bild',
  'output.debug.productionUnknown': 'Produktion unbekannt',
  'output.debug.revision': 'Revision {revision} · Sendung {state}',
  'output.debug.scene': 'Szene «{name}»',
  'output.debug.sceneNone': 'keine Szene',

  'output.debug.section.audio': 'Ton',
  'output.debug.section.connections': 'Verbindungen',
  'output.debug.section.program': 'Program',
  'output.debug.section.sources': 'Quellen',

  'output.debug.sourceFallback': 'Quelle',

  'output.debug.sync.connecting': 'verbindet …',
  'output.debug.sync.live': 'aktuell',
  'output.debug.sync.offline': 'offline, letzter bekannter Stand',
  'output.debug.sync.syncing': 'holt auf',
  'output.debug.sync.unauthorized': 'kein Zugang',

  'output.debug.version': 'StudioFlow {version}',
};
