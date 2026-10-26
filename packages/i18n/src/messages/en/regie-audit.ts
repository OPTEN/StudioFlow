import type { Namespace } from '../../types';

/** The `/audit` page: who did what and when, with filters and an export. */
export const regieAudit = {
  'regie.audit.actor.admin': 'Admin',
  'regie.audit.actor.device': 'Device',
  'regie.audit.actor.deviceNamed': 'Device {name}',
  'regie.audit.actor.system': 'System',

  'regie.audit.back': 'Back to the control room',
  'regie.audit.caption': 'Entries of the audit log, newest first',

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

  'regie.audit.count': { one: '{count} entry loaded', other: '{count} entries loaded' },

  'regie.audit.details.action': 'Action',
  'regie.audit.details.actor': 'Actor',
  'regie.audit.details.entry': 'Entry',
  'regie.audit.details.hide': 'Hide the details of the entry from {time}',
  'regie.audit.details.show': 'Show the details of the entry from {time}',
  'regie.audit.details.time': 'Exact time (UTC)',

  'regie.audit.empty.hint': 'Change or clear the filters.',
  'regie.audit.empty.none': 'No entries match.',

  'regie.audit.error.load': 'The audit log could not be loaded.',
  'regie.audit.error.more': 'More entries could not be loaded.',
  'regie.audit.error.retry': 'Try again',

  'regie.audit.export.csv': 'Export CSV',
  'regie.audit.export.done': '{name} exported',
  'regie.audit.export.json': 'Export JSON',
  'regie.audit.export.label': 'Export the filtered entries',
  'regie.audit.export.running': 'Exporting…',
  'regie.audit.export.tooLarge':
    'The export would be too large. Narrow the time range or the filters.',

  'regie.audit.filters.label': 'Filters',
  'regie.audit.live': 'New entries appear at the top while this page is open.',
  'regie.audit.loading': 'Loading the audit log…',
  'regie.audit.loadMore': 'Load more',
  'regie.audit.loadingMore': 'Loading…',
  'regie.audit.menu': 'Audit log',

  'regie.audit.production.active': '{name} (active)',
  'regie.audit.production.all': 'All productions',
  'regie.audit.production.label': 'Production',
  'regie.audit.production.none': 'No production (sign-ins and account)',

  'regie.audit.range.any': 'Any time',
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

  'regie.audit.title': 'Audit log',
} as const satisfies Namespace<'regie.audit'>;
