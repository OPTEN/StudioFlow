import type { Namespace } from '../../types';

/** The settings popover of the Regie: language and appearance. */
export const regieSettings = {
  'regie.settings.open': 'Open settings',
  'regie.settings.title': 'Settings',
  'regie.settings.theme.label': 'Appearance',
  'regie.settings.theme.dark': 'Dark',
  'regie.settings.theme.light': 'Light',
  'regie.settings.theme.system': 'System',
} as const satisfies Namespace<'regie.settings'>;
