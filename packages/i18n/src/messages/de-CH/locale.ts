import type { Translation } from '../../types';
import type { locale as en } from '../en/locale';

export const locale: Translation<typeof en> = {
  'locale.auto': 'Automatisch (Browsersprache)',
  'locale.label': 'Sprache der Oberfläche',
};
