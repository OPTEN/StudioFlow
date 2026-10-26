import type { Translation } from '../../types';
import type { errors as en } from '../en/errors';

export const errors: Translation<typeof en> = {
  'errors.code.validation_failed': 'Die Eingabe ist ungültig.',
  'errors.code.not_found': 'Das gibt es nicht mehr. Vielleicht wurde es inzwischen gelöscht.',
  'errors.code.broadcast_live':
    'Das geht nicht, solange die Sendung live ist. Zuerst die Sendung beenden.',
  'errors.code.transition_running': 'Eine Blende läuft noch. Bitte kurz warten.',
  'errors.code.scene_is_live': 'Die Live-Szene lässt sich nicht löschen.',
  'errors.code.asset_in_use': 'Die Datei wird noch verwendet und lässt sich nicht löschen.',
  'errors.code.unsupported_media':
    'Dieser Dateityp ist nicht erlaubt. Erlaubt sind PNG, JPEG, WebP, MP4 und WebM.',
  'errors.code.pairing_expired': 'Die Anfrage ist abgelaufen oder wurde schon beantwortet.',
  'errors.code.rate_limited': 'Zu viele Versuche. Bitte später erneut versuchen.',
  'errors.code.device_blocked': 'Das Gerät ist gesperrt.',
  'errors.code.conflict': 'Das geht gerade nicht, weil sich der Zustand geändert hat.',
  'errors.code.limit_reached': 'Die Obergrenze ist erreicht.',
  'errors.code.unauthorized': 'Die Anmeldung ist abgelaufen. Bitte neu anmelden.',
  'errors.code.forbidden': 'Dafür fehlt die Berechtigung.',
  'errors.code.request_timeout':
    'Der Server hat nicht rechtzeitig geantwortet. Bitte nochmals versuchen.',
  'errors.code.internal_error':
    'Auf dem Server ist ein Fehler aufgetreten. Bitte nochmals versuchen.',
  'errors.code.service_unavailable':
    'Der Server ist gerade nicht erreichbar. Bitte gleich nochmals versuchen.',
  'errors.code.setup_code_invalid':
    'Der Einrichtungscode stimmt nicht. Nach einem Neustart zeigt der Server einen neuen an.',
  'errors.code.setup_closed': 'Die Ersteinrichtung ist bereits abgeschlossen. Bitte anmelden.',
  'errors.code.password_incorrect': 'Das aktuelle Passwort stimmt nicht.',
  'errors.code.network': 'Keine Verbindung zum Server. Bitte nochmals versuchen.',
  'errors.code.aborted': 'Abgebrochen.',

  'errors.status.413':
    'Die Datei ist zu gross. Bilder dürfen höchstens 25 MB, Videos höchstens 1 GB gross sein.',
  'errors.status.unknown': 'Das hat nicht geklappt (Fehler {status}).',

  'errors.rateLimited.wait': {
    one: 'Zu viele Versuche. Bitte in {count} Minute erneut versuchen.',
    other: 'Zu viele Versuche. Bitte in {count} Minuten erneut versuchen.',
  },

  'errors.device.network': 'Der Server ist nicht erreichbar. Bitte WLAN prüfen.',
  'errors.device.timeout': 'Der Server antwortet nicht. Bitte WLAN prüfen.',
  'errors.device.unauthorized': 'Dieses Gerät ist nicht mehr gekoppelt.',
  'errors.device.blocked': 'Dieses Gerät ist gesperrt. Die Regie kann es wieder freigeben.',
  'errors.device.forbidden': 'Kein Zugriff.',
  'errors.device.notFound': 'Nicht gefunden.',
  'errors.device.expired': 'Diese Einladung ist abgelaufen oder wurde schon verwendet.',
  'errors.device.conflict': 'Das geht gerade nicht.',
  'errors.device.limit': 'Die Grenze ist erreicht.',
  'errors.device.invalid': 'Die Eingabe ist ungültig.',
  'errors.device.tooLarge': 'Die Daten sind zu gross.',
  'errors.device.server':
    'Der Server hat einen Fehler gemeldet. Bitte gleich noch einmal versuchen.',
  'errors.device.unavailable':
    'Der Server ist gerade nicht erreichbar. Bitte gleich noch einmal versuchen.',
  'errors.device.rateLimitedLater': 'Zu viele Versuche. Bitte später noch einmal versuchen.',
  'errors.device.rateLimitedSeconds': {
    one: 'Zu viele Versuche. Bitte in {count} Sekunde noch einmal versuchen.',
    other: 'Zu viele Versuche. Bitte in {count} Sekunden noch einmal versuchen.',
  },
  'errors.device.rateLimitedMinutes': {
    one: 'Zu viele Versuche. Bitte in {count} Minute noch einmal versuchen.',
    other: 'Zu viele Versuche. Bitte in {count} Minuten noch einmal versuchen.',
  },
};
