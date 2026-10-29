import type { Translation } from '../../types';
import type { senderAudio as en } from '../en/sender-audio';

export const senderAudio: Translation<typeof en> = {
  'sender.audio.add': 'Mikrofon hinzufügen',

  'sender.audio.error.micLimit': 'Dieses Gerät hat schon ein Mikrofon.',

  'sender.audio.input': 'Audioeingang',
  'sender.audio.input.default': 'Standardeingang',
  'sender.audio.input.unnamed': 'Eingang {number}',

  'sender.audio.level': 'Eingangspegel',
  'sender.audio.level.silent': 'Kein Ton',
  'sender.audio.level.suspended':
    'Klicke oder tippe irgendwo auf diese Seite, um die Pegelanzeige zu starten.',
  'sender.audio.level.value': '{db} dB',

  'sender.audio.live': 'Mikrofon live',
  'sender.audio.liveSpoken': 'Das Mikrofon ist im Program live.',

  'sender.audio.note.station':
    'Stereo, unverändert gesendet: Echounterdrückung, Rauschunterdrückung und automatische Verstärkung sind aus.',
  'sender.audio.note.voice': 'Der Browser reduziert Echo und Hintergrundgeräusche.',

  'sender.audio.phone.label': 'Mikrofon',

  'sender.audio.silent':
    'Seit einer Weile kein Signal. Kabel und Ausgang des Mischpults oder den gewählten Eingang prüfen.',
  'sender.audio.silentVoice':
    'Seit einer Weile kein Ton. Ist das Mikrofon stummgeschaltet oder der falsche Eingang gewählt?',

  'sender.audio.start': 'Mikrofon einschalten',
  'sender.audio.stop': 'Mikrofon ausschalten',

  'sender.audio.state.ended': 'Ausgeschaltet',
  'sender.audio.state.failed': 'Funktioniert nicht',
  'sender.audio.state.idle': 'Aus',
  'sender.audio.state.live': 'Sendet',
  'sender.audio.state.paused': 'Pausiert',
  'sender.audio.state.starting': 'Startet …',

  'sender.audio.station.hint':
    'Den Ausgang des Mischpults mit einem Eingang dieses Computers verbinden und den Eingang oben wählen. Der Ton startet von selbst, solange diese Seite offen ist.',
  'sender.audio.station.lead': 'Sendet den Ton des Mischpults an die Regie.',
  'sender.audio.station.start': 'Ton senden',
  'sender.audio.station.stop': 'Ton nicht mehr senden',
  'sender.audio.station.stopConfirm':
    'Die Sendung verwendet diesen Ton gerade. Wenn du ihn stoppst, ist die Sendung still.',
  'sender.audio.station.title': 'Ton vom Mischpult',

  'sender.audio.title': 'Mikrofon',

  'sender.audio.screen.explain':
    'Chrome und Edge unter Windows können den Ton des ganzen Computers teilen, wenn du den ganzen Bildschirm teilst. Sonst lässt sich nur der Ton eines geteilten Browser-Tabs teilen: Im Dialog «Auch Tab-Audio teilen» ankreuzen. Firefox und Safari teilen keinen Ton.',
  'sender.audio.screen.help': 'Welche Browser teilen Ton?',
  'sender.audio.screen.label': 'Mit Ton',
  'sender.audio.screen.noSound':
    'Mit diesem Bildschirm wird kein Ton geteilt. Erneut teilen und im Dialog des Browsers die Ton-Option ankreuzen. Sie gibt es für einen Browser-Tab und unter Windows für einen ganzen Bildschirm.',
  'sender.audio.screen.withSound': 'mit Ton',
};
