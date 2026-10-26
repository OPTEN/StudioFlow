import type { Translation } from '../../types';
import type { mediaSlot as en } from '../en/media-slot';

export const mediaSlot: Translation<typeof en> = {
  'media.slot.cameraSwitchFailed': 'Kamerawechsel fehlgeschlagen.',
  'media.slot.failure.cancelled': 'Freigabe abgebrochen',
  'media.slot.failure.in-use':
    'Die Kamera ist nicht verfügbar. Wird sie von einer anderen App verwendet?',
  'media.slot.failure.needs-gesture': 'Bitte die Freigabe direkt per Klick starten.',
  'media.slot.failure.not-found': 'Keine Kamera gefunden.',
  'media.slot.failure.not-supported': 'Dieser Browser kann den Bildschirm nicht teilen.',
  'media.slot.failure.permission-denied':
    'Kein Zugriff auf die Kamera. Bitte den Zugriff im Browser erlauben.',
  'media.slot.failure.publish-failed': 'Das Bild konnte nicht gesendet werden.',
  'media.slot.failure.track-lost': 'Die Kamera liefert kein Bild mehr.',
  'media.slot.failure.unknown': 'Der Bildschirm konnte nicht geteilt werden.',
  'media.slot.mic.ended': 'Das Mikrofon wurde getrennt.',
  'media.slot.mic.in-use':
    'Das Mikrofon ist nicht verfügbar. Wird es von einer anderen App verwendet?',
  'media.slot.mic.not-found': 'Kein Mikrofon gefunden.',
  'media.slot.mic.permission-denied':
    'Kein Zugriff auf das Mikrofon. Bitte den Zugriff im Browser erlauben.',
  'media.slot.mic.publish-failed': 'Der Ton konnte nicht gesendet werden.',
  'media.slot.mic.track-lost': 'Das Mikrofon liefert keinen Ton mehr.',
  'media.slot.shareEnded': 'Freigabe beendet',
};
