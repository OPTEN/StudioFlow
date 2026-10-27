import type { Translation } from '../../types';
import type { senderPairing as en } from '../en/sender-pairing';

export const senderPairing: Translation<typeof en> = {
  'sender.pairing.redeem.alreadyAgain': 'Neu koppeln',
  'sender.pairing.redeem.alreadyStation': 'Zur Station',
  'sender.pairing.redeem.alreadyText':
    'Dieses Gerät ist bereits mit der Regie gekoppelt. Mit der neuen Einladung wird es als neue Station gekoppelt.',
  'sender.pairing.redeem.alreadyTitle': 'Schon gekoppelt',
  'sender.pairing.redeem.expiredLink':
    'Dieser Link ist abgelaufen oder wurde schon verwendet. Bitte in der Regie einen neuen erzeugen lassen.',
  'sender.pairing.redeem.expiredQr':
    'Dieser QR-Code ist abgelaufen oder wurde schon verwendet. Bitte in der Regie einen neuen erzeugen lassen.',
  'sender.pairing.redeem.expiredTitle': 'Einladung abgelaufen',
  'sender.pairing.redeem.failedTitle': 'Koppeln hat nicht geklappt',
  'sender.pairing.redeem.pairWithCode': 'Mit Prüfcode koppeln',
  'sender.pairing.redeem.pairingStatus': 'Einen Moment, das Gerät meldet sich bei der Regie an.',
  'sender.pairing.redeem.pairingTitle': 'Wird gekoppelt …',
  'sender.pairing.redeem.retry': 'Erneut versuchen',

  'sender.pairing.start.foot':
    'Mit dem QR-Code der Regie geht es noch schneller: einfach mit der Kamera-App des Handys scannen.',
  'sender.pairing.start.kindAudioStation': 'Audiostation (Mischpult)',
  'sender.pairing.start.kindLaptop': 'Laptop (Bildschirm)',
  'sender.pairing.start.kindLegend': 'Was sendet dieses Gerät?',
  'sender.pairing.start.kindPhone': 'Handy (Kamera)',
  'sender.pairing.start.lead':
    'Gib diesem Gerät einen Namen. Die Regie sieht ihn zusammen mit einem Prüfcode und gibt das Gerät frei.',
  'sender.pairing.start.nameExample': 'Zum Beispiel «Laptop Anna» oder «Handy Bühne links».',
  'sender.pairing.start.nameLabel': 'Name des Geräts',
  'sender.pairing.start.nameRequired': 'Bitte einen Namen eingeben.',
  'sender.pairing.start.nameTooLong': 'Höchstens {max} Zeichen.',
  'sender.pairing.start.noScreenShare':
    'Bildschirm teilen geht nur auf Laptops und Desktop-Browsern. Auf diesem Gerät kannst du die Kamera senden.',
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
  'sender.pairing.waiting.expiry': 'Gilt noch {time} min.',
  'sender.pairing.waiting.lead':
    'Die Regie sieht «{name}» mit diesem Code. Stimmt er auf beiden Bildschirmen überein, gibt sie das Gerät frei.',
  'sender.pairing.waiting.statusTrouble': 'Keine Verbindung zum Server – neuer Versuch läuft …',
  'sender.pairing.waiting.statusWaiting': 'Wartet auf die Regie …',
  'sender.pairing.waiting.title': 'Wartet auf Freigabe',
};
