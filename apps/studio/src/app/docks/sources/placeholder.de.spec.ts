import { resetLocaleForTests, t } from '@studioflow/i18n';
import { itemFixture, placeholderFixture, sceneFixture } from '../../../testing/fixtures';
import { placeholderRows } from './placeholder-view';
import { sourceRows } from './source-rows';

describe('placeholder texts in German', () => {
  beforeEach(() => resetLocaleForTests('de-CH'));

  it('says where a missing source is used, with the plural forms', () => {
    const k1 = placeholderFixture('K1', 'Bühne links');
    const scenes = [
      sceneFixture('scn_a', 'A', 0, [itemFixture('itm_1', k1.sourceId)]),
      sceneFixture('scn_b', 'B', 1, [itemFixture('itm_2', k1.sourceId)]),
    ];
    expect(placeholderRows([k1], scenes)[0].usedIn).toBe('in 2 Szenen');
    expect(placeholderRows([k1], scenes.slice(0, 1))[0].usedIn).toBe('in 1 Szene');
    expect(placeholderRows([k1], [])[0].usedIn).toBe('in keiner Szene');
  });

  it('words the row of a placeholder and the removal of its items', () => {
    const k1 = placeholderFixture('K1', null);
    const scene = sceneFixture('scn_a', 'A', 0, [itemFixture('itm_1', k1.sourceId)]);
    const [row] = sourceRows(scene, new Map(), null, [k1]);
    expect(row.name).toBe('entfernte Quelle');
    expect(row.state?.word).toBe('Quelle fehlt');
    expect(t('regie.placeholders.remove.message', { name: 'K1', count: 1 })).toBe(
      'Das 1 Element, das K1 zeigt, wird aus seiner Szene entfernt.',
    );
    expect(t('regie.placeholders.offer.useAs', { name: 'K1 · Bühne links' })).toBe(
      'Verwenden als K1 · Bühne links',
    );
  });

  it('words the transfer menu and the refused files', () => {
    expect(t('regie.transfer.menu.duplicate')).toBe('Produktion duplizieren …');
    expect(t('regie.transfer.menu.import')).toBe('Importieren …');
    expect(t('regie.transfer.import.scenes', { count: 3 })).toBe('3 Szenen');
    expect(t('errors.code.unsupported_format')).toContain('neueren Version');
  });
});
