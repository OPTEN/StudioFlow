import type { Namespace } from '../../types';

/**
 * The page around the program: the name of the stage for assistive technology, and the document title, which names
 * the production (or the refused state), so several output tabs or browser sources can be told apart.
 */
export const outputPage = {
  'output.page.program': 'Program',
  'output.page.title': 'StudioFlow output',
  'output.page.titleDenied': 'No access · StudioFlow output',
  'output.page.titleNamed': '{name} · StudioFlow output',
} as const satisfies Namespace<'output.page'>;
