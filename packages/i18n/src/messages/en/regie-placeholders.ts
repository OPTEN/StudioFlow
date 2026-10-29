import type { Namespace } from '../../types';

/**
 * Placeholders of a copied production (issue #14): the missing sources in the Sources dock, assigning one to a source, and the
 * offer "Use as K1 · Stage phone" of a new station. `{name}` is the code and name of the placeholder, “K1 · Stage phone”.
 */
export const regiePlaceholders = {
  'regie.placeholders.assign.button': 'Assign…',
  'regie.placeholders.assign.empty': 'Nothing to assign yet. Add a device under Devices first.',
  'regie.placeholders.assign.label': 'Assign {name}',
  'regie.placeholders.assign.remove': 'Remove from all scenes…',
  'regie.placeholders.assign.title': 'Show {name} as',

  'regie.placeholders.dock.hint':
    'These cameras and screens came with the copied production. Assign a device to each: its picture then appears wherever the old one was used.',
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
    one: 'The one place in a scene that shows {name} is removed.',
    other: 'The {count} places in the scenes that show {name} are removed.',
  },

  'regie.placeholders.toast.assigned': 'The scenes now show {target} in place of {name}.',
  'regie.placeholders.toast.removed': '{name} removed from the scenes.',
  'regie.placeholders.unnamed': 'removed source',
} as const satisfies Namespace<'regie.placeholders'>;
