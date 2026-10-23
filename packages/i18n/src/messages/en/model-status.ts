import type { Namespace } from '../../types';

/**
 * Words for the health of a source and for where it is on air (lamps, rows, the message strip), and the header
 * chip that counts incidents and stations.
 */
export const modelStatus = {
  'model.status.blocked': 'blocked',
  'model.status.connecting': 'connecting…',
  'model.status.endedCamera': 'camera stopped',
  'model.status.endedScreen': 'sharing stopped',
  'model.status.incidents': { one: '{count} incident', other: '{count} incidents' },
  'model.status.lost': 'no picture',
  'model.status.offline': 'not connected',
  'model.status.placeOff': 'not live',
  'model.status.placePreview': 'in Preview',
  'model.status.placeProgram': 'on Program',
  'model.status.reconnecting': 'reconnecting',
  'model.status.stationsOk': {
    '=0': 'No stations',
    one: '{count} station ok',
    other: 'All {count} stations ok',
  },
} as const satisfies Namespace<'model.status'>;
