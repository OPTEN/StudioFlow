import type { Namespace } from '../../types';

/** The sound of the output page: the button that appears when the browser blocks the sound. */
export const outputAudio = {
  'output.audio.soundOn': 'Sound on',
  'output.audio.soundOnHint': 'The browser blocks the sound until you click the page.',
} as const satisfies Namespace<'output.audio'>;
