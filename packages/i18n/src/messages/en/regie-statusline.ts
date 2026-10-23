import type { Namespace } from '../../types';

/**
 * The message strip below the header: connection banners, one segment per incident with its actions, and the
 * "Recent events" log (the log lines themselves are `regie.log.*`).
 */
export const regieStatusline = {
  'regie.statusline.banner.connecting': 'Connecting to the server…',
  'regie.statusline.banner.mediaDegraded': 'Video connection interrupted, reconnecting…',
  'regie.statusline.banner.mediaReconnect': 'Reconnect',
  'regie.statusline.banner.mediaUnavailable': 'No video connection: the monitors show no picture.',
  'regie.statusline.banner.offline':
    'No connection to the server, the control room is reconnecting…',
  'regie.statusline.banner.offlineSince':
    'No connection to the server, the control room is reconnecting… Last update {time}.',

  'regie.statusline.incident.back': 'back',
  'regie.statusline.incident.goneFor': 'was gone for {seconds} s',
  'regie.statusline.incident.reshare': 'Ask to share again',
  'regie.statusline.incident.reshareOffline':
    '{name} is not connected. Please share again directly on the device.',
  'regie.statusline.incident.reshareSent': 'Request sent to {name}: “Share screen again”',
  'regie.statusline.incident.seen': 'Seen',
  'regie.statusline.incident.show': 'Show {code} in Stations',

  'regie.statusline.label': 'Messages',
  'regie.statusline.log': 'Recent events',
  'regie.statusline.offline': 'No connection to the server. Please try again in a moment.',
  'regie.statusline.none': 'No open messages',
} as const satisfies Namespace<'regie.statusline'>;
