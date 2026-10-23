import type { Translation } from '../../types';
import type { outputSlates as en } from '../en/output-slates';

export const outputSlates: Translation<typeof en> = {
  'output.slates.clockHint':
    'Mit einer Kamera filmen, die in StudioFlow live ist, und Uhr und Output gemeinsam fotografieren. Die Differenz ist die Latenz.',
  'output.slates.noAccess.subtitle': 'Der Output-Link ist ungültig oder abgelaufen.',
  'output.slates.noAccess.title': 'Kein Zugang',
};
