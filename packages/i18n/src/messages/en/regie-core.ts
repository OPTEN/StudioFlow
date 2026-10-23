import type { Namespace } from '../../types';

/** Shared plumbing of the Regie shell. The foundation seeds the document title; the Regie shell work continues here. */
export const regieCore = {
  'regie.core.appTitle': 'StudioFlow Control room',
} as const satisfies Namespace<'regie.core'>;
