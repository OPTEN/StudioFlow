import type { Translation } from '../../types';
import type { regieStations as en } from '../en/regie-stations';

export const regieStations: Translation<typeof en> = {
  'regie.stations.ack.seen': 'Gesehen',
  'regie.stations.ack.text': 'Die Station ist zurück. Bestätigen, damit die Meldung verschwindet.',

  'regie.stations.action.block': 'Gerät sperren',
  'regie.stations.action.message': 'Nachricht senden',
  'regie.stations.action.reshare': 'Neu teilen lassen',
  'regie.stations.action.reshareCode': '{code} neu teilen lassen',
  'regie.stations.action.switchCamera': 'Kamera wechseln',
  'regie.stations.action.unblock': 'Entsperren',

  'regie.stations.composer.label': 'Nachricht an {name}',
  'regie.stations.composer.placeholder': 'Kurze Nachricht an die Station',
  'regie.stations.composer.quick': 'Schnell senden: {text}',
  'regie.stations.composer.send': 'Senden',

  'regie.stations.confirm.blockMessage':
    '{label} wird sofort getrennt und kann sich nicht mehr verbinden, bis du es entsperrst.',
  'regie.stations.confirm.blockNow': 'Jetzt sperren',
  'regie.stations.confirm.removeLabel': 'Gerät entfernen',
  'regie.stations.confirm.removeMessage':
    '«{name}» wird entfernt. Elemente mit seinen Quellen zeigen danach «Quelle fehlt». Neu koppeln geht jederzeit.',

  'regie.stations.detail.battery': 'Akku',
  'regie.stations.detail.charging': '{battery} · lädt',
  'regie.stations.detail.device': 'Gerät',
  'regie.stations.detail.lastSeen': 'Zuletzt',
  'regie.stations.detail.loss': 'Verlust',
  'regie.stations.detail.network': 'Netz',
  'regie.stations.detail.paired': 'Gekoppelt',
  'regie.stations.detail.resolution': 'Auflösung',
  'regie.stations.detail.tech': 'Technik',
  'regie.stations.detail.techNotRun': 'noch nicht gelaufen',

  'regie.stations.dock.emptyText':
    'Mit «Gerät koppeln» ein Handy als Kamera oder einen Laptop mit Bildschirm verbinden.',
  'regie.stations.dock.emptyTitle': 'Noch keine Stationen.',
  'regie.stations.dock.loadingTitle': 'Stationen werden geladen …',
  'regie.stations.dock.pair': 'Gerät koppeln',

  'regie.stations.line.back': 'wieder da',
  'regie.stations.line.battery': 'Akku {percent}',
  'regie.stations.line.cannotConnect': 'kann sich nicht verbinden',
  'regie.stations.line.freezeFrame': 'Standbild',
  'regie.stations.line.lastSeen': 'zuletzt {time}',
  'regie.stations.line.wasGone': 'war {seconds} s weg',

  'regie.stations.nameLabel': 'Name der Station',

  'regie.stations.network.cellular': 'Mobilfunk',
  'regie.stations.network.wifi': 'WLAN',

  'regie.stations.paired.otherDay': '{day}.{month}. {time}',
  'regie.stations.paired.today': 'heute {time}',

  'regie.stations.quick.break': 'Pause',
  'regie.stations.quick.live': 'In 10 s live',
  'regie.stations.quick.smile': 'Bitte lächeln',

  'regie.stations.tech.bad': 'schlecht',
  'regie.stations.tech.camera': 'Kamera',
  'regie.stations.tech.network': 'Netz',
  'regie.stations.tech.ok': 'ok',
  'regie.stations.tech.upload': 'Upload',
  'regie.stations.tech.warn': 'knapp',

  'regie.stations.toast.blocked': '{label} gesperrt und getrennt',
  'regie.stations.toast.cameraOffline':
    '{name} ist nicht verbunden. Die Kamera bleibt, wie sie ist.',
  'regie.stations.toast.cameraSwitching': '{label}: Kamera wird gewechselt',
  'regie.stations.toast.messageLength': 'Eine Nachricht hat 1 bis {max} Zeichen.',
  'regie.stations.toast.messageOffline':
    '{name} ist nicht verbunden. Die Nachricht kommt nicht an.',
  'regie.stations.toast.messageSent': 'Nachricht an {name} geschickt: «{message}»',
  'regie.stations.toast.nameLength': 'Der Name braucht 1 bis {max} Zeichen.',
  'regie.stations.toast.removed': '«{name}» entfernt',
  'regie.stations.toast.reshareOffline':
    '{label} ist nicht verbunden. Bitte direkt am Gerät neu teilen.',
  'regie.stations.toast.reshareSent': 'Bitte an {label} geschickt: «Bildschirm erneut teilen»',
  'regie.stations.toast.unblocked': '{label} entsperrt',
};
