import type { Namespace } from '../../types';

/** The sign-in page of the Regie (the control room). */
export const regieLogin = {
  'regie.login.brandLead': 'Control room',
  'regie.login.error.invalid': 'Wrong username or password.',
  'regie.login.error.locked': {
    one: 'Too many failed attempts. Please try again in {count} minute.',
    other: 'Too many failed attempts. Please try again in {count} minutes.',
  },
  'regie.login.error.required': 'Please enter your username and password.',
  'regie.login.password': 'Password',
  'regie.login.submit': 'Sign in',
  'regie.login.submitting': 'Signing in…',
  'regie.login.title': 'Sign in',
  'regie.login.username': 'Username',
} as const satisfies Namespace<'regie.login'>;
