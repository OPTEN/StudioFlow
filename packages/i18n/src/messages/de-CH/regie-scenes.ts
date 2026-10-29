import type { Translation } from '../../types';
import type { regieScenes as en } from '../en/regie-scenes';

export const regieScenes: Translation<typeof en> = {
  'regie.scenes.dock.add': 'Szene',
  'regie.scenes.dock.addLabel': 'Szene hinzufügen',
  'regie.scenes.dock.addTitle': 'Neue Szene am Ende der Liste',
  'regie.scenes.dock.addTitleMax': 'Höchstens {max} Szenen',
  'regie.scenes.dock.emptyText': 'Mit «+ Szene» die erste Szene anlegen.',
  'regie.scenes.dock.emptyTitle': 'Noch keine Szenen.',
  'regie.scenes.dock.keysHint': 'Tasten 1–9',
  'regie.scenes.dock.listLabel': 'Szenen',
  'regie.scenes.dock.loadingTitle': 'Szenen werden geladen …',

  'regie.scenes.name.copy': '{name} (Kopie)',
  'regie.scenes.name.copyNth': '{name} (Kopie {number})',
  'regie.scenes.name.new': 'Neue Szene {number}',

  'regie.scenes.row.disrupted': 'gestört',
  'regie.scenes.row.duplicate': 'Duplizieren',
  'regie.scenes.row.empty': 'leer',
  'regie.scenes.row.menuLabel': 'Szene {name}',
  'regie.scenes.row.menuTriggerLabel': 'Aktionen für Szene {name}',
  'regie.scenes.row.moveDown': 'Nach unten',
  'regie.scenes.row.moveUp': 'Nach oben',
  'regie.scenes.row.nameLabel': 'Name der Szene',

  'regie.scenes.toast.created': 'Szene «{name}» erstellt',
  'regie.scenes.toast.deleted': 'Szene «{name}» gelöscht',
  'regie.scenes.toast.limit': 'Eine Produktion hat höchstens {max} Szenen.',
  'regie.scenes.toast.liveDelete': 'Die Live-Szene lässt sich nicht löschen.',
  'regie.scenes.toast.nameLength': 'Der Name braucht 1 bis {max} Zeichen.',
};
