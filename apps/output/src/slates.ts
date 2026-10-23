import type { SlateDto } from '@studioflow/scene-model';

/**
 * Texts the output page shows by itself (DESIGN.md, spec 9.3). Everything else on the page comes from the
 * production: the standby and end slates, and the renderer's hold message «Bild kommt gleich zurück».
 */

/** Shown for a wrong, rotated or incomplete link, an unknown slug or a refused IP address (403 / 404). */
export const NO_ACCESS_SLATE: SlateDto = {
  title: 'Kein Zugang',
  subtitle: 'Der Output-Link ist ungültig oder abgelaufen.',
  backgroundAssetId: null,
};

/** Hint under the measurement clock (`/o/_uhr`, plan phase 0). */
export const CLOCK_HINT =
  'Mit einer Kamera filmen, die in StudioFlow live ist, und Uhr und Output gemeinsam fotografieren. ' +
  'Die Differenz ist die Latenz.';
