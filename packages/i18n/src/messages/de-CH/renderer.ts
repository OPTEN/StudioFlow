import type { Translation } from '../../types';
import type { renderer as en } from '../en/renderer';

export const renderer: Translation<typeof en> = {
  'renderer.alertEnded': 'beendet',
  'renderer.alertFrozen': 'Standbild {time}',
  'renderer.alertFrozenShort': 'Standbild {time}',
  'renderer.held': 'Bild kommt gleich zurück',
  'renderer.sourceMissing': 'Quelle fehlt',
  'renderer.stageLabel': 'Szene',
};
