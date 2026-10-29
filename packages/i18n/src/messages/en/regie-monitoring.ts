import type { Namespace } from '../../types';

/** The `/monitoring` page: the table of devices with their live telemetry. */
export const regieMonitoring = {
  'regie.monitoring.batteryCharging': '{percent} · charging',
  'regie.monitoring.caption': 'Devices with measurements, continuously updated',
  'regie.monitoring.lead':
    'Live measurements of every device, about every 2 seconds. Devices with a problem come first.',

  'regie.monitoring.column.battery': 'Battery',
  'regie.monitoring.column.bitrate': 'Bit rate',
  'regie.monitoring.column.codes': 'Source',
  'regie.monitoring.column.encoding': 'Encoding',
  'regie.monitoring.column.fps': 'Frame rate',
  'regie.monitoring.column.loss': 'Packet loss',
  'regie.monitoring.column.network': 'Network',
  'regie.monitoring.column.resolution': 'Resolution',
  'regie.monitoring.column.rtt': 'Round trip',
  'regie.monitoring.column.seen': 'Last seen',
  'regie.monitoring.column.state': 'State',
  'regie.monitoring.column.station': 'Device',
  'regie.monitoring.column.tech': 'Tech check',

  'regie.monitoring.connection.connecting': 'Connecting…',
  'regie.monitoring.connection.live': 'Live',
  'regie.monitoring.connection.offline': 'Offline',
  'regie.monitoring.connection.offlineSince': 'Offline · as of {time}',

  'regie.monitoring.empty.loading': 'Loading measurements…',
  'regie.monitoring.empty.loadingHint': 'The control room is connecting to the server.',
  'regie.monitoring.empty.none': 'No devices yet.',
  'regie.monitoring.empty.noneHint':
    'In the control room, use “Add device” to connect a phone or a laptop. Its measurements appear here.',

  'regie.monitoring.sortHint':
    'Click a column heading to sort. A third click returns to the order of the devices.',

  'regie.monitoring.seen.minutes': '{value} min ago',
  'regie.monitoring.seen.seconds': '{value} s ago',

  'regie.monitoring.slot.ended': 'ended',
  'regie.monitoring.slot.failed': 'error',
  'regie.monitoring.slot.live': 'live',
  'regie.monitoring.slot.none': 'none',
  'regie.monitoring.slot.paused': 'paused',
  'regie.monitoring.slot.starting': 'starting',

  'regie.monitoring.stateSending': 'sending',

  'regie.monitoring.summary.incidents': {
    '=0': 'no issues',
    one: '{count} issue',
    other: '{count} issues',
  },
  'regie.monitoring.summary.sending': { one: '{count} sending', other: '{count} sending' },
  'regie.monitoring.summary.stations': { one: '{count} device', other: '{count} devices' },

  'regie.monitoring.tech.bad': 'poor',
  'regie.monitoring.tech.notRun': 'not run',
  'regie.monitoring.tech.ok': 'ok',
  'regie.monitoring.tech.unknown': 'unknown',
  'regie.monitoring.tech.warn': 'marginal',

  'regie.monitoring.title': 'Monitoring',
} as const satisfies Namespace<'regie.monitoring'>;
