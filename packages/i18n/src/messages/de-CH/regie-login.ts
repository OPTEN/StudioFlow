import type { Translation } from '../../types';
import type { regieLogin as en } from '../en/regie-login';

export const regieLogin: Translation<typeof en> = {
  'regie.login.heading': 'Bei StudioFlow anmelden',
  'regie.login.lead': 'Mit dem Konto dieser Regie.',
  'regie.login.error.invalid': 'Benutzername oder Passwort ist falsch.',
  'regie.login.error.locked': {
    one: 'Zu viele Fehlversuche. Bitte in {count} Minute erneut versuchen.',
    other: 'Zu viele Fehlversuche. Bitte in {count} Minuten erneut versuchen.',
  },
  'regie.login.error.required': 'Bitte Benutzername und Passwort eingeben.',
  'regie.login.forgot': 'Passwort vergessen?',
  'regie.login.forgotText':
    'Das Passwort lässt sich nur auf dem Server zurücksetzen. Wer den Server betreibt, löscht das Konto mit diesem Befehl; beim nächsten Besuch öffnet sich dann die Ersteinrichtung.',
  'regie.login.password': 'Passwort',
  'regie.login.reveal': 'Passwort anzeigen',
  'regie.login.sponsor': 'Gesponsert von',
  'regie.login.submit': 'Anmelden',
  'regie.login.submitting': 'Anmelden …',
  'regie.login.title': 'Anmelden',
  'regie.login.username': 'Benutzername',
};
