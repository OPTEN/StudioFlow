import type { Translation } from '../../types';
import type { modelStatus as en } from '../en/model-status';

export const modelStatus: Translation<typeof en> = {
  'model.status.blocked': 'gesperrt',
  'model.status.connecting': 'verbindet …',
  'model.status.endedAudio': 'Mikrofon beendet',
  'model.status.endedCamera': 'Kamera beendet',
  'model.status.endedScreen': 'Teilen beendet',
  'model.status.incidents': { one: '{count} Störung', other: '{count} Störungen' },
  'model.status.lost': 'kein Bild',
  'model.status.lostAudio': 'kein Ton',
  'model.status.offline': 'nicht verbunden',
  'model.status.placeOff': 'nicht live',
  'model.status.placePreview': 'in der Preview',
  'model.status.placeProgram': 'im Program',
  'model.status.reconnecting': 'verbindet neu',
  'model.status.stationsOk': {
    '=0': 'Keine Stationen',
    one: '{count} Station ok',
    other: 'Alle {count} Stationen ok',
  },
};
