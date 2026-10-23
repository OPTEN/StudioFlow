import type { Namespace } from '../../types';

/** The measurement clock of the output page (`/o/_clock`). The hint under the clock is in `output-slates`. */
export const outputClock = {
  'output.clock.label': 'Measurement clock',
  'output.clock.title': 'StudioFlow clock',
} as const satisfies Namespace<'output.clock'>;
