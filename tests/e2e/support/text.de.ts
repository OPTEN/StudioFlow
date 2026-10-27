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
  /** Moving a dock by keyboard (regie.workspace.grip, .docked.*, .layout.reset, .layout.resetDone) for the Stations dock. */
  stationsDock: {
    grip: 'Dock Stationen verschieben, mit Pfeiltasten',
    /** The start of «Stationen ist links|unten|rechts angedockt»: where the dock goes depends on where it was. */
    docked: 'Stationen ist',
    resetLayout: 'Layout zurücksetzen',
    layoutReset: 'Layout zurückgesetzt',
  },
} as const;
