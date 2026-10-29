import type { Translation } from '../../types';
import type { outputClock as en } from '../en/output-clock';

export const outputClock: Translation<typeof en> = {
  'output.clock.hint':
    'Mit einer Kamera filmen, die in StudioFlow live ist, und Uhr und Output gemeinsam fotografieren. Die Differenz ist die Latenz.',
  'output.clock.label': 'Messuhr',
  'output.clock.title': 'StudioFlow Uhr',
};
