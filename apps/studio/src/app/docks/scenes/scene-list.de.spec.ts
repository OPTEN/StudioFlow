import { resetLocaleForTests } from '@studioflow/i18n';
import { itemFixture, sceneFixture } from '../../../testing/fixtures';
import { copyName, nextSceneName, sceneRowView } from './scene-list';

const K1 = 'dev_aaaaaaaaaaaaaaaa/camera';

describe('scene list helpers in German', () => {
  beforeEach(() => resetLocaleForTests('de-CH'));

  it('words the row labels like the German UI', () => {
    const scene = sceneFixture('scn_b', 'Lea präsentiert', 2, [itemFixture('itm_1', K1)]);
    const base = {
      programSceneId: 'scn_b',
      previewSceneId: 'scn_b',
      studioMode: true,
      health: { code: 'K2', bad: false },
      codeOf: () => 'K1',
    };
    expect(
      sceneRowView(sceneFixture('scn_x', 'Pause', 1), 1, { ...base, health: null }).codes,
    ).toBe('leer');
  });

  it('names new scenes and copies with the German words', () => {
    expect(nextSceneName([{ name: 'A' }])).toBe('Neue Szene 2');
    expect(copyName('Intro', [{ name: 'Intro' }, { name: 'Intro (Kopie)' }])).toBe(
      'Intro (Kopie 2)',
    );
  });
});
