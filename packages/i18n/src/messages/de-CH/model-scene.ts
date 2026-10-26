import type { Translation } from '../../types';
import type { modelScene as en } from '../en/model-scene';

export const modelScene: Translation<typeof en> = {
  'model.scene.field.borderWidth': 'Rahmenbreite',
  'model.scene.field.cornerRadius': 'Eckenradius',
  'model.scene.field.cropBottom': 'Zuschnitt unten',
  'model.scene.field.cropLeft': 'Zuschnitt links',
  'model.scene.field.cropRight': 'Zuschnitt rechts',
  'model.scene.field.cropTop': 'Zuschnitt oben',
  'model.scene.field.height': 'Höhe',
  'model.scene.field.width': 'Breite',
  'model.scene.field.x': 'X-Position',
  'model.scene.field.y': 'Y-Position',

  'model.scene.holdForever': 'Standbild halten',
  'model.scene.holdThenDim10': 'Standbild 10 s, dann abgedunkelt',
  'model.scene.holdThenDim3': 'Standbild 3 s, dann abgedunkelt',

  'model.scene.sourceMissing': 'Quelle fehlt',

  'model.scene.templateInfo.auto': 'ordnet sich nach aktiven Kameras',
  'model.scene.templateInfo.col': 'Präsentation mit zwei Personen',
  'model.scene.templateInfo.full': 'eine Quelle',
  'model.scene.templateInfo.grid': 'Panel oder Q&A',
  'model.scene.templateInfo.grid3': 'Galerie, viele Gäste',
  'model.scene.templateInfo.onetwo': 'Moderation und zwei Gäste',
  'model.scene.templateInfo.pip': 'Screen gross, Kamera in der Ecke',
  'model.scene.templateInfo.two': 'Interview, Gespräch',
  'model.scene.templateName.auto': 'Auto-Grid',
  'model.scene.templateName.col': 'Screen + Kamera-Spalte',
  'model.scene.templateName.colRow': 'Screen + Kamera-Reihe',
  'model.scene.templateName.full': 'Vollbild',
  'model.scene.templateName.grid': '2 × 2',
  'model.scene.templateName.grid3': '3 × 3',
  'model.scene.templateName.onetwo': 'Eins plus zwei',
  'model.scene.templateName.pip': 'Bild-in-Bild',
  'model.scene.templateName.two': 'Nebeneinander',
  'model.scene.templateName.twoStacked': 'Untereinander',

  'model.scene.validation.borderColor': 'Die Rahmenfarbe muss eine Hex-Farbe wie #e3b341 sein.',
  'model.scene.validation.cropAxisHorizontal':
    'Zuschnitt links und rechts zusammen muss kleiner als {max} sein.',
  'model.scene.validation.cropAxisVertical':
    'Zuschnitt oben und unten zusammen muss kleiner als {max} sein.',
  'model.scene.validation.cropSide': '{label} muss zwischen 0 und {max} liegen.',
  'model.scene.validation.fallbackMissing': 'Die Ersatzquelle gibt es nicht.',
  'model.scene.validation.fallbackSelf': 'Die Ersatzquelle darf nicht die eigene Quelle sein.',
  'model.scene.validation.fit': 'Einpassen muss «Füllen» oder «Ganz zeigen» sein.',
  'model.scene.validation.holdDuration':
    'Standbild-Dauer muss zwischen 0 und {max} s liegen (ganze Millisekunden).',
  'model.scene.validation.idMissing': 'Die Element-ID fehlt.',
  'model.scene.validation.integerRange':
    '{label} muss eine ganze Zahl zwischen {min} und {max} sein.',
  'model.scene.validation.rotation': 'Die Drehung muss 0, 90, 180 oder 270 Grad sein.',
  'model.scene.validation.sourceMissing': 'Das Element hat keine Quelle.',
};
