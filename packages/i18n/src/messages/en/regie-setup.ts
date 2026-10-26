import type { Namespace } from '../../types';

/** The first-run setup page of the Regie (the control room): creates the account before anyone can sign in. */
export const regieSetup = {
  'regie.setup.code.format': 'The setup code has 8 letters and digits, like K7QM-3XD2.',
  'regie.setup.code.hint': 'Shown in the server log: docker compose logs api',
  'regie.setup.code.label': 'Setup code',
  'regie.setup.code.required': 'Enter the setup code.',
  'regie.setup.intro':
    'No account exists yet. Enter the setup code from the server log and choose a username and a password for the control room.',
  'regie.setup.lead': 'First-run setup',
  'regie.setup.password.label': 'Password',
  'regie.setup.repeat.label': 'Repeat password',
  'regie.setup.submit': 'Create account',
  'regie.setup.submitting': 'Creating account…',
  'regie.setup.title': 'First-run setup',
  'regie.setup.username.invalid':
    'Use only letters, digits and . _ @ - and at most {max} characters.',
  'regie.setup.username.label': 'Username',
  'regie.setup.username.required': 'Enter a username.',
} as const satisfies Namespace<'regie.setup'>;
