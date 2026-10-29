import type { Translation } from '../../types';
import type { senderStation as en } from '../en/sender-station';

export const senderStation: Translation<typeof en> = {
  'sender.station.banner.broken':
    'Diese Version hat ein Problem. Lade die Seite neu, um weiterzumachen.',
  'sender.station.banner.offline':
    'Offline: keine Netzwerkverbindung. StudioFlow verbindet sich von selbst neu, sobald das Netz zurück ist.',
  'sender.station.banner.paired': 'Gekoppelt. Die Regie sieht das Bild, sobald die Kamera läuft.',
  'sender.station.banner.pairedAs':
    'Gekoppelt als {code}. Die Regie sieht das Bild, sobald die Kamera läuft.',
  'sender.station.banner.pairedComputer':
    'Gekoppelt. Beim nächsten Mal erkennt StudioFlow diesen Computer von selbst.',
  'sender.station.banner.reload': 'Jetzt neu laden …',
  'sender.station.banner.reloadConfirm':
    'Neu laden unterbricht Kamera, Ton und Bildschirm teilen für einige Sekunden.',
  'sender.station.banner.reloadNow': 'Neu laden',
  'sender.station.banner.unreachable':
    'Der Server ist nicht erreichbar. StudioFlow versucht es weiter.',
  'sender.station.banner.update':
    'Eine neue Version ist bereit. Sie wird nach der Sendung von selbst installiert.',

  'sender.station.blocked.next':
    'Bitte die Person in der Regie, es freizugeben. Diese Seite macht danach von selbst weiter.',
  'sender.station.blocked.text':
    'Die Regie hat dieses Gerät gesperrt. Kamera, Bildschirm und Ton sind aus.',
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
  'sender.station.laptop.addScreen': 'Weiteren Bildschirm teilen',
  'sender.station.laptop.addScreenWait': 'Teile zuerst den Bildschirm, der bereit ist.',
  'sender.station.laptop.later': 'Nicht jetzt',
  'sender.station.laptop.more': 'Mehr zu {name}',
  'sender.station.laptop.noScreenShare':
    'Dieser Browser kann keinen Bildschirm teilen. Öffne die Seite in Chrome, Edge oder Firefox auf einem Laptop.',
  'sender.station.laptop.pairedWith': 'Gekoppelt mit «{production}».',
  'sender.station.laptop.remove': 'Aus der Regie entfernen …',
  'sender.station.laptop.removeConfirm':
    '{name} verschwindet aus der Regie und aus jeder Szene, die es zeigt.',
  'sender.station.laptop.removeTitle': '{name} entfernen?',
  'sender.station.laptop.reshare': 'Die Regie bittet dich, diesen Bildschirm erneut zu teilen',
  'sender.station.laptop.shareAgain': 'Erneut teilen',
  'sender.station.laptop.shareScreen': 'Bildschirm teilen',
  'sender.station.laptop.smooth': 'Flüssige Bewegung',
  'sender.station.laptop.smoothHint': 'Für Videos: 30 statt 15 Bilder pro Sekunde.',
  'sender.station.laptop.sources': 'Was dieser Laptop sendet',
  'sender.station.laptop.startCamera': 'Kamera starten',
  'sender.station.laptop.stopCamera': 'Kamera beenden',
  'sender.station.laptop.stopLive': '{name} ist live. Beenden schneidet das Bild aus der Sendung.',
  'sender.station.laptop.stopSharing': 'Teilen beenden',
  'sender.station.laptop.stopTitle': '{name} stoppen, während es live ist?',
  'sender.station.laptop.tryAgain': 'Erneut versuchen',
  'sender.station.laptop.videoHint':
    'Flüssige Bewegung: 30 Bilder pro Sekunde für ein Video in diesem Bildschirm. Das braucht mehr Rechenleistung.',

  'sender.station.message.dismiss': 'Ausblenden',
  'sender.station.message.title': 'Nachricht der Regie',

  'sender.station.remote.adjusted': 'Die Regie hat die Kamera angepasst',
  'sender.station.remote.lens': 'Die Regie hat das Objektiv gewechselt',
  'sender.station.remote.refused': 'Die Kamera konnte die Änderung der Regie nicht übernehmen',
  'sender.station.remote.reset': 'Die Regie hat die Kamera auf automatisch zurückgestellt',
  'sender.station.remote.zoom': 'Die Regie hat gezoomt: {zoom}×',

  'sender.station.phone.back': 'Rückkamera',
  'sender.station.phone.controls': 'Kamera steuern',
  'sender.station.phone.done': 'Fertig',
  'sender.station.phone.front': 'Frontkamera',
  'sender.station.phone.off': 'Die Kamera ist aus.',
  'sender.station.phone.offHint': 'Starte sie, sobald das Handy am richtigen Platz ist.',
  'sender.station.phone.previewLabel': 'Vorschau der Kamera',
  'sender.station.phone.quality': 'Qualität',
  'sender.station.phone.qualityHigh': 'Hoch',
  'sender.station.phone.qualityHighHint': '1080p. Schärfer; braucht ein gutes WLAN und mehr Akku.',
  'sender.station.phone.qualityLive':
    'Du bist live: Das Bild stockt kurz, wenn sich die Qualität ändert.',
  'sender.station.phone.qualityName': 'Bildqualität: {quality}',
  'sender.station.phone.qualityStandard': 'Normal',
  'sender.station.phone.qualityStandardHint': '720p. Läuft gut in den meisten WLANs.',
  'sender.station.phone.qualityTitle': 'Bildqualität',
  'sender.station.phone.screenOff': 'Bildschirm aus',
  'sender.station.phone.screenOffHint': 'Die Kamera sendet weiter.',
  'sender.station.phone.start': 'Kamera starten',
  'sender.station.phone.starting': 'Kamera startet …',
  'sender.station.phone.stop': 'Kamera stoppen',
  'sender.station.phone.stopConfirm':
    'Die Regie zeigt diese Kamera gerade. Stoppen schneidet das Bild aus der Sendung.',
  'sender.station.phone.stopTitle': 'Kamera stoppen, während sie live ist?',
  'sender.station.phone.switch': 'Kamera wechseln',
  'sender.station.phone.switchConfirm':
    'Die Sendung zeigt sofort die andere Kamera. Ein Zoom der Regie wird zurückgesetzt.',
  'sender.station.phone.switchTitle': 'Kamera wechseln, während sie live ist?',
  'sender.station.phone.tapHint': 'Tippen, um die Bedienung zu zeigen',
  'sender.station.phone.tryAgain': 'Erneut versuchen',

  'sender.station.replaced.takeOver': 'Hier weitermachen',
  'sender.station.replaced.takeOverHint': 'Der andere Tab hört dann auf zu senden.',
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

  'sender.station.starting': 'Station startet',
  'sender.station.startingSlow':
    'Das dauert länger als üblich. Prüfe das WLAN; StudioFlow versucht es weiter.',

  'sender.station.tab.message': 'Nachricht',

  'sender.station.tally.live': 'Live',
  'sender.station.tally.preview': 'Preview',
  'sender.station.tally.previewHint':
    'Die Regie hält dieses Bild bereit, um es als Nächstes live zu schalten.',
  'sender.station.tally.spokenOff': 'Nicht auf Sendung.',
  'sender.station.tally.spokenPreview':
    'Preview: Dieses Gerät ist bereit, als Nächstes live zu gehen.',
  'sender.station.tally.spokenProgram': 'Live: Dieses Gerät ist jetzt im Program.',
};
