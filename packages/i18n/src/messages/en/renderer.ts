import type { Namespace } from '../../types';

/** Texts drawn by `@studioflow/scene-renderer` (the monitor and the output stage). */
export const renderer = {
  'renderer.alertEnded': 'ended',
  'renderer.alertFrozen': 'Freeze frame {time}',
  'renderer.held': 'Picture returns shortly',
  'renderer.sourceMissing': 'Source missing',
} as const satisfies Namespace<'renderer'>;
