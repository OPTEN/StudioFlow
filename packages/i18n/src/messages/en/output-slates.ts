import type { Namespace } from '../../types';

/**
 * The notice the output page shows by itself when it may not show the program. The standby and end slates come from
 * the production. A refused link never says which check failed, so a wrong key and an unknown slug look the same.
 */
export const outputSlates = {
  'output.slates.noAccess.incomplete':
    'This link is incomplete. Copy the whole output link from the control room again.',
  'output.slates.noAccess.retry': {
    one: 'This page tries again by itself every second.',
    other: 'This page tries again by itself every {count} seconds.',
  },
  'output.slates.noAccess.subtitle':
    'The link is wrong or no longer valid, or this computer is not allowed to use it. Ask the control room for the current output link.',
  'output.slates.noAccess.title': 'No access',
} as const satisfies Namespace<'output.slates'>;
