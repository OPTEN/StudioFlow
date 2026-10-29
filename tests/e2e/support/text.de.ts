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
  /**
   * Moving a dock by keyboard (regie.workspace.grip, .docked.*, .layout.undo, .layout.moveUndone, .layout.reset,
   * .layout.resetDone) for the Devices dock.
   */
  stationsDock: {
    grip: 'Dock Geräte verschieben, mit Pfeiltasten',
    /** The start of «Geräte ist links|unten|rechts angedockt»: where the dock goes depends on where it was. */
    docked: 'Geräte ist',
    /** The action of the toast after a move. */
    undo: 'Rückgängig',
    moveUndone: 'Verschieben von Geräte rückgängig gemacht',
    resetLayout: 'Layout zurücksetzen',
    layoutReset: 'Layout zurückgesetzt',
  },
} as const;
