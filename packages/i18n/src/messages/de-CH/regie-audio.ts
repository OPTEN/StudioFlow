import type { Translation } from '../../types';
import type { regieAudio as en } from '../en/regie-audio';

export const regieAudio: Translation<typeof en> = {
  'regie.audio.dock.emptyText':
    'Eine Audiostation oder ein Mikrofon koppeln, einen Bildschirm mit Ton teilen oder ein Video mit Ton hochladen.',
  'regie.audio.dock.emptyTitle': 'Noch keine Tonquellen.',
  'regie.audio.dock.loadingTitle': 'Ton wird geladen …',
  'regie.audio.dock.monitor': 'Abhören',
  'regie.audio.dock.redo': 'Mischpult-Änderung wiederholen',
  'regie.audio.dock.shortcut': 'Kanal auswählen und mit M stummschalten.',
  'regie.audio.dock.suspended': 'Die Pegelanzeigen starten mit dem ersten Klick auf diese Seite.',
  'regie.audio.dock.undo': 'Mischpult-Änderung rückgängig machen',
  'regie.audio.dock.unavailable':
    'Dieser Browser hat kein Web Audio, daher gibt es keine Pegelanzeigen.',

  'regie.audio.history.nothingToRedo': 'Im Mischpult gibt es nichts zu wiederholen',
  'regie.audio.history.nothingToUndo': 'Im Mischpult gibt es nichts rückgängig zu machen',
  'regie.audio.history.redone': 'Mischpult-Änderung wiederholt',
  'regie.audio.history.undone': 'Mischpult-Änderung rückgängig gemacht',

  'regie.audio.mode.always': 'Immer',
  'regie.audio.mode.alwaysHint': 'Hörbar, solange die Sendung live ist',
  'regie.audio.mode.follow': 'Mit Bild',
  'regie.audio.mode.followHint': 'Hörbar, solange sein Bild im Program ist',
  'regie.audio.mode.off': 'Aus',
  'regie.audio.mode.offHint': 'Nie hörbar',

  'regie.audio.monitor.channel': 'PFL: {name}',
  'regie.audio.monitor.device': 'Ausgabegerät',
  'regie.audio.monitor.deviceDefault': 'Standardausgabe',
  'regie.audio.monitor.deviceFailed': 'Das Ausgabegerät konnte nicht verwendet werden.',
  'regie.audio.monitor.deviceNamed': 'Ausgabe {number}',
  'regie.audio.monitor.deviceUnsupported':
    'Dieser Browser spielt das Abhören nur auf der Standardausgabe ab.',
  'regie.audio.monitor.hint':
    'Das Abhören ist aus. Kopfhörer verwenden: Das Program auf Lautsprechern koppelt in die Mikrofone zurück.',
  'regie.audio.monitor.off': 'Aus',
  'regie.audio.monitor.program': 'Program',
  'regie.audio.monitor.title': 'Abhören',

  'regie.audio.output.blocked': 'Ton blockiert',
  'regie.audio.output.blockedHint':
    'Die Ausgabeseite kann noch keinen Ton abspielen. Die Ausgabeseite einmal anklicken oder Autoplay dafür erlauben.',

  'regie.audio.program.label': 'Ton',
  'regie.audio.program.title': 'Pegel des Program-Tons',

  'regie.audio.role.microphone': 'Mikrofon',
  'regie.audio.role.screen': 'Bildschirmton',
  'regie.audio.role.station': 'Audiostation',
  'regie.audio.role.video': 'Videoton',

  'regie.audio.row.details': 'Modus und Laufzeitversatz von {name}',
  'regie.audio.row.error': 'Die Mischpult-Änderung wurde nicht gespeichert.',
  'regie.audio.row.fader': 'Pegel von {name}',
  'regie.audio.row.faderText': '{value} dB',
  'regie.audio.row.group': 'Tonkanal {name}',
  'regie.audio.row.mode': 'Modus',
  'regie.audio.row.mute': 'M',
  'regie.audio.row.muteName': '{name} stummschalten',
  'regie.audio.row.pfl': 'PFL',
  'regie.audio.row.pflStop': 'Abhören von {name} beenden',
  'regie.audio.row.pflStart': '{name} vor dem Fader abhören',
  'regie.audio.row.resetHint': 'Doppelklick für 0 dB',
  'regie.audio.row.sync': 'Laufzeitversatz',
  'regie.audio.row.syncHint':
    'Verzögert den Ton, damit er zu einem später ankommenden Bild passt (0–500 ms).',
  'regie.audio.row.syncUnit': 'ms',
  'regie.audio.row.unmuteName': 'Stummschaltung von {name} aufheben',

  'regie.audio.state.muted': 'stumm',
  'regie.audio.state.noSound': 'kein Ton',
  'regie.audio.state.silent': 'seit 10 s kein Signal',
};
