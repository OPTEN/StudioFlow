/**
 * German texts for the `i18n` project, which runs the product in `de-CH`. Like `text.ts` they are literals and do
 * not import the product catalogue.
 */
export const TEXT_DE = {
  slate: {
    /** The only slate the output page translates by itself; the standby and end slates come from the production. */
    denied: 'Kein Zugang',
  },
  /** The sign-in error of the Regie (regie.login.error.invalid). */
  loginFailed: 'Benutzername oder Passwort ist falsch.',
} as const;
