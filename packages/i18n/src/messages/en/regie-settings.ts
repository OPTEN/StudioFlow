import type { Namespace } from '../../types';

/** The settings popover of the Regie (a later issue adds the theme row). */
export const regieSettings = {
  'regie.settings.open': 'Open settings',
  'regie.settings.title': 'Settings',
} as const satisfies Namespace<'regie.settings'>;
