import type { Translation } from '../../types';
import type { senderPairing as en } from '../en/sender-pairing';

export const senderPairing: Translation<typeof en> = {
  'sender.pairing.start.foot':
    'Mit dem QR-Code der Regie geht es noch schneller: einfach mit der Kamera-App des Handys scannen.',
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
};
