import type { Translation } from '../../types';
import type { regieStage as en } from '../en/regie-stage';

export const regieStage: Translation<typeof en> = {
  'regie.stage.control.cut': 'Schnitt',
  'regie.stage.control.cutDuration': 'Ein Schnitt schaltet sofort und hat keine Dauer.',
  'regie.stage.control.duration': 'Dauer',
  'regie.stage.control.fade': 'Blende',
  'regie.stage.control.fadeDuration': 'Dauer der Blende',
  'regie.stage.control.fadeLonger': 'Blende länger',
  'regie.stage.control.fadeShorter': 'Blende kürzer',
  'regie.stage.control.noAudio': 'Noch keine Tonquellen',
  'regie.stage.control.programAudio': 'Program-Ton',
  'regie.stage.control.programAudioTitle': 'Spitzenpegel dessen, was der Output abspielt',
  'regie.stage.control.silent': 'Stille',
  'regie.stage.control.space': 'Leerschlag',
  'regie.stage.control.studioMode': 'Studio-Modus',
  'regie.stage.control.take': 'Take',
  'regie.stage.control.takeFading': 'Blende läuft …',
  'regie.stage.control.takeNoPreview': 'Keine Szene in der Preview',
  'regie.stage.control.takeOffline': 'Keine Verbindung zum Server',
  'regie.stage.control.takeSame': 'Die Preview ist schon live',
  'regie.stage.control.takeSwitching': 'Schaltet …',
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
  'regie.stage.monitor.hidden': '{count} ausgeblendet',
  'regie.stage.monitor.liveEdit': 'Änderungen gehen sofort live',
  'regie.stage.monitor.liveNote':
    'Diese Szene ist gerade live. Bearbeiten geht erst, wenn eine andere Szene im Program ist.',
  'regie.stage.monitor.locked': 'Live, nicht bearbeitbar',
  'regie.stage.monitor.noScene': 'Noch keine Szene',
  'regie.stage.monitor.noSceneHint': 'Füge im Dock «Szenen» eine Szene hinzu.',
  'regie.stage.monitor.noSceneName': 'keine Szene',
  'regie.stage.monitor.preview': 'Preview',
  'regie.stage.monitor.previewLabel': 'Preview-Monitor: {name}',
  'regie.stage.monitor.program': 'Program',
  'regie.stage.monitor.programLabel': 'Program-Monitor: {name}, entspricht dem Output',

  'regie.stage.overlay.label':
    'Elemente der Szene. Ziehen zum Verschieben, Ecken zum Skalieren, Pfeiltasten zum Feinjustieren.',
  'regie.stage.overlay.locked': 'Gesperrt. In den Quellen entsperren, um es zu verschieben.',

  'regie.stage.previewOff.action': 'Studio-Modus einschalten',
  'regie.stage.previewOff.hint':
    'Ein Klick auf eine Szene geht sofort live. Schalte ihn ein, um die nächste Szene zuerst in der Preview vorzubereiten.',
  'regie.stage.previewOff.state': 'Aus',
  'regie.stage.previewOff.title': 'Studio-Modus ist aus',

  'regie.stage.split.label': 'Grösse von Preview und Program',

  'regie.stage.switch.hintDirect': 'Ein Klick schaltet die Szene sofort live.',
  'regie.stage.switch.hintStudio': 'Ein Klick lädt die Szene in die Preview.',
  'regie.stage.switch.live': '«{name}» ist live',
  'regie.stage.switch.offline':
    'Keine Verbindung zum Server. Schalten geht wieder, sobald die Regie verbunden ist.',
  'regie.stage.switch.studioOff':
    'Studio-Modus ist aus. Ein Klick auf eine Szene geht sofort live.',
  'regie.stage.switch.studioOn': 'Studio-Modus ist an. Take schaltet die Preview live.',

  'regie.stage.view.label': 'Szene',
};
