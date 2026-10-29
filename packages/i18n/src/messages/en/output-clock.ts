import type { Namespace } from '../../types';

/** The measurement clock of the output page (`/o/_clock`). */
export const outputClock = {
  'output.clock.hint':
    'Film the clock with a camera that is live in StudioFlow, and photograph the clock and the output together. The difference is the latency.',
  'output.clock.label': 'Measurement clock',
  'output.clock.title': 'StudioFlow clock',
} as const satisfies Namespace<'output.clock'>;
