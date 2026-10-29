import type { Namespace } from '../../types';

/** The password of the Regie account: the rules shared by the first-run setup and the password change, and the change itself. */
export const regieAccount = {
  'regie.account.change.current': 'Current password',
  'regie.account.change.currentRequired': 'Enter your current password.',
  'regie.account.change.done': 'Password changed. All other sessions were signed out.',
  'regie.account.change.hint':
    'Every other browser signed in with this account is signed out. This one stays signed in.',
  'regie.account.change.menu': 'Change password',
  'regie.account.change.new': 'New password',
  'regie.account.change.repeat': 'Repeat new password',
  'regie.account.change.submit': 'Update password',
  'regie.account.change.submitting': 'Updating…',
  'regie.account.password.equalsUsername': 'The password must differ from the username.',
  'regie.account.password.hint':
    'At least {min} characters. Not your username, not a common password.',
  'regie.account.password.mismatch': 'The passwords do not match.',
  'regie.account.password.repeatRequired': 'Repeat the password.',
  'regie.account.password.required': 'Enter a password.',
  'regie.account.password.tooCommon': 'This password is too common. Please choose another one.',
  'regie.account.password.tooLong': 'The password can have at most {max} characters.',
  'regie.account.password.tooShort': 'The password needs at least {min} characters.',
} as const satisfies Namespace<'regie.account'>;
