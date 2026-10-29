import type { Translation } from '../../types';
import type { senderPairing as en } from '../en/sender-pairing';

export const senderPairing: Translation<typeof en> = {
  'sender.pairing.redeem.alreadyAgain': 'Neu koppeln …',
  'sender.pairing.redeem.alreadyConfirm':
    'Neu koppeln entfernt dieses Gerät aus der Regie, mit seinen Quellen und ihren Plätzen in den Szenen. Die neue Einladung koppelt es danach als neues Gerät.',
  'sender.pairing.redeem.alreadyConfirmAction': 'Neu koppeln',
  'sender.pairing.redeem.alreadyStation': 'Zur Station',
  'sender.pairing.redeem.alreadyText':
    'Dieses Gerät ist bereits mit der Regie gekoppelt. Mach damit weiter oder kopple es mit der neuen Einladung neu.',
  'sender.pairing.redeem.alreadyTitle': 'Schon gekoppelt',
  'sender.pairing.redeem.expiredLink':
    'Dieser Link ist abgelaufen oder wurde schon verwendet. Bitte in der Regie um einen neuen Link oder kopple mit einem Prüfcode.',
  'sender.pairing.redeem.expiredQr':
    'Dieser QR-Code ist abgelaufen oder wurde schon verwendet. Bitte die Regie, einen neuen anzuzeigen, und scanne ihn mit der Kamera-App.',
  'sender.pairing.redeem.expiredTitle': 'Einladung abgelaufen',
  'sender.pairing.redeem.failedTitle': 'Koppeln hat nicht geklappt',
  'sender.pairing.redeem.pairWithCode': 'Mit Prüfcode koppeln',
  'sender.pairing.redeem.pairingSlow':
    'Der Server antwortet noch nicht. StudioFlow versucht es etwa eine Minute lang weiter.',
  'sender.pairing.redeem.pairingStatus': 'Einen Moment, das Gerät meldet sich bei der Regie an.',
  'sender.pairing.redeem.pairingTitle': 'Wird gekoppelt …',
  'sender.pairing.redeem.retry': 'Erneut versuchen',

  'sender.pairing.start.codeTitle': 'Kein QR-Code? Mit Prüfcode koppeln',
  'sender.pairing.start.insecure':
    'Diese Seite ist nicht über eine sichere Verbindung geöffnet, darum sperrt der Browser Kamera, Mikrofon und Bildschirm teilen. Öffne die Adresse, die mit https beginnt.',
  'sender.pairing.start.kindAudioStation': 'Audiostation',
  'sender.pairing.start.kindAudioStationHint': 'Sendet den Ton des Mischpults.',
  'sender.pairing.start.kindLaptop': 'Laptop-Bildschirm',
  'sender.pairing.start.kindLaptopHint': 'Teilt Bildschirme und auf Wunsch Kamera oder Mikrofon.',
  'sender.pairing.start.kindLegend': 'Was sendet dieses Gerät?',
  'sender.pairing.start.kindPhone': 'Handy-Kamera',
  'sender.pairing.start.kindPhoneHint': 'Filmt mit der Kamera, für ein Handy auf einem Stativ.',
  'sender.pairing.start.lead':
    'Gib diesem Gerät einen Namen und wähle, was es sendet. Jemand in der Regie gibt es danach mit einem Prüfcode frei.',
  'sender.pairing.start.nameExample': 'Zum Beispiel «Laptop Anna» oder «Handy Bühne links».',
  'sender.pairing.start.nameLabel': 'Name des Geräts',
  'sender.pairing.start.nameRequired': 'Bitte einen Namen eingeben.',
  'sender.pairing.start.nameTooLong': 'Höchstens {max} Zeichen.',
  'sender.pairing.start.noScreenShare':
    'Dieser Browser kann keinen Bildschirm teilen. Öffne die Seite in Chrome, Edge oder Firefox auf einem Laptop oder sende die Kamera dieses Geräts.',
  'sender.pairing.start.qrText':
    'Öffne die Kamera-App dieses Handys und richte sie auf den Code im Bereich Geräte. Das Handy startet danach von selbst als Kamera.',
  'sender.pairing.start.qrTitle': 'Scanne den QR-Code, den die Regie zeigt',
  'sender.pairing.start.submit': 'Weiter',
  'sender.pairing.start.submitting': 'Wird gesendet …',
  'sender.pairing.start.title': 'Gerät koppeln',

  'sender.pairing.waiting.again': 'Neue Anfrage',
  'sender.pairing.waiting.approvedLead': 'Die Station startet …',
  'sender.pairing.waiting.approvedTitle': 'Gekoppelt',
  'sender.pairing.waiting.codeCaption': 'Prüfcode für die Regie',
  'sender.pairing.waiting.deniedText':
    'Die Regie hat die Anfrage von «{name}» abgelehnt. Frag in der Regie nach und versuche es noch einmal.',
  'sender.pairing.waiting.deniedTitle': 'Anfrage abgelehnt',
  'sender.pairing.waiting.expiredText':
    'Die Regie hat die Anfrage nicht rechtzeitig freigegeben. Eine neue Anfrage bekommt einen neuen Prüfcode.',
  'sender.pairing.waiting.expiredTitle': 'Anfrage abgelaufen',
  'sender.pairing.waiting.expiresIn': 'Läuft in {time} ab',
  'sender.pairing.waiting.lead':
    'Nenne der Regie diesen Code oder prüfe, ob er mit dem auf ihrem Bildschirm übereinstimmt. Dann gibt sie «{name}» frei.',
  'sender.pairing.waiting.statusTrouble': 'Keine Verbindung zum Server – neuer Versuch läuft …',
  'sender.pairing.waiting.statusWaiting': 'Wartet auf die Regie …',
  'sender.pairing.waiting.title': 'Wartet auf Freigabe',
  'sender.pairing.waiting.validUntil': 'Gültig bis {time}',
};
