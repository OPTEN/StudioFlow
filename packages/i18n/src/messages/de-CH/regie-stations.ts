import type { Translation } from '../../types';
import type { regieStations as en } from '../en/regie-stations';

export const regieStations: Translation<typeof en> = {
  'regie.stations.ack.dismiss': 'Ausblenden',
  'regie.stations.ack.text': 'Das Gerät ist zurück.',

  'regie.stations.action.block': 'Gerät sperren',
  'regie.stations.action.manage': 'Gerät verwalten',
  'regie.stations.action.message': 'Nachricht senden',
  'regie.stations.action.reshare': 'Neu teilen lassen',
  'regie.stations.action.reshareCode': '{code} neu teilen lassen',
  'regie.stations.action.switchCamera': 'Kamera wechseln',
  'regie.stations.action.technical': 'Technische Details',
  'regie.stations.action.unblock': 'Entsperren',

  'regie.stations.composer.count':
    'Höchstens {max} Zeichen. Das Gerät zeigt die Nachricht als Banner.',
  'regie.stations.composer.label': 'Nachricht an {name}',
  'regie.stations.composer.placeholder': 'Kurze Nachricht an das Gerät',
  'regie.stations.composer.quick': 'Schnell senden: {text}',
  'regie.stations.composer.quickGroup': 'Schnellnachrichten, sofort gesendet',
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
  'regie.stations.detail.loss': 'Paketverlust',
  'regie.stations.detail.network': 'Netz',
  'regie.stations.detail.paired': 'Gekoppelt',
  'regie.stations.detail.resolution': 'Auflösung',
  'regie.stations.detail.tech': 'Technikcheck',
  'regie.stations.detail.techNotRun': 'noch nicht gelaufen',

  'regie.stations.dock.add': 'Gerät hinzufügen',
  'regie.stations.dock.addFirst': 'Erstes Gerät hinzufügen',
  'regie.stations.dock.emptyText':
    'Ein Handy als Kamera, einen Laptop, der seinen Bildschirm teilt, oder die Audiostation am Mischpult hinzufügen.',
  'regie.stations.dock.emptyTitle': 'Noch keine Geräte',
  'regie.stations.dock.loadingTitle': 'Geräte werden geladen …',
  'regie.stations.dock.offline':
    'Keine Verbindung zum Server. Die Schaltflächen funktionieren wieder, sobald er zurück ist.',

  'regie.stations.kind.audioStation': 'Audiostation',
  'regie.stations.kind.laptop': 'Laptop',
  'regie.stations.kind.phone': 'Handy',

  'regie.stations.line.back': 'wieder da',
  'regie.stations.line.battery': 'Akku {percent}',
  'regie.stations.line.cannotConnect': 'kann sich nicht verbinden',
  'regie.stations.line.freezeFrame': 'Standbild',
  'regie.stations.line.lastSeen': 'zuletzt {time}',
  'regie.stations.line.rateTitle': 'Upload-Rate',
  'regie.stations.line.rttTitle': 'Laufzeit zum Server und zurück',
  'regie.stations.line.sending': 'sendet',
  'regie.stations.line.wasGone': 'war {seconds} s weg',

  'regie.stations.nameHint': 'Enter speichert, Esc bricht ab.',
  'regie.stations.nameLabel': 'Name des Geräts',

  'regie.stations.network.cellular': 'Mobilfunk',
  'regie.stations.network.wifi': 'WLAN',

  'regie.stations.offer.text': 'Dieses Gerät kann eine fehlende Quelle ersetzen:',

  'regie.stations.paired.otherDay': '{day}.{month}. {time}',
  'regie.stations.paired.today': 'heute {time}',

  'regie.stations.quick.break': 'Pause',
  'regie.stations.quick.live': 'In 10 s live',
  'regie.stations.quick.smile': 'Bitte lächeln',

  'regie.stations.tag.live': 'Live',
  'regie.stations.tag.preview': 'Preview',

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
