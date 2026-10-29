import type { Translation } from '../../types';
import type { regieCore as en } from '../en/regie-core';

export const regieCore: Translation<typeof en> = {
  'regie.core.appTitle': 'StudioFlow Regie',
  'regie.core.clipboard.copied': 'Kopiert: {text}',
  'regie.core.clipboard.selected': 'Markiert. Mit Ctrl+C kopieren.',
  'regie.core.clipboard.unavailable':
    'Kopieren geht hier nicht. Bitte den Link markieren und mit Ctrl+C kopieren.',
  'regie.core.confirm.label': 'Bestätigung',
  'regie.core.store.noActiveProduction': 'Keine aktive Produktion gefunden.',
  'regie.core.store.serverUnreachable':
    'Der Server ist nicht erreichbar. Die Regie verbindet neu …',
  'regie.core.store.stationsLoading': 'Geräte …',
  'regie.core.title.issues': { one: '{count} Störung', other: '{count} Störungen' },
  'regie.core.title.onAir': '● Auf Sendung',
  'regie.core.toast.dismiss': 'Ausblenden',
};
