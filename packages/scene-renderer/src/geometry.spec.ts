import { isHexColor } from '@flowstudio/scene-model';
import {
  clampNumber,
  cropBox,
  desiredPixelSize,
  heldBlurPx,
  itemLook,
  itemRect,
  maxDesiredSize,
  mediaBox,
  sanitizeCrop,
} from './geometry';
import { sceneItem } from './testing/fixtures';

describe('cropBox', () => {
  it('is the item itself without crop', () => {
    expect(cropBox(640, 360, { top: 0, right: 0, bottom: 0, left: 0 })).toEqual({
      left: -0,
      top: -0,
      width: 640,
      height: 360,
    });
  });

  it('scales the picture so the cropped part fills the item', () => {
    const box = cropBox(600, 300, { top: 0.1, right: 0.2, bottom: 0.3, left: 0.05 });
    expect(box.width).toBeCloseTo(600 / 0.75, 10);
    expect(box.height).toBeCloseTo(300 / 0.6, 10);
    expect(box.left).toBeCloseTo(-0.05 * (600 / 0.75), 10);
    expect(box.top).toBeCloseTo(-0.1 * (300 / 0.6), 10);
    // The visible window [0, item size] maps exactly to the uncropped fractions [left, 1 - right].
    expect((0 - box.left) / box.width).toBeCloseTo(0.05, 10);
    expect((600 - box.left) / box.width).toBeCloseTo(0.8, 10);
    expect((300 - box.top) / box.height).toBeCloseTo(0.7, 10);
  });

  it('stays finite at the maximum crop', () => {
    const box = cropBox(100, 100, { top: 0.45, right: 0.45, bottom: 0.45, left: 0.45 });
    expect(box.width).toBeCloseTo(1000, 6);
    expect(box.left).toBeCloseTo(-450, 6);
  });
});

describe('mediaBox', () => {
  it.each([0, 180] as const)('keeps the box for %s°', (rotation) => {
    expect(mediaBox(800, 450, rotation)).toEqual({ left: 0, top: 0, width: 800, height: 450 });
  });

  it.each([90, 270] as const)('swaps width and height and centres for %s°', (rotation) => {
    const box = mediaBox(800, 450, rotation);
    expect(box).toEqual({ left: 175, top: -175, width: 450, height: 800 });
    // Rotated around its centre the box covers exactly the 800 × 450 crop box.
    expect(box.left + box.width / 2).toBe(400);
    expect(box.top + box.height / 2).toBe(225);
  });
});

describe('rotation of the item look', () => {
  it.each([
    [0, 0],
    [90, 90],
    [180, 180],
    [270, 270],
    [360, 0],
    [-90, 270],
    [89, 90],
    [Number.NaN, 0],
    ['90', 0],
  ])('maps %s to %s', (input, expected) => {
    expect(itemLook(sceneItem('a', 'x', { rotation: input as never })).rotation).toBe(expected);
  });
});

describe('sanitizing', () => {
  it('clamps crop sides to [0, 0.45] and fills missing values', () => {
    expect(sanitizeCrop({ top: -1, right: 0.9, bottom: Number.NaN, left: 0.2 })).toEqual({
      top: 0,
      right: 0.45,
      bottom: 0,
      left: 0.2,
    });
    expect(sanitizeCrop(null)).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });

  it('clamps the rectangle to the API bounds', () => {
    expect(itemRect(sceneItem('a', 'x', { x: -99999, y: Number.NaN, w: 2, h: 99999 }))).toEqual({
      x: -3840,
      y: 0,
      w: 16,
      h: 2160,
    });
  });

  it('accepts only #rrggbb colours for borders', () => {
    expect(isHexColor('#1f6feb')).toBe(true);
    expect(isHexColor('#fff')).toBe(false);
    expect(isHexColor('red; background: url(x)')).toBe(false);
    expect(itemLook(sceneItem('a', 'x', { border: { width: 4, color: 'red' } })).border).toBeNull();
    expect(
      itemLook(sceneItem('a', 'x', { border: { width: 99, color: '#ffffff' } })).border,
    ).toEqual({
      width: 40,
      color: '#ffffff',
    });
  });

  it('normalises the look of a malformed item', () => {
    const look = itemLook({
      ...sceneItem('a', 'x'),
      fit: 'stretch' as 'cover',
      radius: -5,
      mirror: 'yes' as unknown as boolean,
      rotation: 30,
    });
    expect(look).toMatchObject({ fit: 'cover', radius: 0, mirror: false, rotation: 0 });
  });

  it('clamps numbers and replaces non-finite values', () => {
    expect(clampNumber(5, 0, 3, 1)).toBe(3);
    expect(clampNumber(Number.POSITIVE_INFINITY, 0, 3, 1)).toBe(1);
    expect(clampNumber(undefined, 0, 3, 2)).toBe(2);
  });
});

describe('heldBlurPx', () => {
  it('is about 2.5 % of the width with a minimum of 3 px', () => {
    expect(heldBlurPx(1920)).toBe(48);
    expect(heldBlurPx(640)).toBe(16);
    expect(heldBlurPx(100)).toBe(3);
  });
});

describe('desiredPixelSize', () => {
  it('multiplies by scale and device pixel ratio and rounds up to 16 px', () => {
    expect(desiredPixelSize({ left: 0, top: 0, width: 640, height: 360 }, 0.5, 2)).toEqual({
      width: 640,
      height: 368,
    });
    expect(desiredPixelSize({ left: 0, top: 0, width: 1920, height: 1080 }, 1, 1)).toEqual({
      width: 1920,
      height: 1088,
    });
  });

  it('never goes below 16 px and survives malformed input', () => {
    expect(desiredPixelSize({ left: 0, top: 0, width: 100, height: 50 }, 0, 2)).toEqual({
      width: 16,
      height: 16,
    });
    expect(desiredPixelSize({ left: 0, top: 0, width: 100, height: 50 }, 1, Number.NaN)).toEqual({
      width: 112,
      height: 64,
    });
  });

  it('keeps the larger size per axis when a source is needed twice', () => {
    expect(maxDesiredSize({ width: 320, height: 720 }, { width: 640, height: 180 })).toEqual({
      width: 640,
      height: 720,
    });
  });
});
