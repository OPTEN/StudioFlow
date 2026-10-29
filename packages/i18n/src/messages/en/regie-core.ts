import type { Namespace } from '../../types';

/**
 * Shared plumbing of the Regie shell: the document title (with the broadcast state and the open issues), the clipboard
 * toasts, the dismiss button of a toast, the default name of the confirmation box and the connection texts of the
 * production store.
 */
export const regieCore = {
  'regie.core.appTitle': 'StudioFlow Control room',
  'regie.core.clipboard.copied': 'Copied: {text}',
  'regie.core.clipboard.selected': 'Selected. Press Ctrl+C to copy.',
  'regie.core.clipboard.unavailable':
    'Copying is not possible here. Please select the link and copy it with Ctrl+C.',
  'regie.core.confirm.label': 'Confirmation',
  'regie.core.store.noActiveProduction': 'No active production found.',
  'regie.core.store.serverUnreachable':
    'The server is not reachable. The control room is reconnecting…',
  'regie.core.store.stationsLoading': 'Devices…',
  'regie.core.title.issues': { one: '{count} issue', other: '{count} issues' },
  'regie.core.title.onAir': '● On air',
  'regie.core.toast.dismiss': 'Dismiss',
} as const satisfies Namespace<'regie.core'>;
