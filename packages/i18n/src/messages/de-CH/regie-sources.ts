import type { Translation } from '../../types';
import type { regieSources as en } from '../en/regie-sources';

export const regieSources: Translation<typeof en> = {
  'regie.sources.add.allUsed': 'Alle Quellen sind schon in dieser Szene.',
  'regie.sources.add.label': 'Quelle hinzufügen',
  'regie.sources.add.liveLocked':
    'Diese Szene ist live. Erst eine andere Szene ins Program schalten.',
  'regie.sources.add.manage': 'Medien verwalten …',
  'regie.sources.add.noSources':
    'Noch keine Quellen. Geräte unter Stationen koppeln oder ein Bild oder Video hochladen.',
  'regie.sources.add.offline':
    'Keine Verbindung zum Server. Hinzufügen geht wieder, sobald die Regie verbunden ist.',
  'regie.sources.add.sceneFallback': 'Szene',
  'regie.sources.add.title': 'Zu «{scene}» hinzufügen',
  'regie.sources.add.upload': 'Bild oder Video hochladen …',

  'regie.sources.dock.add': 'Quelle',
  'regie.sources.dock.drop': 'Bild oder Video hier ablegen',
  'regie.sources.dock.emptyText': 'Füge eine Quelle hinzu oder wende eine Vorlage an.',
  'regie.sources.dock.emptyTitle': 'Diese Szene ist leer.',
  'regie.sources.dock.listLabel': 'Elemente der Szene',
  'regie.sources.dock.loadingTitle': 'Quellen werden geladen …',
  'regie.sources.dock.noSceneText': 'Unter Szenen mit «+ Szene» eine Szene anlegen.',
  'regie.sources.dock.noSceneTitle': 'Keine Szene.',
  'regie.sources.dock.undo': 'Rückgängig (Ctrl+Z)',

  'regie.sources.group.camera': 'Kameras',
  'regie.sources.group.media': 'Medien',
  'regie.sources.group.screen': 'Screens',

  'regie.sources.hint.preview':
    'Ein Element im Preview-Monitor anklicken, dann ziehen oder an den Ecken skalieren.',
  'regie.sources.hint.program':
    'Ein Element im Program-Monitor anklicken, dann ziehen oder an den Ecken skalieren. Ohne Studio-Modus wirkt jede Änderung sofort live.',

  'regie.sources.row.hide': 'Ausblenden: {name}',
  'regie.sources.row.lock': 'Sperren: {name}',
  'regie.sources.row.select': 'Auswählen: {code} {name}',
  'regie.sources.row.show': 'Einblenden: {name}',
  'regie.sources.row.unlock': 'Entsperren: {name}',
};
