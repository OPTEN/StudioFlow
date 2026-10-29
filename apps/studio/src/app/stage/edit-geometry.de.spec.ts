import { resetLocaleForTests } from '@studioflow/i18n';
import type { CropDto } from '@studioflow/scene-model';
import { boxDetail, cropSummary } from './edit-geometry';

const NO_CROP: CropDto = { top: 0, right: 0, bottom: 0, left: 0 };

describe('edit geometry labels in German', () => {
  beforeEach(() => resetLocaleForTests('de-CH'));

  it('names the cropped sides left, right, top (oben) and bottom (unten)', () => {
    expect(cropSummary({ top: 0.05, right: 0, bottom: 0.002, left: 0.25 })).toBe(
      'L 25 % O 5 % U 1 %',
    );
    expect(boxDetail({ x: 0, y: 0, w: 540.4, h: 338 }, { ...NO_CROP, right: 0.1 })).toBe(
      '540 × 338 · Zuschnitt R 10 %',
    );
  });
});
