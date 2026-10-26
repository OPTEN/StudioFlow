import type { Namespace } from '../../types';

/** The settings popover of the Regie: language, appearance and the version the server runs. */
export const regieSettings = {
  'regie.settings.open': 'Open settings',
  'regie.settings.title': 'Settings',
  'regie.settings.theme.label': 'Appearance',
  'regie.settings.theme.dark': 'Dark',
  'regie.settings.theme.light': 'Light',
  'regie.settings.theme.system': 'System',
  'regie.settings.version.label': 'Version',
} as const satisfies Namespace<'regie.settings'>;
