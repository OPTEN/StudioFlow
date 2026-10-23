import type { Namespace } from '../../types';

/**
 * Texts the docks share: the "connecting" line under a loading title, the toast for commands while offline and the
 * reorder handle of the sortable lists (Sources and Scenes) with its screen reader announcements.
 */
export const regieDocks = {
  'regie.docks.loadingText': 'The control room is connecting to the server.',
  'regie.docks.offline': 'No connection to the server. Please try again in a moment.',

  'regie.docks.sortable.cancelled':
    'Move cancelled. {name} is back at position {position} of {count}.',
  'regie.docks.sortable.dropped': '{name} dropped at position {position} of {count}.',
  'regie.docks.sortable.handle': 'Reorder {name}',
  'regie.docks.sortable.handleTitle': 'Drag to reorder, or press Space and use the arrow keys',
  'regie.docks.sortable.moved': '{name} moved to position {position} of {count}.',
  'regie.docks.sortable.picked':
    '{name} picked up at position {position} of {count}. Use the arrow keys to move, Space to drop, Escape to cancel.',
} as const satisfies Namespace<'regie.docks'>;
