import type { Namespace } from '../../types';

/**
 * Duplicating, exporting and importing a production (production menu, issue #14): the menu entries, the duplicate form and
 * the import with its preview. The messages of a refused file are the API codes of `errors.code.*`.
 */
export const regieTransfer = {
  'regie.transfer.duplicate.busy': 'Duplicating…',
  'regie.transfer.duplicate.defaultName': '{name} (copy)',
  'regie.transfer.duplicate.done':
    'Production “{name}” created. It is not active; switch to it when you are ready.',
  'regie.transfer.duplicate.hint':
    'The copy takes over the scenes, texts, media and settings. Cameras and screens become placeholders for the devices you pair next. Pairings, invites, output links and the log are not copied, and the copy does not become the active production.',
  'regie.transfer.duplicate.media': {
    '=0': 'There are no media files to copy.',
    one: '{count} media file ({size}) is copied.',
    other: '{count} media files ({size}) are copied.',
  },
  'regie.transfer.duplicate.name': 'Name of the copy',
  'regie.transfer.duplicate.submit': 'Duplicate',
  'regie.transfer.duplicate.title': 'Duplicate production',

  'regie.transfer.export.started': 'Export of “{name}” started. Your browser saves the file.',

  'regie.transfer.import.another': 'Choose another file',
  'regie.transfer.import.busy': 'Importing…',
  'regie.transfer.import.checking': 'Checking “{file}”…',
  'regie.transfer.import.choose': 'Choose file…',
  'regie.transfer.import.done':
    'Production “{name}” imported. It is not active; switch to it when you are ready.',
  'regie.transfer.import.hint':
    'Choose a file exported from StudioFlow (.studioflow.zip). You see what it contains before anything is created.',
  'regie.transfer.import.media': {
    '=0': 'No media files',
    one: '{count} media file · {size}',
    other: '{count} media files · {size}',
  },
  'regie.transfer.import.name': 'Name',
  'regie.transfer.import.placeholders': 'Cameras and screens',
  'regie.transfer.import.previewTitle': 'This file contains',
  'regie.transfer.import.progress': 'Uploaded {percent}',
  'regie.transfer.import.scenes': { one: '{count} scene', other: '{count} scenes' },
  'regie.transfer.import.submit': 'Import',
  'regie.transfer.import.texts': {
    '=0': 'No texts',
    one: '{count} text',
    other: '{count} texts',
  },
  'regie.transfer.import.title': 'Import production',
  'regie.transfer.import.unnamed': 'removed source',
  'regie.transfer.import.version': 'Exported with StudioFlow {version}',
  'regie.transfer.import.warning.nameChanged':
    'A production with this name exists already. It is imported as “{name}”.',
  'regie.transfer.import.warning.placeholders': {
    one: '{count} camera or screen of the original becomes a placeholder. Pair a device and assign it to bring the picture back.',
    other:
      '{count} cameras and screens of the original become placeholders. Pair devices and assign them to bring the pictures back.',
  },

  'regie.transfer.menu.duplicate': 'Duplicate production…',
  'regie.transfer.menu.export': 'Export',
  'regie.transfer.menu.import': 'Import…',
} as const satisfies Namespace<'regie.transfer'>;
