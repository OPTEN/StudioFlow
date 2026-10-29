import type { Translation } from '../../types';
import type { regieStatusline as en } from '../en/regie-statusline';

export const regieStatusline: Translation<typeof en> = {
  'regie.statusline.audit': 'Protokoll',

  'regie.statusline.banner.connecting': 'Verbindet mit dem Server …',
  'regie.statusline.banner.mediaDegraded': 'Videoverbindung unterbrochen, verbindet neu …',
  'regie.statusline.banner.mediaReconnect': 'Neu verbinden',
  'regie.statusline.banner.mediaUnavailable':
    'Keine Videoverbindung: die Monitore zeigen kein Bild.',
  'regie.statusline.banner.offline': 'Keine Verbindung zum Server, die Regie verbindet neu …',
  'regie.statusline.banner.offlineSince':
    'Keine Verbindung zum Server, die Regie verbindet neu … Letzter Stand {time}.',

  'regie.statusline.health.issues': { one: '1 Störung', other: '{count} Störungen' },
  'regie.statusline.health.loading': 'Geräte werden geprüft …',
  'regie.statusline.health.none': 'Noch keine Geräte',
  'regie.statusline.health.ok': { one: '1 Gerät OK', other: 'Alle {count} Geräte OK' },

  'regie.statusline.incident.back': 'wieder da',
  'regie.statusline.incident.dismiss': 'Ausblenden',
  'regie.statusline.incident.dismissLater': 'Ausblenden (sobald es zurück ist)',
  'regie.statusline.incident.goneFor': 'war {seconds} s weg',
  'regie.statusline.incident.reshare': 'Neu teilen lassen',
  'regie.statusline.incident.reshareOffline':
    '{name} ist nicht verbunden. Bitte direkt am Gerät neu teilen.',
  'regie.statusline.incident.reshareSent': 'Bitte an {name} geschickt: «Bildschirm erneut teilen»',
  'regie.statusline.incident.show': 'Im Dock Geräte zeigen',
  'regie.statusline.incident.showDevice': 'Gerät zeigen',
  'regie.statusline.incident.timer': 'So lange dauert das Problem schon',

  'regie.statusline.issues.empty':
    'Alle Geräte senden. Ein Problem erscheint hier, sobald es auftritt.',
  'regie.statusline.issues.emptyTitle': 'Keine Störungen',
  'regie.statusline.issues.markAll': 'Alle als gesehen markieren',
  'regie.statusline.issues.monitoring': 'Monitoring öffnen',
  'regie.statusline.issues.more': { one: '+1 weitere', other: '+{count} weitere' },
  'regie.statusline.issues.noDevices':
    'Ein Gerät im Dock Geräte hinzufügen; sein Zustand erscheint dann hier.',
  'regie.statusline.issues.title': 'Störungen',

  'regie.statusline.label': 'Aktivität',
  'regie.statusline.latest': 'Letztes Ereignis',
  'regie.statusline.offline': 'Keine Verbindung zum Server. Bitte gleich nochmals versuchen.',
};
