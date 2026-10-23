import type { Namespace } from '../../types';

/** Texts the output page shows by itself. The standby and end slates come from the production. */
export const outputSlates = {
  'output.slates.clockHint':
    'Film the clock with a camera that is live in StudioFlow, and photograph the clock and the output together. The difference is the latency.',
  'output.slates.noAccess.subtitle': 'The output link is invalid or has expired.',
  'output.slates.noAccess.title': 'No access',
} as const satisfies Namespace<'output.slates'>;
