import { t } from '@studioflow/i18n';
import type { SlateDto } from '@studioflow/scene-model';

/**
 * Texts the output page shows by itself (DESIGN.md, spec 9.3). Everything else on the page comes from the
 * production: the standby and end slates, and the renderer's hold message “Picture returns shortly”.
 *
 * They are functions, not constants: the language is only known once the page has started (`?lang=`, then the browser
 * language), so the text is looked up when it is shown.
 */

/** Shown for a wrong, rotated or incomplete link, an unknown slug or a refused IP address (403 / 404). */
export function noAccessSlate(): SlateDto {
  return {
    title: t('output.slates.noAccess.title'),
    subtitle: t('output.slates.noAccess.subtitle'),
    backgroundAssetId: null,
  };
}

/** Hint under the measurement clock (`/o/_clock`, plan phase 0). */
export function clockHint(): string {
  return t('output.slates.clockHint');
}
