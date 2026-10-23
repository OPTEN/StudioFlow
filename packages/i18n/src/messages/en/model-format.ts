import type { Namespace } from '../../types';

/** Short units and counts used by the formatting helpers of `@studioflow/scene-model`. */
export const modelFormat = {
  'model.format.itemCount': { one: '{count} item', other: '{count} items' },
  'model.format.minutesShort': '{value} min',
  'model.format.percent': '{value}%',
  'model.format.secondsShort': '{value} s',
} as const satisfies Namespace<'model.format'>;
