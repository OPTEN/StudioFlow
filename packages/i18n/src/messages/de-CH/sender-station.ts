import type { Translation } from '../../types';
import type { senderStation as en } from '../en/sender-station';

export const senderStation: Translation<typeof en> = {
  'sender.station.banner.offline':
    'Offline: keine Netzwerkverbindung. StudioFlow verbindet sich von selbst neu, sobald das Netz zurück ist.',
  'sender.station.banner.paired': 'Gekoppelt. Die Kamera startet, die Regie sieht das Bild jetzt.',
  'sender.station.banner.pairedAs':
    'Gekoppelt als {code}. Die Kamera startet, die Regie sieht das Bild jetzt.',
  'sender.station.banner.reload': 'Jetzt neu laden',
  'sender.station.banner.unreachable':
    'Der Server ist nicht erreichbar. StudioFlow versucht es weiter.',
  'sender.station.banner.update': 'Neue Version bereit – nach der Sendung neu laden',

  'sender.station.blocked.hint':
    'StudioFlow prüft alle 15 Sekunden, ob das Gerät wieder freigegeben ist.',
  'sender.station.blocked.text':
    'Die Regie hat dieses Gerät gesperrt. Kamera und Bildschirm sind aus. Sobald die Regie es wieder freigibt, geht es hier von selbst weiter.',
  'sender.station.blocked.title': 'Dieses Gerät ist gesperrt',

  'sender.station.connection.blocked': 'Gesperrt',
  'sender.station.connection.connected': 'Verbunden',
  'sender.station.connection.connecting': 'Verbindet …',
  'sender.station.connection.offline': 'Offline',
  'sender.station.connection.reconnecting': 'Verbindet neu …',
  'sender.station.connection.removed': 'Nicht mehr gekoppelt',
  'sender.station.connection.replaced': 'In einem anderen Tab geöffnet',

  'sender.station.error.cameraLimit': 'Dieses Gerät hat schon eine Kamera.',
  'sender.station.error.phoneCamera':
    'Die Kamera eines Handys lässt sich nicht entfernen. Die Regie kann das ganze Gerät entfernen.',
  'sender.station.error.phoneScreen':
    'Ein Handy kann keinen Bildschirm teilen. Dafür bitte einen Laptop koppeln.',
  'sender.station.error.screenLimit': 'Pro Gerät sind höchstens {max} Bildschirme möglich.',
  'sender.station.error.screenMoved':
    'Bitte bei «Bildschirm {number}» noch einmal auf «Bildschirm teilen» klicken.',

  'sender.station.laptop.addCamera': 'Kamera hinzufügen',
  'sender.station.laptop.addScreen': '+ weiteren Bildschirm',
  'sender.station.laptop.later': 'Später',
  'sender.station.laptop.noScreenShare':
    'Bildschirm teilen geht nur auf Laptops und Desktop-Browsern. Auf diesem Gerät kannst du die Kamera senden.',
  'sender.station.laptop.paired': 'Gekoppelt',
  'sender.station.laptop.pairedLead':
    '«{name}» ist mit der Regie verbunden. Beim nächsten Mal erkennt StudioFlow diesen Laptop wieder.',
  'sender.station.laptop.pairedWith': 'Gekoppelt mit «{production}».',
  'sender.station.laptop.reshare': 'Die Regie bittet dich, den Bildschirm erneut zu teilen',
  'sender.station.laptop.shareAgain': 'Erneut teilen',
  'sender.station.laptop.shareScreen': 'Bildschirm teilen',
  'sender.station.laptop.sources': 'Quellen dieses Laptops',
  'sender.station.laptop.startCamera': 'Kamera starten',
  'sender.station.laptop.stopCamera': 'Kamera beenden',
  'sender.station.laptop.stopSharing': 'Teilen beenden',
  'sender.station.laptop.tryAgain': 'Erneut versuchen',
  'sender.station.laptop.video': 'Video im Bildschirm',
  'sender.station.laptop.videoHint':
    '30 Bilder pro Sekunde für ein Video in diesem Bildschirm. Das braucht mehr Rechenleistung.',

  'sender.station.message.title': 'Nachricht der Regie',

  'sender.station.remote.adjusted': 'Die Regie hat die Kamera angepasst',
  'sender.station.remote.lens': 'Die Regie hat das Objektiv gewechselt',
  'sender.station.remote.refused': 'Die Kamera konnte die Änderung der Regie nicht übernehmen',
  'sender.station.remote.reset': 'Die Regie hat die Kamera auf automatisch zurückgestellt',
  'sender.station.remote.zoom': 'Die Regie hat gezoomt: {zoom}×',

  'sender.station.phone.back': 'Rück',
  'sender.station.phone.cameraLegend': 'Kamera',
  'sender.station.phone.controls': 'Kamera steuern',
  'sender.station.phone.dark': 'Dunkel',
  'sender.station.phone.front': 'Front',
  'sender.station.phone.off': 'Die Kamera ist aus.',
  'sender.station.phone.previewLabel': 'Vorschau der Kamera',
  'sender.station.phone.resolutionLegend': 'Auflösung',
  'sender.station.phone.start': 'Kamera starten',
  'sender.station.phone.starting': 'Kamera startet …',
  'sender.station.phone.stop': 'Kamera stoppen',
  'sender.station.phone.tapHint': 'Tippen zum Bedienen',
  'sender.station.phone.tryAgain': 'Erneut versuchen',

  'sender.station.replaced.takeOver': 'Hier weitermachen',
  'sender.station.replaced.text':
    'Diese Station läuft jetzt in einem anderen Tab oder Fenster. Dieser Tab bleibt aus, damit sich die beiden nicht gegenseitig trennen.',
  'sender.station.replaced.title': 'In einem anderen Tab geöffnet',

  'sender.station.slot.camera': 'Kamera',
  'sender.station.slot.ended': 'Teilen beendet',
  'sender.station.slot.failedCamera': 'Kamera ausgefallen',
  'sender.station.slot.failedScreen': 'Teilen fehlgeschlagen',
  'sender.station.slot.idleCamera': 'Kamera ist aus',
  'sender.station.slot.idleScreen': 'Bereit zum Teilen',
  'sender.station.slot.liveCamera': 'Kamera sendet',
  'sender.station.slot.liveScreen': 'Wird geteilt',
  'sender.station.slot.paused': 'Pausiert, das Bild kommt gleich zurück',
  'sender.station.slot.screen': 'Bildschirm {number}',
  'sender.station.slot.startingCamera': 'Kamera startet …',
  'sender.station.slot.startingScreen': 'Freigabe startet …',
  'sender.station.slot.tagNext': 'Als Nächstes',

  'sender.station.starting': 'Station startet',

  'sender.station.tally.preview': 'Als Nächstes',
  'sender.station.tally.spokenOff': 'Nicht auf Sendung.',
  'sender.station.tally.spokenPreview': 'Als Nächstes: Dieses Gerät ist in der Preview.',
  'sender.station.tally.spokenProgram': 'Live: Dieses Gerät ist jetzt im Program.',
};
