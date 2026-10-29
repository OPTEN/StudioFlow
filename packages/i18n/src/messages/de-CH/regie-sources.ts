import type { Translation } from '../../types';
import type { regieSources as en } from '../en/regie-sources';

export const regieSources: Translation<typeof en> = {
  'regie.sources.add.allUsed': 'Alle Quellen sind schon in dieser Szene.',
  'regie.sources.add.inScene': 'In der Szene',
  'regie.sources.add.label': 'Quelle hinzufügen',
  'regie.sources.add.liveLocked':
    'Diese Szene ist live. Erst eine andere Szene ins Program schalten.',
  'regie.sources.add.manage': 'Mediathek …',
  'regie.sources.add.newText': 'Neuer Text',
  'regie.sources.add.newTextHint':
    'Wird ausgeblendet hinzugefügt, damit du ihn zuerst schreiben kannst.',
  'regie.sources.add.noSources':
    'Noch keine Quellen. Ein Gerät unter Geräte hinzufügen oder ein Bild oder Video hochladen.',
  'regie.sources.add.offline':
    'Keine Verbindung zum Server. Hinzufügen geht wieder, sobald die Regie verbunden ist.',
  'regie.sources.add.sceneFallback': 'Szene',
  'regie.sources.add.title': 'Zu «{scene}» hinzufügen',
  'regie.sources.add.upload': 'Bild oder Video hochladen …',

  'regie.sources.dock.add': 'Quelle',
  'regie.sources.dock.addLabel': 'Quelle hinzufügen',
  'regie.sources.dock.drop': 'Bilder oder Videos zum Hochladen hier ablegen',
  'regie.sources.dock.editing': 'in {scene}',
  'regie.sources.dock.emptyAdd': 'Eine Quelle hinzufügen',
  'regie.sources.dock.emptyLowerThird': 'Neue Bauchbinde',
  'regie.sources.dock.emptyText':
    'Füge eine Kamera, einen Screen, ein Medium oder einen Text hinzu.',
  'regie.sources.dock.emptyTitle': 'Diese Szene ist leer.',
  'regie.sources.dock.emptyUpload': 'Medien hochladen',
  'regie.sources.dock.listLabel': 'Elemente der Szene',
  'regie.sources.dock.loadingTitle': 'Quellen werden geladen …',
  'regie.sources.dock.noSceneText': 'Lege zuerst im Dock Szenen eine Szene an.',
  'regie.sources.dock.noSceneTitle': 'Keine Szene.',
  'regie.sources.dock.redo': 'Wiederholen (Ctrl+Shift+Z)',
  'regie.sources.dock.undo': 'Rückgängig (Ctrl+Z)',

  'regie.sources.group.camera': 'Kameras',
  'regie.sources.group.media': 'Medien',
  'regie.sources.group.screen': 'Screens',
  'regie.sources.group.text': 'Texte',

  'regie.sources.hint.autoGrid':
    'Auto-Grid: Die Reihenfolge der Elemente ist ihre Position im Raster. Eine Zeile ziehen, um ein Element in eine andere Zelle zu verschieben.',
  'regie.sources.hint.preview':
    'Die oberste Zeile liegt vorne. Eine Quelle im Preview-Monitor anklicken, um sie zu verschieben oder an den Ecken zu skalieren.',
  'regie.sources.hint.program':
    'Die oberste Zeile liegt vorne. Eine Quelle im Program-Monitor anklicken, um sie zu verschieben oder an den Ecken zu skalieren.',

  'regie.sources.menu.deleteKey': 'Entf',
  'regie.sources.menu.hide': 'Im Ausgang ausblenden',
  'regie.sources.menu.label': 'Quelle {name}',
  'regie.sources.menu.lock': 'Position und Grösse sperren',
  'regie.sources.menu.properties': 'Eigenschaften …',
  'regie.sources.menu.show': 'Im Ausgang einblenden',
  'regie.sources.menu.unlock': 'Entsperren',

  'regie.sources.row.hiddenHint': 'Im Ausgang ausgeblendet. Zum Bearbeiten einblenden.',
  'regie.sources.row.hide': 'Ausblenden: {name}',
  'regie.sources.row.hideTitle': 'Im Ausgang ausblenden',
  'regie.sources.row.lock': 'Sperren: {name}',
  'regie.sources.row.lockTitle': 'Sperren: Platz und Grösse im Monitor festhalten',
  'regie.sources.row.select': 'Auswählen: {code} {name}',
  'regie.sources.row.selectTitle':
    'In den Eigenschaften bearbeiten. Entf entfernt es aus der Szene.',
  'regie.sources.row.show': 'Einblenden: {name}',
  'regie.sources.row.showTitle': 'Im Ausgang einblenden',
  'regie.sources.row.unlock': 'Entsperren: {name}',
  'regie.sources.row.unlockTitle': 'Entsperren: Verschieben und Skalieren erlauben',

  'regie.sources.status.live': 'Live-Szene: Jede Änderung geht sofort auf Sendung.',
  'regie.sources.status.locked':
    'Diese Szene ist live im Program. Zum Bearbeiten eine andere Szene ins Program schalten.',
  'regie.sources.status.offline':
    'Keine Verbindung zum Server. Bearbeiten geht wieder, sobald er zurück ist.',
};
