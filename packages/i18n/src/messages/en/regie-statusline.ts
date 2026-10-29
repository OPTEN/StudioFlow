import type { Namespace } from '../../types';

/**
 * The activity bar below the toolbar: connection banners, the device health button with its issues popover, the most
 * severe incident with its direct action, and the latest event with the link to the activity log (the log lines
 * themselves are `regie.log.*`).
 */
export const regieStatusline = {
  'regie.statusline.audit': 'Activity log',

  'regie.statusline.banner.connecting': 'Connecting to the server…',
  'regie.statusline.banner.mediaDegraded': 'Video connection interrupted, reconnecting…',
  'regie.statusline.banner.mediaReconnect': 'Reconnect',
  'regie.statusline.banner.mediaUnavailable': 'No video connection: the monitors show no picture.',
  'regie.statusline.banner.offline':
    'No connection to the server, the control room is reconnecting…',
  'regie.statusline.banner.offlineSince':
    'No connection to the server, the control room is reconnecting… Last update {time}.',

  'regie.statusline.health.issues': { one: '1 issue', other: '{count} issues' },
  'regie.statusline.health.loading': 'Checking devices…',
  'regie.statusline.health.none': 'No devices yet',
  'regie.statusline.health.ok': { one: '1 device OK', other: 'All {count} devices OK' },

  'regie.statusline.incident.back': 'back',
  'regie.statusline.incident.dismiss': 'Dismiss',
  'regie.statusline.incident.goneFor': 'was gone for {seconds} s',
  'regie.statusline.incident.reshare': 'Ask to share again',
  'regie.statusline.incident.reshareOffline':
    '{name} is not connected. Please share again directly on the device.',
  'regie.statusline.incident.reshareSent': 'Request sent to {name}: “Share screen again”',
  'regie.statusline.incident.show': 'Show in the Devices dock',
  'regie.statusline.incident.timer': 'How long the problem has lasted',

  'regie.statusline.issues.empty': 'All devices are sending. A problem shows up here the moment it happens.',
  'regie.statusline.issues.emptyTitle': 'No issues',
  'regie.statusline.issues.markAll': 'Mark all as seen',
  'regie.statusline.issues.monitoring': 'Open monitoring',
  'regie.statusline.issues.more': { one: '+1 more', other: '+{count} more' },
  'regie.statusline.issues.noDevices': 'Add a device in the Devices dock; its state shows up here.',
  'regie.statusline.issues.title': 'Issues',

  'regie.statusline.label': 'Activity',
  'regie.statusline.latest': 'Latest event',
  'regie.statusline.offline': 'No connection to the server. Please try again in a moment.',
} as const satisfies Namespace<'regie.statusline'>;
