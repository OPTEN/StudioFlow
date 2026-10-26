import type { Namespace } from '../../types';

/**
 * Placeholders of a copied production (issue #14): the missing sources in the Sources dock, assigning one to a source, and the
 * offer "Use as K1 · Stage phone" of a new station. `{name}` is the code and name of the placeholder, “K1 · Stage phone”.
 */
export const regiePlaceholders = {
  'regie.placeholders.assign.button': 'Assign…',
  'regie.placeholders.assign.empty':
    'There is no camera, screen or medium to assign yet. Pair a device first.',
  'regie.placeholders.assign.label': 'Assign {name}',
  'regie.placeholders.assign.remove': 'Remove from all scenes…',
  'regie.placeholders.assign.title': 'Show {name} as',

  'regie.placeholders.dock.hint':
    'Devices are not copied. Pair a device and assign it: its picture then appears everywhere the source is used.',
  'regie.placeholders.dock.title': 'Missing sources',
  'regie.placeholders.dock.usedIn': {
    '=0': 'in no scene',
    one: 'in {count} scene',
    other: 'in {count} scenes',
  },

  'regie.placeholders.offer.more': {
    one: '{count} more under “Missing sources”',
    other: '{count} more under “Missing sources”',
  },
  'regie.placeholders.offer.text': 'This station can take the place of a missing source:',
  'regie.placeholders.offer.useAs': 'Use as {name}',

  'regie.placeholders.remove.confirmLabel': 'Remove {name}',
  'regie.placeholders.remove.message': {
    '=0': '{name} is not used in any scene and is simply removed.',
    one: 'The {count} element that shows {name} is removed from its scene.',
    other: 'The {count} elements that show {name} are removed from their scenes.',
  },

  'regie.placeholders.toast.assigned': 'The scenes now show {target} in place of {name}.',
  'regie.placeholders.toast.removed': '{name} removed from the scenes.',
  'regie.placeholders.unnamed': 'removed source',
} as const satisfies Namespace<'regie.placeholders'>;
