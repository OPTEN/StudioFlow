import type { Namespace } from '../../types';

/** The `/audit` page (the activity log): who did what and when, with filters and an export. */
export const regieAudit = {
  'regie.audit.actor.admin': 'Admin',
  'regie.audit.actor.device': 'Device',
  'regie.audit.actor.deviceNamed': 'Device {name}',
  'regie.audit.actor.system': 'System',

  'regie.audit.caption': 'Entries of the activity log, newest first',
  'regie.audit.lead':
    'Who did what and when. New entries appear at the top while this page is open.',

  'regie.audit.category.devices': 'Devices',
  'regie.audit.category.label': 'Category',
  'regie.audit.category.media': 'Media',
  'regie.audit.category.output': 'Output',
  'regie.audit.category.production': 'Production',
  'regie.audit.category.security': 'Access and security',
  'regie.audit.category.system': 'System',

  'regie.audit.clear': 'Clear filters',

  'regie.audit.column.actor': 'Who',
  'regie.audit.column.event': 'What',
  'regie.audit.column.production': 'Production',
  'regie.audit.column.time': 'Time',

  'regie.audit.count': { one: 'Showing {count} entry', other: 'Showing {count} entries' },

  'regie.audit.details.action': 'Event code',
  'regie.audit.details.actor': 'Recorded as',
  'regie.audit.details.entry': 'Entry',
  'regie.audit.details.hide': 'Hide the details of the entry from {time}',
  'regie.audit.details.show': 'Show the details of the entry from {time}',
  'regie.audit.details.time': 'In UTC',
  'regie.audit.details.when': 'When',
  'regie.audit.details.who': 'Who',

  'regie.audit.empty.hint': 'Change or clear the filters to see more.',
  'regie.audit.empty.none': 'No entries match.',

  'regie.audit.error.load': 'The activity log could not be loaded.',
  'regie.audit.error.more': 'More entries could not be loaded.',
  'regie.audit.error.retry': 'Try again',

  'regie.audit.export.csv': 'Export as CSV',
  'regie.audit.export.csvSub': 'For spreadsheets',
  'regie.audit.export.done': '{name} exported',
  'regie.audit.export.json': 'Export as JSON',
  'regie.audit.export.jsonSub': 'For other programs',
  'regie.audit.export.label': 'Export the filtered entries',
  'regie.audit.export.menu': 'Export',
  'regie.audit.export.running': 'Exporting…',
  'regie.audit.export.tooLarge':
    'The export would be too large. Narrow the time range or the filters.',

  'regie.audit.filters.label': 'Filters',
  'regie.audit.loading': 'Loading the activity log…',
  'regie.audit.loadMore': 'Load more',
  'regie.audit.loadingMore': 'Loading…',
  'regie.audit.menu': 'Audit log',

  'regie.audit.production.active': '{name} (active)',
  'regie.audit.production.all': 'All productions',
  'regie.audit.production.label': 'Production',
  'regie.audit.production.none': 'Without production (sign-ins, account)',

  'regie.audit.range.any': 'Any time',
  'regie.audit.range.broadcast': 'The last broadcast of “{name}”: {from} to {to}.',
  'regie.audit.range.broadcastLive': 'The broadcast of “{name}”, on air since {from}.',
  'regie.audit.range.custom': 'Custom',
  'regie.audit.range.from': 'From',
  'regie.audit.range.invalid': 'The end must be after the start.',
  'regie.audit.range.label': 'Time range',
  'regie.audit.range.lastBroadcast': 'Last broadcast',
  'regie.audit.range.noBroadcast': 'This production has no broadcast yet.',
  'regie.audit.range.noProduction': 'Choose a production first.',
  'regie.audit.range.to': 'To',
  'regie.audit.range.today': 'Today',

  'regie.audit.search.label': 'Search',
  'regie.audit.search.placeholder': 'Device, scene, user…',

  'regie.audit.title': 'Activity log',
  'regie.audit.column.actions': 'Actions',
  'regie.audit.details.raw': 'Recorded values',
  'regie.audit.details.summary': 'Summary',
  'regie.audit.details.tabs': 'Details of the entry',
  'regie.audit.details.what': 'What',
  'regie.audit.row.byCategory': 'Show only “{category}”',
  'regie.audit.row.byProduction': 'Show only “{name}”',
  'regie.audit.row.copy': 'Copy entry',
  'regie.audit.row.details': 'Show details',
  'regie.audit.row.hideDetails': 'Hide details',
  'regie.audit.row.menu': 'Actions for the entry from {time}',
  'regie.audit.row.noProduction': 'No production to filter by',
  'regie.audit.search.shortcut': 'Search the activity log ({key})',
} as const satisfies Namespace<'regie.audit'>;
