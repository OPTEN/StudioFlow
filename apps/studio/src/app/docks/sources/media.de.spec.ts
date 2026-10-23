import { resetLocaleForTests, tm } from '@studioflow/i18n';
import { itemFixture, sceneFixture } from '../../../testing/fixtures';
import { assetUsage, usageSentence } from './source-rows';
import { validateUpload } from './upload-validation';

describe('media texts in German', () => {
  beforeEach(() => resetLocaleForTests('de-CH'));

  it('words the upload checks with « » and the Swiss spelling', () => {
    const check = validateUpload({ name: 'gross.png', type: 'image/png', size: 26 * 1024 * 1024 });
    expect(check.ok ? '' : tm(check.message)).toBe(
      '«gross.png» ist zu gross. Bilder dürfen höchstens 25 MB gross sein.',
    );
  });

  it('joins the places where a medium is used with "und"', () => {
    const scenes = [
      sceneFixture('scn_a', 'Pause', 0, [itemFixture('itm_1', 'ast_a')]),
      sceneFixture('scn_b', 'Intro', 1, [], { background: { color: '#000000', assetId: 'ast_a' } }),
    ];
    const usage = assetUsage('ast_a', scenes, null);
    expect(usageSentence(usage)).toBe('Wird in «Pause» und als Hintergrund von «Intro» verwendet.');
    expect(usageSentence([])).toBe('Wird noch verwendet.');
  });
});
