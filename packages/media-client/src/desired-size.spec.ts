import { DesiredSizes, normalizeDesiredSize } from './desired-size';

describe('normalizeDesiredSize', () => {
  it.each([
    [null, null],
    [{ width: 0, height: 100 }, null],
    [{ width: -1, height: 100 }, null],
    [{ width: Number.NaN, height: 100 }, null],
    [{ width: Number.POSITIVE_INFINITY, height: 100 }, null],
    [
      { width: 639.2, height: 359.1 },
      { width: 640, height: 360 },
    ],
    [
      { width: 100_000, height: 50_000 },
      { width: 7680, height: 7680 },
    ],
  ])('%j → %j', (input, expected) => {
    expect(normalizeDesiredSize(input)).toEqual(expected);
  });
});

describe('DesiredSizes', () => {
  it('is empty without consumers', () => {
    const sizes = new DesiredSizes();
    expect(sizes.isEmpty).toBe(true);
    expect(sizes.effective()).toBeNull();
  });

  it('takes the component-wise maximum over consumers', () => {
    const sizes = new DesiredSizes();
    sizes.set('program', { width: 1920, height: 1080 });
    sizes.set('thumb', { width: 320, height: 1200 });
    expect(sizes.effective()).toEqual({ width: 1920, height: 1200 });
  });

  it('replaces a consumer request and removes it with null or an invalid size', () => {
    const sizes = new DesiredSizes();
    sizes.set('a', { width: 1920, height: 1080 });
    sizes.set('a', { width: 640, height: 360 });
    sizes.set('b', { width: 320, height: 180 });
    expect(sizes.effective()).toEqual({ width: 640, height: 360 });
    sizes.set('a', null);
    expect(sizes.effective()).toEqual({ width: 320, height: 180 });
    sizes.set('b', { width: 0, height: 0 });
    expect(sizes.isEmpty).toBe(true);
  });

  it('ignores removal of unknown consumers', () => {
    const sizes = new DesiredSizes();
    sizes.set('ghost', null);
    expect(sizes.isEmpty).toBe(true);
  });
});
