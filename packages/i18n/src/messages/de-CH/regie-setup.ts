import type { Translation } from '../../types';
import type { regieSetup as en } from '../en/regie-setup';

export const regieSetup: Translation<typeof en> = {
  'regie.setup.code.format':
    'Der Einrichtungscode hat 8 Buchstaben und Ziffern, zum Beispiel K7QM-3XD2.',
  'regie.setup.code.hint': 'Steht im Server-Log: docker compose logs api',
  'regie.setup.code.label': 'Einrichtungscode',
  'regie.setup.code.required': 'Bitte den Einrichtungscode eingeben.',
  'regie.setup.intro':
    'Es gibt noch kein Konto. Bitte den Einrichtungscode aus dem Server-Log eingeben und Benutzername und Passwort für die Regie wählen.',
  'regie.setup.lead': 'Ersteinrichtung',
  'regie.setup.password.label': 'Passwort',
  'regie.setup.repeat.label': 'Passwort wiederholen',
  'regie.setup.submit': 'Konto erstellen',
  'regie.setup.submitting': 'Konto wird erstellt …',
  'regie.setup.title': 'Ersteinrichtung',
  'regie.setup.username.invalid':
    'Nur Buchstaben, Ziffern und . _ @ - erlaubt, höchstens {max} Zeichen.',
  'regie.setup.username.label': 'Benutzername',
  'regie.setup.username.required': 'Bitte einen Benutzernamen eingeben.',
};
