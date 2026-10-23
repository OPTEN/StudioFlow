import type { Translation } from '../../types';
import type { regieLogin as en } from '../en/regie-login';

export const regieLogin: Translation<typeof en> = {
  'regie.login.brandLead': 'Regie',
  'regie.login.error.invalid': 'Benutzername oder Passwort ist falsch.',
  'regie.login.error.locked': {
    one: 'Zu viele Fehlversuche. Bitte in {count} Minute erneut versuchen.',
    other: 'Zu viele Fehlversuche. Bitte in {count} Minuten erneut versuchen.',
  },
  'regie.login.error.required': 'Bitte Benutzername und Passwort eingeben.',
  'regie.login.password': 'Passwort',
  'regie.login.submit': 'Anmelden',
  'regie.login.submitting': 'Anmelden …',
  'regie.login.title': 'Anmelden',
  'regie.login.username': 'Benutzername',
};
