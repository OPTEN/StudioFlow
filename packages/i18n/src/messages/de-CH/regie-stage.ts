import type { Translation } from '../../types';
import type { regieStage as en } from '../en/regie-stage';

export const regieStage: Translation<typeof en> = {
  'regie.stage.control.cut': 'Schnitt',
  'regie.stage.control.fade': 'Blende',
  'regie.stage.control.fadeDuration': 'Dauer der Blende',
  'regie.stage.control.fadeLonger': 'Blende länger',
  'regie.stage.control.fadeShorter': 'Blende kürzer',
  'regie.stage.control.space': 'Leerschlag',
  'regie.stage.control.studioMode': 'Studio-Modus',
  'regie.stage.control.take': 'Take',
  'regie.stage.control.transition': 'Übergang',
  'regie.stage.control.transitionKind': 'Art des Übergangs',

  'regie.stage.crop.bottom': 'U',
  'regie.stage.crop.left': 'L',
  'regie.stage.crop.right': 'R',
  'regie.stage.crop.summary': 'Zuschnitt {sides}',
  'regie.stage.crop.top': 'O',

  'regie.stage.editor.addSourceFirst': 'Erst eine Quelle hinzufügen',
  'regie.stage.editor.itemFallback': 'Element',
  'regie.stage.editor.itemLimit': {
    one: 'Eine Szene hat höchstens {count} Element.',
    other: 'Eine Szene hat höchstens {count} Elemente.',
  },
  'regie.stage.editor.itemRemoved': '{code} aus «{scene}» entfernt',
  'regie.stage.editor.liveLocked':
    'Diese Szene ist live. Erst eine andere Szene ins Program schalten.',
  'regie.stage.editor.liveUnchanged': 'Diese Szene ist live und bleibt unverändert',
  'regie.stage.editor.nothingToRedo': 'Nichts zum Wiederholen',
  'regie.stage.editor.nothingToUndo': 'Nichts zum Rückgängigmachen',
  'regie.stage.editor.offline':
    'Keine Verbindung zum Server. Änderungen gehen wieder, sobald die Regie verbunden ist.',
  'regie.stage.editor.redone': 'Wiederholt',
  'regie.stage.editor.sourceAdded': '{code} in «{scene}» eingefügt',
  'regie.stage.editor.sourceFallback': 'Quelle',
  'regie.stage.editor.templateApplied': 'Vorlage «{name}» angewendet',
  'regie.stage.editor.undo': 'Rückgängig',
  'regie.stage.editor.undone': 'Rückgängig gemacht',

  'regie.stage.monitor.connecting': 'Verbindet …',
  'regie.stage.monitor.liveEdit': 'Änderungen gehen sofort live',
  'regie.stage.monitor.liveNote':
    'Diese Szene ist gerade live. Bearbeiten geht erst, wenn eine andere Szene im Program ist.',
  'regie.stage.monitor.noScene': 'Keine Szene',
  'regie.stage.monitor.noSceneName': 'keine Szene',
  'regie.stage.monitor.preview': 'Preview',
  'regie.stage.monitor.previewLabel': 'Preview-Monitor: {name}',
  'regie.stage.monitor.program': 'Program',
  'regie.stage.monitor.programLabel': 'Program-Monitor: {name}, entspricht dem Output',

  'regie.stage.overlay.label':
    'Elemente der Szene. Ziehen zum Verschieben, Ecken zum Skalieren, Pfeiltasten zum Feinjustieren.',

  'regie.stage.previewOff.hint': 'Mit Studio-Modus erscheint hier die Preview.',
  'regie.stage.previewOff.title': 'Preview aus',

  'regie.stage.split.label': 'Grösse von Preview und Program',

  'regie.stage.switch.hintDirect': 'Klick auf eine Szene schaltet sie direkt live.',
  'regie.stage.switch.hintStudio':
    'Klick auf eine Szene lädt sie in die Preview. Take schaltet live.',
  'regie.stage.switch.live': '«{name}» ist live',
  'regie.stage.switch.offline':
    'Keine Verbindung zum Server. Schalten geht wieder, sobald die Regie verbunden ist.',
  'regie.stage.switch.studioOff': 'Studio-Modus aus: Szenen schalten direkt live',
  'regie.stage.switch.studioOn': 'Studio-Modus an: Preview und Take',

  'regie.stage.view.label': 'Szene',
};
