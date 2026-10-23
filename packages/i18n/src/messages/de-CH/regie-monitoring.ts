import type { Translation } from '../../types';
import type { regieMonitoring as en } from '../en/regie-monitoring';

export const regieMonitoring: Translation<typeof en> = {
  'regie.monitoring.back': 'Zurück zur Regie',
  'regie.monitoring.batteryCharging': '{percent} · lädt',
  'regie.monitoring.caption': 'Stationen mit Messwerten, laufend aktualisiert',

  'regie.monitoring.column.battery': 'Akku',
  'regie.monitoring.column.codes': 'Quellen',
  'regie.monitoring.column.loss': 'Verlust',
  'regie.monitoring.column.network': 'Netz',
  'regie.monitoring.column.resolution': 'Auflösung',
  'regie.monitoring.column.seen': 'Zuletzt',
  'regie.monitoring.column.state': 'Zustand',
  'regie.monitoring.column.station': 'Station',
  'regie.monitoring.column.tech': 'Technik-Check',

  'regie.monitoring.connection.connecting': 'Verbindet …',
  'regie.monitoring.connection.live': 'Live',
  'regie.monitoring.connection.offline': 'Offline',
  'regie.monitoring.connection.offlineSince': 'Offline · Stand {time}',

  'regie.monitoring.empty.loading': 'Messwerte werden geladen …',
  'regie.monitoring.empty.loadingHint': 'Die Regie verbindet mit dem Server.',
  'regie.monitoring.empty.none': 'Noch keine Stationen.',
  'regie.monitoring.empty.noneHint':
    'In der Regie unter «Gerät koppeln» ein Handy oder einen Laptop verbinden.',

  'regie.monitoring.note':
    'Werte kommen etwa alle 2 s von den Geräten. Ein Klick auf eine Spalte sortiert.',

  'regie.monitoring.seen.minutes': 'vor {value} min',
  'regie.monitoring.seen.seconds': 'vor {value} s',

  'regie.monitoring.slot.ended': 'beendet',
  'regie.monitoring.slot.failed': 'Fehler',
  'regie.monitoring.slot.live': 'live',
  'regie.monitoring.slot.none': 'keine',
  'regie.monitoring.slot.paused': 'pausiert',
  'regie.monitoring.slot.starting': 'startet',

  'regie.monitoring.stateSending': 'sendet',
  'regie.monitoring.stations': 'Stationen',

  'regie.monitoring.summary.incidents': {
    '=0': 'keine Störung',
    one: '{count} Störung',
    other: '{count} Störungen',
  },
  'regie.monitoring.summary.sending': { one: '{count} sendet', other: '{count} senden' },
  'regie.monitoring.summary.stations': { one: '{count} Station', other: '{count} Stationen' },

  'regie.monitoring.tech.bad': 'schlecht',
  'regie.monitoring.tech.notRun': 'nicht gelaufen',
  'regie.monitoring.tech.ok': 'ok',
  'regie.monitoring.tech.unknown': 'unbekannt',
  'regie.monitoring.tech.warn': 'knapp',

  'regie.monitoring.title': 'Monitoring',
};
