import { clampItem, type SourceDto } from '@studioflow/scene-model';
import { itemFixture, sourceFixture } from '../../../testing/fixtures';
import {
  cropToPercent,
  fallbackGroups,
  hasCrop,
  holdChoices,
  holdValue,
  parseHoldValue,
  withBorderEnabled,
  withCropPercent,
  withoutCrop,
} from './inspector-math';

describe('inspector math', () => {
  const item = itemFixture('itm_1', 'dev_aaaaaaaaaaaaaaaa/camera');

  it('converts crop fractions to percent with one decimal and back', () => {
    expect(cropToPercent(0.125)).toBe(12.5);
    expect(cropToPercent(Number.NaN)).toBe(0);
    const cropped = withCropPercent(item, 'left', 12.5);
    expect(cropped.crop.left).toBeCloseTo(0.125);
    expect(hasCrop(cropped)).toBe(true);
    expect(hasCrop(withoutCrop(cropped))).toBe(false);
  });

  it('limits a side to 45 % and lets the editor clamp an axis below 90 %', () => {
    expect(withCropPercent(item, 'top', 80).crop.top).toBeCloseTo(0.45);
    expect(withCropPercent(item, 'top', -5).crop.top).toBe(0);
    const both = withCropPercent(withCropPercent(item, 'top', 45), 'bottom', 45);
    const clamped = clampItem(both);
    expect(clamped.crop.top + clamped.crop.bottom).toBeLessThan(0.9);
  });

  it('switches the border on with a default and off again', () => {
    const on = withBorderEnabled(item, true);
    expect(on.border).toEqual({ width: 4, color: '#ffffff' });
    expect(withBorderEnabled(on, true)).toBe(on);
    expect(withBorderEnabled(on, false).border).toBeNull();
  });

  it('offers the hold options and keeps an unknown current value', () => {
    expect(holdChoices(3000).map((choice) => choice.value)).toEqual(['3000', '10000', 'hold']);
    expect(holdChoices(null)).toHaveLength(3);
    const custom = holdChoices(5000);
    expect(custom[0]).toEqual({ value: '5000', label: 'Standbild 5 s, dann abgedunkelt' });
    expect(holdValue(null)).toBe('hold');
    expect(parseHoldValue('hold')).toBeNull();
    expect(parseHoldValue('10000')).toBe(10000);
    expect(parseHoldValue('abc')).toBeUndefined();
    expect(parseHoldValue('9999999')).toBeUndefined();
  });

  it('lists fallback sources without the own one, media first', () => {
    const own = sourceFixture('dev_aaaaaaaaaaaaaaaa', 'camera', 'K1');
    const other = sourceFixture('dev_cccccccccccccccc', 'camera', 'K2', { label: 'Handy Totale' });
    const screen = sourceFixture('dev_bbbbbbbbbbbbbbbb', 'screen-1', 'S1', { label: 'Laptop' });
    const media: SourceDto = { ...own, id: 'ast_a', code: 'M1', kind: 'image', label: 'Pause' };
    const sources = new Map([own, other, screen, media].map((source) => [source.id, source]));
    const groups = fallbackGroups(sources, own.id);
    expect(groups.map((group) => group.label)).toEqual(['Medien', 'Kameras', 'Screens']);
    expect(groups[0].options).toEqual([{ id: 'ast_a', label: 'M1 · Pause' }]);
    expect(groups[1].options.map((option) => option.id)).toEqual([other.id]);
  });
});
