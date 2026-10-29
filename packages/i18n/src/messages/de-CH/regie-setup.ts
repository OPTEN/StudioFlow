import type { Translation } from '../../types';
import type { regieSetup as en } from '../en/regie-setup';

export const regieSetup: Translation<typeof en> = {
  'regie.setup.code.format':
    'Der Einrichtungscode hat 8 Buchstaben und Ziffern, zum Beispiel K7QM-3XD2.',
  'regie.setup.code.hint':
    'Steht im Server-Log bei der Person, die StudioFlow installiert hat: docker compose logs api',
  'regie.setup.code.label': 'Einrichtungscode',
  'regie.setup.code.required': 'Bitte den Einrichtungscode eingeben.',
  'regie.setup.heading': 'Konto erstellen',
  'regie.setup.intro':
    'Das ist das eine Konto dieser Installation, und sein Benutzername lässt sich später nicht ändern. Bitte den Einrichtungscode aus dem Server-Log eingeben, dann Benutzername und Passwort wählen.',
  'regie.setup.password.label': 'Passwort',
  'regie.setup.repeat.label': 'Passwort wiederholen',
  'regie.setup.reveal': 'Passwörter anzeigen',
  'regie.setup.submit': 'Konto erstellen',
  'regie.setup.submitting': 'Konto wird erstellt …',
  'regie.setup.title': 'Ersteinrichtung',
  'regie.setup.username.invalid':
    'Nur Buchstaben, Ziffern und . _ @ - erlaubt, höchstens {max} Zeichen.',
  'regie.setup.username.label': 'Benutzername',
  'regie.setup.username.required': 'Bitte einen Benutzernamen eingeben.',
};
