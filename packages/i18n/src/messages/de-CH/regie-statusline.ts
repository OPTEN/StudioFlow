import type { Translation } from '../../types';
import type { regieStatusline as en } from '../en/regie-statusline';

export const regieStatusline: Translation<typeof en> = {
  'regie.statusline.banner.connecting': 'Verbindet mit dem Server …',
  'regie.statusline.banner.mediaDegraded': 'Videoverbindung unterbrochen, verbindet neu …',
  'regie.statusline.banner.mediaReconnect': 'Neu verbinden',
  'regie.statusline.banner.mediaUnavailable':
    'Keine Videoverbindung: die Monitore zeigen kein Bild.',
  'regie.statusline.banner.offline': 'Keine Verbindung zum Server, die Regie verbindet neu …',
  'regie.statusline.banner.offlineSince':
    'Keine Verbindung zum Server, die Regie verbindet neu … Letzter Stand {time}.',

  'regie.statusline.incident.back': 'wieder da',
  'regie.statusline.incident.goneFor': 'war {seconds} s weg',
  'regie.statusline.incident.reshare': 'Neu teilen lassen',
  'regie.statusline.incident.reshareOffline':
    '{name} ist nicht verbunden. Bitte direkt am Gerät neu teilen.',
  'regie.statusline.incident.reshareSent': 'Bitte an {name} geschickt: «Bildschirm erneut teilen»',
  'regie.statusline.incident.seen': 'Gesehen',
  'regie.statusline.incident.show': '{code} {name} bei den Stationen zeigen',

  'regie.statusline.label': 'Meldungen',
  'regie.statusline.log': 'Letzte Ereignisse',
  'regie.statusline.offline': 'Keine Verbindung zum Server. Bitte gleich nochmals versuchen.',
  'regie.statusline.none': 'Keine offenen Meldungen',
};
