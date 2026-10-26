import type { Translation } from '../../types';
import type { regieAudit as en } from '../en/regie-audit';

export const regieAudit: Translation<typeof en> = {
  'regie.audit.actor.admin': 'Admin',
  'regie.audit.actor.device': 'Gerät',
  'regie.audit.actor.deviceNamed': 'Gerät {name}',
  'regie.audit.actor.system': 'System',

  'regie.audit.back': 'Zurück zur Regie',
  'regie.audit.caption': 'Einträge des Protokolls, die neuesten zuerst',

  'regie.audit.category.devices': 'Geräte',
  'regie.audit.category.label': 'Kategorie',
  'regie.audit.category.media': 'Medien',
  'regie.audit.category.output': 'Output',
  'regie.audit.category.production': 'Produktion',
  'regie.audit.category.security': 'Zugriff und Sicherheit',
  'regie.audit.category.system': 'System',

  'regie.audit.clear': 'Filter zurücksetzen',

  'regie.audit.column.actor': 'Wer',
  'regie.audit.column.event': 'Was',
  'regie.audit.column.production': 'Produktion',
  'regie.audit.column.time': 'Zeit',

  'regie.audit.count': { one: '{count} Eintrag geladen', other: '{count} Einträge geladen' },

  'regie.audit.details.action': 'Aktion',
  'regie.audit.details.actor': 'Akteur',
  'regie.audit.details.entry': 'Eintrag',
  'regie.audit.details.hide': 'Details des Eintrags von {time} ausblenden',
  'regie.audit.details.show': 'Details des Eintrags von {time} einblenden',
  'regie.audit.details.time': 'Genaue Zeit (UTC)',

  'regie.audit.empty.hint': 'Filter ändern oder zurücksetzen.',
  'regie.audit.empty.none': 'Keine passenden Einträge.',

  'regie.audit.error.load': 'Das Protokoll konnte nicht geladen werden.',
  'regie.audit.error.more': 'Weitere Einträge konnten nicht geladen werden.',
  'regie.audit.error.retry': 'Erneut versuchen',

  'regie.audit.export.csv': 'CSV exportieren',
  'regie.audit.export.done': '{name} exportiert',
  'regie.audit.export.json': 'JSON exportieren',
  'regie.audit.export.label': 'Die gefilterten Einträge exportieren',
  'regie.audit.export.running': 'Exportiert…',
  'regie.audit.export.tooLarge': 'Der Export wäre zu gross. Zeitraum oder Filter einschränken.',

  'regie.audit.filters.label': 'Filter',
  'regie.audit.live': 'Neue Einträge erscheinen oben, solange diese Seite offen ist.',
  'regie.audit.loading': 'Protokoll wird geladen…',
  'regie.audit.loadMore': 'Mehr laden',
  'regie.audit.loadingMore': 'Lädt…',
  'regie.audit.menu': 'Protokoll',

  'regie.audit.production.active': '{name} (aktiv)',
  'regie.audit.production.all': 'Alle Produktionen',
  'regie.audit.production.label': 'Produktion',
  'regie.audit.production.none': 'Ohne Produktion (Anmeldungen und Konto)',

  'regie.audit.range.any': 'Beliebige Zeit',
  'regie.audit.range.custom': 'Eigener Zeitraum',
  'regie.audit.range.from': 'Von',
  'regie.audit.range.invalid': 'Das Ende muss nach dem Anfang liegen.',
  'regie.audit.range.label': 'Zeitraum',
  'regie.audit.range.lastBroadcast': 'Letzte Sendung',
  'regie.audit.range.noBroadcast': 'Diese Produktion hatte noch keine Sendung.',
  'regie.audit.range.noProduction': 'Zuerst eine Produktion wählen.',
  'regie.audit.range.to': 'Bis',
  'regie.audit.range.today': 'Heute',

  'regie.audit.search.label': 'Suche',
  'regie.audit.search.placeholder': 'Gerät, Szene, Benutzer…',

  'regie.audit.title': 'Protokoll',
};
