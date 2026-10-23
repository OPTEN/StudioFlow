import type { Translation } from '../../types';
import type { regieProperties as en } from '../en/regie-properties';

export const regieProperties: Translation<typeof en> = {
  'regie.properties.crop.bottom': 'Unten',
  'regie.properties.crop.left': 'Links',
  'regie.properties.crop.right': 'Rechts',
  'regie.properties.crop.top': 'Oben',

  'regie.properties.dock.back': 'Zur Szene',
  'regie.properties.dock.backLabel': 'Auswahl aufheben, zurück zur Szene',
  'regie.properties.dock.backTitle': 'Auswahl aufheben (Esc)',
  'regie.properties.dock.loadingTitle': 'Eigenschaften werden geladen …',
  'regie.properties.dock.noSceneText': 'Unter Szenen mit «+ Szene» eine Szene anlegen.',
  'regie.properties.dock.noSceneTitle': 'Keine Szene.',
  'regie.properties.dock.titleItem': 'Element',
  'regie.properties.dock.titleScene': 'Szene',

  'regie.properties.element.border': 'Rahmen',
  'regie.properties.element.borderColorLabel': 'Farbe des Rahmens',
  'regie.properties.element.borderShow': 'anzeigen',
  'regie.properties.element.borderWidthLabel': 'Breite des Rahmens',
  'regie.properties.element.corners': 'Ecken',
  'regie.properties.element.crop': 'Zuschnitt',
  'regie.properties.element.fallback': 'Ersatzquelle',
  'regie.properties.element.fallbackHintHold':
    'Mit «Standbild halten» bleibt das letzte Bild stehen.',
  'regie.properties.element.fallbackHintTimed':
    'Erscheint nach der Haltezeit statt des Standbilds.',
  'regie.properties.element.fallbackNone': 'Keine',
  'regie.properties.element.fit': 'Einpassen',
  'regie.properties.element.fitContain': 'Ganz zeigen',
  'regie.properties.element.fitCover': 'Füllen',
  'regie.properties.element.heightShort': 'H',
  'regie.properties.element.layer': 'Ebene',
  'regie.properties.element.layerBackward': 'Nach hinten',
  'regie.properties.element.layerForward': 'Nach vorne',
  'regie.properties.element.mirror': 'Spiegeln',
  'regie.properties.element.note':
    'Shift löst das Seitenverhältnis, Alt schaltet das Einrasten aus, Pfeiltasten verschieben um 1 px. Esc hebt die Auswahl auf.',
  'regie.properties.element.onFailure': 'Bei Ausfall',
  'regie.properties.element.position': 'Position',
  'regie.properties.element.radiusLabel': 'Eckenradius',
  'regie.properties.element.remove': 'Aus Szene entfernen',
  'regie.properties.element.removeHint': 'Lässt sich mit Ctrl+Z zurückholen.',
  'regie.properties.element.rotate': 'Drehen',
  'regie.properties.element.rotateBy': 'Drehen um {degrees} Grad',
  'regie.properties.element.size': 'Grösse',
  'regie.properties.element.widthShort': 'B',

  'regie.properties.group.camera': 'Kameras',
  'regie.properties.group.media': 'Medien',
  'regie.properties.group.screen': 'Screens',

  'regie.properties.hold.custom': 'Standbild {seconds} s, dann abgedunkelt',

  'regie.properties.scene.autoGridActive': 'Auto-Grid aktiv',
  'regie.properties.scene.background': 'Hintergrund',
  'regie.properties.scene.colorLabel': 'Hintergrundfarbe',
  'regie.properties.scene.delete': 'Szene löschen',
  'regie.properties.scene.deleteHint': 'Löschen entfernt die Szene mit allen Elementen.',
  'regie.properties.scene.deleteHintLive': 'Die Live-Szene lässt sich nicht löschen.',
  'regie.properties.scene.deleteHintLiveDirect':
    'Die Live-Szene lässt sich nicht löschen. Andere Szenen im Studio-Modus bearbeiten.',
  'regie.properties.scene.deleteMessage':
    '«{name}» wird gelöscht. Das lässt sich nicht rückgängig machen.',
  'regie.properties.scene.imageLabel': 'Hintergrundbild',
  'regie.properties.scene.imageMissing': 'Bild fehlt',
  'regie.properties.scene.imageNone': 'Kein Bild',
  'regie.properties.scene.name': 'Name',
  'regie.properties.scene.templates': 'Vorlage anwenden',
};
