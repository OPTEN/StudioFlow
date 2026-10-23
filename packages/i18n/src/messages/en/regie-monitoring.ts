import type { Namespace } from '../../types';

/** The `/monitoring` page: the table of stations with their live telemetry. */
export const regieMonitoring = {
  'regie.monitoring.back': 'Back to the control room',
  'regie.monitoring.batteryCharging': '{percent} · charging',
  'regie.monitoring.caption': 'Stations with measurements, continuously updated',

  'regie.monitoring.column.battery': 'Battery',
  'regie.monitoring.column.codes': 'Sources',
  'regie.monitoring.column.loss': 'Loss',
  'regie.monitoring.column.network': 'Network',
  'regie.monitoring.column.resolution': 'Resolution',
  'regie.monitoring.column.seen': 'Last seen',
  'regie.monitoring.column.state': 'State',
  'regie.monitoring.column.station': 'Station',
  'regie.monitoring.column.tech': 'Tech check',

  'regie.monitoring.connection.connecting': 'Connecting…',
  'regie.monitoring.connection.live': 'Live',
  'regie.monitoring.connection.offline': 'Offline',
  'regie.monitoring.connection.offlineSince': 'Offline · as of {time}',

  'regie.monitoring.empty.loading': 'Loading measurements…',
  'regie.monitoring.empty.loadingHint': 'The control room is connecting to the server.',
  'regie.monitoring.empty.none': 'No stations yet.',
  'regie.monitoring.empty.noneHint':
    'In the control room, use “Pair device” to connect a phone or a laptop.',

  'regie.monitoring.note':
    'Values arrive from the devices about every 2 s. Click a column to sort.',

  'regie.monitoring.seen.minutes': '{value} min ago',
  'regie.monitoring.seen.seconds': '{value} s ago',

  'regie.monitoring.slot.ended': 'ended',
  'regie.monitoring.slot.failed': 'error',
  'regie.monitoring.slot.live': 'live',
  'regie.monitoring.slot.none': 'none',
  'regie.monitoring.slot.paused': 'paused',
  'regie.monitoring.slot.starting': 'starting',

  'regie.monitoring.stateSending': 'sending',
  'regie.monitoring.stations': 'Stations',

  'regie.monitoring.summary.incidents': {
    '=0': 'no incidents',
    one: '{count} incident',
    other: '{count} incidents',
  },
  'regie.monitoring.summary.sending': { one: '{count} sending', other: '{count} sending' },
  'regie.monitoring.summary.stations': { one: '{count} station', other: '{count} stations' },

  'regie.monitoring.tech.bad': 'poor',
  'regie.monitoring.tech.notRun': 'not run',
  'regie.monitoring.tech.ok': 'ok',
  'regie.monitoring.tech.unknown': 'unknown',
  'regie.monitoring.tech.warn': 'marginal',

  'regie.monitoring.title': 'Monitoring',
} as const satisfies Namespace<'regie.monitoring'>;
