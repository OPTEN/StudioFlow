import type { Namespace } from '../../types';

/** Texts the docks share: the "connecting" line under a loading title and the toast for commands while offline. */
export const regieDocks = {
  'regie.docks.loadingText': 'The control room is connecting to the server.',
  'regie.docks.offline': 'No connection to the server. Please try again in a moment.',
} as const satisfies Namespace<'regie.docks'>;
