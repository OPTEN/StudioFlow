import type { Namespace } from '../../types';

/** Words every screen needs. Frozen after the foundation: feature namespaces repeat a word rather than extend this. */
export const common = {
  'common.add': 'Add',
  'common.apply': 'Apply',
  'common.back': 'Back',
  'common.cancel': 'Cancel',
  'common.close': 'Close',
  'common.copy': 'Copy',
  'common.delete': 'Delete',
  'common.edit': 'Edit',
  'common.language': 'Language',
  'common.loading': 'Loading…',
  'common.next': 'Next',
  'common.no': 'No',
  'common.ok': 'OK',
  'common.remove': 'Remove',
  'common.rename': 'Rename',
  'common.reset': 'Reset',
  'common.retry': 'Try again',
  'common.save': 'Save',
  'common.yes': 'Yes',
} as const satisfies Namespace<'common'>;
