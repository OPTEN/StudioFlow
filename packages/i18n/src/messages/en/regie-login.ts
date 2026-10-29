import type { Namespace } from '../../types';

/** The sign-in page of the Regie (the control room). */
export const regieLogin = {
  'regie.login.heading': 'Sign in to StudioFlow',
  'regie.login.lead': 'Use the account of this control room.',
  'regie.login.error.invalid': 'Wrong username or password.',
  'regie.login.error.locked': {
    one: 'Too many failed attempts. Please try again in {count} minute.',
    other: 'Too many failed attempts. Please try again in {count} minutes.',
  },
  'regie.login.error.required': 'Please enter your username and password.',
  'regie.login.forgot': 'Forgot your password?',
  'regie.login.forgotText':
    'The password can only be reset on the server. Whoever runs the server deletes the account with this command; the next visit then opens the first-run setup.',
  'regie.login.password': 'Password',
  'regie.login.reveal': 'Show password',
  'regie.login.sponsor': 'Sponsored by',
  'regie.login.submit': 'Sign in',
  'regie.login.submitting': 'Signing in…',
  'regie.login.title': 'Sign in',
  'regie.login.username': 'Username',
} as const satisfies Namespace<'regie.login'>;
