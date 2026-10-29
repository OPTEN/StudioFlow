import { t } from '@studioflow/i18n';
import type { SlateDto } from '@studioflow/scene-model';
import type { SlateNotice } from '@studioflow/scene-renderer';
import { ACCESS_RETRY_MS } from './access-guard';

/**
 * The texts the output page shows by itself (DESIGN.md, spec 9.3): the “No access” notice and the document title.
 * Everything else on the page comes from the production: the standby and end slates, and the renderer's hold message
 * “Picture returns shortly”.
 *
 * They are functions, not constants: the language is only known once the page has started (`?lang=`, then the browser
 * language), so the text is looked up when it is shown.
 */

/**
 * Why the page shows “No access”: the server refused the link (`refused`: a wrong, regenerated or revoked key, an
 * unknown slug or an address that is not allowed – deliberately one text, so nothing tells whether a slug exists), or
 * the link cannot work at all (`incomplete`: no key or a malformed one; the page makes no request and never retries).
 */
export type NoAccessCause = 'refused' | 'incomplete';

/** “No access” with the cause in plain words and what to do about it. */
export function noAccessSlate(cause: NoAccessCause = 'refused'): SlateDto {
  return {
    title: t('output.slates.noAccess.title'),
    subtitle: t(
      cause === 'refused' ? 'output.slates.noAccess.subtitle' : 'output.slates.noAccess.incomplete',
    ),
    backgroundAssetId: null,
  };
}

/** Draws “No access” as a notice of the page; a refused link also says that the page keeps trying by itself. */
export function noAccessNotice(cause: NoAccessCause = 'refused'): SlateNotice {
  return {
    note:
      cause === 'refused'
        ? t('output.slates.noAccess.retry', { count: Math.round(ACCESS_RETRY_MS / 1000) })
        : null,
  };
}

/**
 * The document title: the production once its state is known, or “No access”. It is not part of the picture; it tells
 * several output tabs or browser sources apart.
 */
export function pageTitle(productionName: string | null, denied: boolean): string {
  if (denied) {
    return t('output.page.titleDenied');
  }
  return productionName
    ? t('output.page.titleNamed', { name: productionName })
    : t('output.page.title');
}
