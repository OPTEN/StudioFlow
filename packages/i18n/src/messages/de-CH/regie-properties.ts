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
  'regie.properties.dock.noSceneText': 'Lege zuerst im Dock Szenen eine Szene an.',
  'regie.properties.dock.noSceneTitle': 'Keine Szene.',
  'regie.properties.dock.titleItem': 'Element',
  'regie.properties.dock.titleScene': 'Szene',

  'regie.properties.element.border': 'Rahmen',
  'regie.properties.element.borderColorLabel': 'Farbe des Rahmens',
  'regie.properties.element.borderWidthLabel': 'Breite des Rahmens',
  'regie.properties.element.canvas': 'Bildfläche {width} × {height}',
  'regie.properties.element.corners': 'Ecken',
  'regie.properties.element.crop': 'Zuschnitt',
  'regie.properties.element.fallback': 'Danach',
  'regie.properties.element.fallbackHintHold':
    'Das letzte Bild bleibt stehen, bis die Quelle zurück ist.',
  'regie.properties.element.fallbackNone': 'Das letzte Bild, abgedunkelt',
  'regie.properties.element.fit': 'Einpassen',
  'regie.properties.element.fitContain': 'Ganz zeigen',
  'regie.properties.element.fitCover': 'Füllen',
  'regie.properties.element.heightShort': 'H',
  'regie.properties.element.layerBackward': 'Nach hinten',
  'regie.properties.element.layerForward': 'Nach vorne',
  'regie.properties.element.layerToBack': 'Ganz nach hinten',
  'regie.properties.element.layerToFront': 'Ganz nach vorne',
  'regie.properties.element.mirror': 'Spiegeln',
  'regie.properties.element.note':
    'Shift löst das Seitenverhältnis, Alt schaltet das Einrasten aus, Pfeiltasten verschieben um 1 px. Esc hebt die Auswahl auf.',
  'regie.properties.element.onFailure': 'Zuerst',
  'regie.properties.element.radiusLabel': 'Eckenradius',
  'regie.properties.element.remove': 'Aus Szene entfernen',
  'regie.properties.element.removeHint': 'Ctrl+Z holt es zurück.',
  'regie.properties.element.rotate': 'Drehen',
  'regie.properties.element.rotateBy': 'Drehen um {degrees} Grad',
  'regie.properties.element.widthShort': 'B',

  'regie.properties.group.camera': 'Kameras',
  'regie.properties.group.media': 'Medien',
  'regie.properties.group.screen': 'Screens',

  'regie.properties.hold.forever': 'Letztes Bild, bis die Quelle zurück ist',
  'regie.properties.hold.timed': 'Letztes Bild für {seconds} s',

  'regie.properties.scene.autoGridActive':
    'Auto-Grid aktiv: Die Quellen füllen das Raster in der Reihenfolge der Liste.',
  'regie.properties.scene.background': 'Hintergrund',
  'regie.properties.scene.colorLabel': 'Hintergrundfarbe',
  'regie.properties.scene.delete': 'Szene löschen',
  'regie.properties.scene.deleteButton': 'Szene löschen …',
  'regie.properties.scene.deleteHint': 'Entfernt die Szene mit allem Inhalt.',
  'regie.properties.scene.deleteHintLive': 'Die Live-Szene lässt sich nicht löschen.',
  'regie.properties.scene.deleteHintLiveDirect':
    'Die Live-Szene lässt sich nicht löschen. Andere Szenen lassen sich über ihr Menü unter Szenen löschen.',
  'regie.properties.scene.deleteMessage':
    '«{name}» wird gelöscht. Das lässt sich nicht rückgängig machen.',
  'regie.properties.scene.imageLabel': 'Hintergrundbild',
  'regie.properties.scene.imageMissing': 'Bild fehlt',
  'regie.properties.scene.imageNone': 'Kein Bild',
  'regie.properties.scene.name': 'Name',
  'regie.properties.scene.templatesHint': 'Eine Vorlage ordnet die sichtbaren Quellen der Szene an.',

  'regie.properties.section.background': 'Hintergrund',
  'regie.properties.section.failure': 'Wenn die Quelle ausfällt',
  'regie.properties.section.fit': 'Einpassen und Zuschnitt',
  'regie.properties.section.geometry': 'Position und Grösse',
  'regie.properties.section.layer': 'Ebene',
  'regie.properties.section.layout': 'Layout-Vorlagen',
  'regie.properties.section.style': 'Stil',
  'regie.properties.section.text': 'Text',
};
