import { t } from '@studioflow/i18n';

/** Small headcounts are spelled out (“Two people in the control room”, docs/testing.md DEV-15); larger ones use the numeral. */
export function presenceText(count: number): string {
  switch (count) {
    case 2:
      return t('regie.header.presence.two');
    case 3:
      return t('regie.header.presence.three');
    case 4:
      return t('regie.header.presence.four');
    case 5:
      return t('regie.header.presence.five');
    case 6:
      return t('regie.header.presence.six');
    case 7:
      return t('regie.header.presence.seven');
    case 8:
      return t('regie.header.presence.eight');
    case 9:
      return t('regie.header.presence.nine');
    default:
      return t('regie.header.presence.long', { count });
  }
}
