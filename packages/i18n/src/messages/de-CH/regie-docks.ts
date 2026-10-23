import type { Translation } from '../../types';
import type { regieDocks as en } from '../en/regie-docks';

export const regieDocks: Translation<typeof en> = {
  'regie.docks.loadingText': 'Die Regie verbindet mit dem Server.',
  'regie.docks.offline': 'Keine Verbindung zum Server. Bitte gleich nochmals versuchen.',

  'regie.docks.sortable.cancelled':
    'Verschieben abgebrochen. {name} ist wieder an Position {position} von {count}.',
  'regie.docks.sortable.dropped': '{name} abgelegt an Position {position} von {count}.',
  'regie.docks.sortable.handle': 'Verschieben: {name}',
  'regie.docks.sortable.handleTitle':
    'Ziehen zum Verschieben, oder Leertaste drücken und mit den Pfeiltasten bewegen',
  'regie.docks.sortable.moved': '{name} verschoben an Position {position} von {count}.',
  'regie.docks.sortable.picked':
    '{name} aufgenommen an Position {position} von {count}. Mit den Pfeiltasten bewegen, mit der Leertaste ablegen, mit Escape abbrechen.',
};
