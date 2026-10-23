import type { Namespace } from '../../types';

/** The language setting. The language names themselves ("English", "Deutsch (Schweiz)") are never translated. */
export const locale = {
  'locale.auto': 'Automatic (browser language)',
  'locale.label': 'Interface language',
} as const satisfies Namespace<'locale'>;
