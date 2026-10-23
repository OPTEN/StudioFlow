/**
 * English texts that the tests assert and that more than one spec needs: slates, default content of a new
 * production, log lines and server messages. They are literals on purpose: the tests are a black box and do not import
 * the product catalogue, so a changed product text fails the suite. The German counterparts are in `text.de.ts`.
 */
export const TEXT = {
  slate: {
    standby: 'Starting soon',
    end: 'Thanks for watching',
    denied: 'No access',
    /** Shown on the stage while a source is held (renderer.held). */
    held: 'Picture returns shortly',
  },
  /** The scenes of a new production (spec 4.2). */
  defaultScenes: ['Welcome', 'Presentation', 'Break'],
  log: {
    reconnecting: (code: string) => `${code} reconnecting`,
    paired: (code: string, name: string) => `${code} ${name} paired`,
  },
  loginFailed: 'Username or password is incorrect.',
  /** "12 34": the check code that both screens show while a device waits for approval. */
  checkCodeFormat: /^\d{2} \d{2}$/,
} as const;
