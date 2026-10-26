import { DEFAULT_CANVAS } from '@studioflow/scene-model';

import { fitStage as fit } from './stage-fit';

/** The 16:9 canvas of the default production. */
const fitStage = (width: number, height: number) => fit(width, height, DEFAULT_CANVAS);

describe('fitStage', () => {
  it('fills a 16:9 container exactly', () => {
    expect(fitStage(1920, 1080)).toEqual({
      scale: 1,
      offsetX: 0,
      offsetY: 0,
      width: 1920,
      height: 1080,
    });
    expect(fitStage(960, 540)).toEqual({
      scale: 0.5,
      offsetX: 0,
      offsetY: 0,
      width: 960,
      height: 540,
    });
  });

  it('letterboxes a 4:3 container (bars top and bottom)', () => {
    const fit = fitStage(1024, 768);
    expect(fit.scale).toBeCloseTo(1024 / 1920, 10);
    expect(fit.width).toBeCloseTo(1024, 10);
    expect(fit.height).toBeCloseTo(576, 10);
    expect(fit.offsetX).toBeCloseTo(0, 10);
    expect(fit.offsetY).toBeCloseTo(96, 10);
  });

  it('pillarboxes a 21:9 container (bars left and right)', () => {
    const fit = fitStage(2560, 1080);
    expect(fit).toEqual({ scale: 1, offsetX: 320, offsetY: 0, width: 1920, height: 1080 });
  });

  it('centres in a portrait container', () => {
    const fit = fitStage(360, 640);
    expect(fit.scale).toBeCloseTo(0.1875, 10);
    expect(fit.height).toBeCloseTo(202.5, 10);
    expect(fit.offsetY).toBeCloseTo((640 - 202.5) / 2, 10);
  });

  it('handles tiny containers', () => {
    const fit = fitStage(1, 1);
    expect(fit.scale).toBeCloseTo(1 / 1920, 12);
    expect(fit.width).toBeCloseTo(1, 10);
    expect(fit.offsetY).toBeCloseTo((1 - 1080 / 1920) / 2, 10);
  });

  it.each([
    [0, 0],
    [0, 500],
    [-100, 400],
    [Number.NaN, 300],
    [Number.POSITIVE_INFINITY, 300],
  ])('treats unusable size %s × %s as an invisible stage without NaN', (width, height) => {
    const fit = fitStage(width, height);
    expect(fit.scale).toBe(0);
    for (const value of Object.values(fit)) {
      expect(Number.isFinite(value)).toBe(true);
    }
  });
});
