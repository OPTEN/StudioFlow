import type { Translation } from '../../types';
import type { regieAccount as en } from '../en/regie-account';

export const regieAccount: Translation<typeof en> = {
  'regie.account.change.current': 'Aktuelles Passwort',
  'regie.account.change.currentRequired': 'Bitte das aktuelle Passwort eingeben.',
  'regie.account.change.done': 'Passwort geändert. Alle anderen Sitzungen wurden abgemeldet.',
  'regie.account.change.hint': 'Alle anderen Sitzungen werden abgemeldet.',
  'regie.account.change.menu': 'Passwort ändern',
  'regie.account.change.new': 'Neues Passwort',
  'regie.account.change.repeat': 'Neues Passwort wiederholen',
  'regie.account.change.submit': 'Passwort ändern',
  'regie.account.password.equalsUsername':
    'Das Passwort muss sich vom Benutzernamen unterscheiden.',
  'regie.account.password.hint':
    'Mindestens {min} Zeichen. Nicht der Benutzername, kein verbreitetes Passwort.',
  'regie.account.password.mismatch': 'Die Passwörter stimmen nicht überein.',
  'regie.account.password.repeatRequired': 'Bitte das Passwort wiederholen.',
  'regie.account.password.required': 'Bitte ein Passwort eingeben.',
  'regie.account.password.tooCommon':
    'Dieses Passwort ist zu verbreitet. Bitte ein anderes wählen.',
  'regie.account.password.tooLong': 'Das Passwort darf höchstens {max} Zeichen haben.',
  'regie.account.password.tooShort': 'Das Passwort braucht mindestens {min} Zeichen.',
};
