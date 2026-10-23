import type { Translation } from '../../types';
import type { modelFormat as en } from '../en/model-format';

export const modelFormat: Translation<typeof en> = {
  'model.format.itemCount': { one: '{count} Element', other: '{count} Elemente' },
  'model.format.minutesShort': '{value} min',
  'model.format.percent': '{value} %',
  'model.format.secondsShort': '{value} s',
};
