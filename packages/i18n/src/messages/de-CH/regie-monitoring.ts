import type { Translation } from '../../types';
import type { regieMonitoring as en } from '../en/regie-monitoring';

export const regieMonitoring: Translation<typeof en> = {
  'regie.monitoring.batteryCharging': '{percent} · lädt',
  'regie.monitoring.caption': 'Geräte mit Messwerten, laufend aktualisiert',
  'regie.monitoring.lead':
    'Laufende Messwerte jedes Geräts, etwa alle 2 Sekunden. Geräte mit einem Problem stehen zuoberst.',

  'regie.monitoring.column.battery': 'Akku',
  'regie.monitoring.column.bitrate': 'Bitrate',
  'regie.monitoring.column.codes': 'Quelle',
  'regie.monitoring.column.encoding': 'Codierung',
  'regie.monitoring.column.fps': 'Bildrate',
  'regie.monitoring.column.loss': 'Paketverlust',
  'regie.monitoring.column.network': 'Netz',
  'regie.monitoring.column.resolution': 'Auflösung',
  'regie.monitoring.column.rtt': 'Umlaufzeit',
  'regie.monitoring.column.seen': 'Zuletzt',
  'regie.monitoring.column.state': 'Zustand',
  'regie.monitoring.column.station': 'Gerät',
  'regie.monitoring.column.tech': 'Technik-Check',

  'regie.monitoring.connection.connecting': 'Verbindet …',
  'regie.monitoring.connection.live': 'Live',
  'regie.monitoring.connection.offline': 'Offline',
  'regie.monitoring.connection.offlineSince': 'Offline · Stand {time}',

  'regie.monitoring.empty.loading': 'Messwerte werden geladen …',
  'regie.monitoring.empty.loadingHint': 'Die Regie verbindet mit dem Server.',
  'regie.monitoring.empty.none': 'Noch keine Geräte.',
  'regie.monitoring.empty.noneHint':
    'In der Regie mit «Gerät hinzufügen» ein Handy oder einen Laptop verbinden. Seine Messwerte erscheinen hier.',

  'regie.monitoring.sortHint':
    'Ein Klick auf eine Spaltenüberschrift sortiert. Ein dritter Klick stellt die Reihenfolge der Geräte wieder her.',

  'regie.monitoring.seen.minutes': 'vor {value} min',
  'regie.monitoring.seen.seconds': 'vor {value} s',

  'regie.monitoring.slot.ended': 'beendet',
  'regie.monitoring.slot.failed': 'Fehler',
  'regie.monitoring.slot.live': 'live',
  'regie.monitoring.slot.none': 'keine',
  'regie.monitoring.slot.paused': 'pausiert',
  'regie.monitoring.slot.starting': 'startet',

  'regie.monitoring.stateSending': 'sendet',

  'regie.monitoring.summary.incidents': {
    '=0': 'keine Probleme',
    one: '{count} Problem',
    other: '{count} Probleme',
  },
  'regie.monitoring.summary.sending': { one: '{count} sendet', other: '{count} senden' },
  'regie.monitoring.summary.stations': { one: '{count} Gerät', other: '{count} Geräte' },

  'regie.monitoring.tech.bad': 'schlecht',
  'regie.monitoring.tech.notRun': 'nicht gelaufen',
  'regie.monitoring.tech.ok': 'ok',
  'regie.monitoring.tech.unknown': 'unbekannt',
  'regie.monitoring.tech.warn': 'knapp',

  'regie.monitoring.title': 'Monitoring',
  'regie.monitoring.row.copy': 'Details kopieren',
  'regie.monitoring.row.menu': 'Aktionen für {name}',
  'regie.monitoring.row.show': 'In der Regie zeigen',
};
