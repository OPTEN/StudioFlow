import type { Translation } from '../../types';
import type { outputSlates as en } from '../en/output-slates';

export const outputSlates: Translation<typeof en> = {
  'output.slates.noAccess.incomplete':
    'Dieser Link ist unvollständig. Den ganzen Output-Link nochmals aus der Regie kopieren.',
  'output.slates.noAccess.retry': {
    one: 'Diese Seite versucht es jede Sekunde von selbst erneut.',
    other: 'Diese Seite versucht es alle {count} Sekunden von selbst erneut.',
  },
  'output.slates.noAccess.subtitle':
    'Der Link ist falsch oder nicht mehr gültig, oder dieser Computer darf ihn nicht verwenden. Die Regie um den aktuellen Output-Link bitten.',
  'output.slates.noAccess.title': 'Kein Zugang',
};
