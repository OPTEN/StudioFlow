import {
  CANVAS_FORMATS,
  CANVAS_RESOLUTIONS,
  DEFAULT_CANVAS,
  canvasAspect,
  canvasDto,
  canvasOf,
  canvasSize,
  canvasSizeLabel,
  formatRatioLabel,
  isLandscape,
  placeOnCanvas,
  resolutionLabel,
  safeMargin,
} from './canvas';
import { ITEM_BOUNDS, NEW_ITEM_RECT } from './constants';
import { productionFixture } from './testing/fixtures';

describe('canvasSize', () => {
  it.each([
    ['widescreen', 'p720', 1280, 720],
    ['widescreen', 'p1080', 1920, 1080],
    ['portrait', 'p720', 720, 1280],
    ['portrait', 'p1080', 1080, 1920],
    ['square', 'p720', 720, 720],
    ['square', 'p1080', 1080, 1080],
    ['standard', 'p720', 960, 720],
    ['standard', 'p1080', 1440, 1080],
  ] as const)('%s at %s is %s × %s', (format, resolution, width, height) => {
    expect(canvasSize(format, resolution)).toEqual({ width, height });
  });

  it('makes the default 16:9 at 1080p the 1920 × 1080 canvas', () => {
    expect(canvasSize('widescreen', 'p1080')).toEqual(DEFAULT_CANVAS);
  });

  it('keeps every canvas inside the geometry bounds of the API', () => {
    for (const format of CANVAS_FORMATS) {
      for (const resolution of CANVAS_RESOLUTIONS) {
        const { width, height } = canvasSize(format, resolution);
        expect(Number.isInteger(width) && Number.isInteger(height)).toBe(true);
        expect(width).toBeLessThanOrEqual(ITEM_BOUNDS.maxW);
        expect(height).toBeLessThanOrEqual(ITEM_BOUNDS.maxH);
      }
    }
  });

  it('matches the ratio of the format', () => {
    expect(canvasAspect(canvasSize('widescreen', 'p720'))).toBeCloseTo(16 / 9, 10);
    expect(canvasAspect(canvasSize('portrait', 'p1080'))).toBeCloseTo(9 / 16, 10);
    expect(canvasAspect(canvasSize('square', 'p1080'))).toBe(1);
    expect(canvasAspect(canvasSize('standard', 'p720'))).toBeCloseTo(4 / 3, 10);
  });
});

describe('canvas labels', () => {
  it('writes the ratio, the resolution and the size without translation', () => {
    expect(CANVAS_FORMATS.map(formatRatioLabel)).toEqual(['16:9', '9:16', '1:1', '4:3']);
    expect(CANVAS_RESOLUTIONS.map(resolutionLabel)).toEqual(['720p', '1080p']);
    expect(canvasSizeLabel({ width: 1080, height: 1920 })).toBe('1080 × 1920');
  });
});

describe('canvasOf', () => {
  it('reads the size from the production and falls back to 1920 × 1080 without one', () => {
    const production = productionFixture({ canvas: canvasDto('portrait', 'p720') });

    expect(canvasOf(production)).toEqual({ width: 720, height: 1280 });
    expect(canvasOf(null)).toEqual(DEFAULT_CANVAS);
    expect(canvasOf(undefined)).toEqual(DEFAULT_CANVAS);
  });

  it('builds the wire form of a canvas', () => {
    expect(canvasDto('square', 'p1080')).toEqual({
      format: 'square',
      resolution: 'p1080',
      width: 1080,
      height: 1080,
    });
  });
});

describe('isLandscape', () => {
  it('is true for 16:9 and 4:3 and false for square and portrait canvases', () => {
    expect(CANVAS_FORMATS.map((format) => isLandscape(canvasSize(format, 'p1080')))).toEqual([
      true,
      false,
      false,
      true,
    ]);
  });
});

describe('safeMargin', () => {
  it('is 40 px at 1080p and 27 px at 720p whatever the format', () => {
    expect(CANVAS_FORMATS.map((format) => safeMargin(canvasSize(format, 'p1080')))).toEqual([
      40, 40, 40, 40,
    ]);
    expect(CANVAS_FORMATS.map((format) => safeMargin(canvasSize(format, 'p720')))).toEqual([
      27, 27, 27, 27,
    ]);
  });
});

describe('placeOnCanvas', () => {
  it('leaves a rectangle of the 1920 × 1080 canvas where it is', () => {
    expect(placeOnCanvas(DEFAULT_CANVAS, NEW_ITEM_RECT)).toEqual(NEW_ITEM_RECT);
  });

  it('keeps the distance to the nearest edge in proportion: the new item sits at the bottom right', () => {
    expect(placeOnCanvas(canvasSize('portrait', 'p1080'), NEW_ITEM_RECT)).toEqual({
      x: 698,
      y: 1695,
      w: 338,
      h: 190,
    });
    expect(placeOnCanvas(canvasSize('standard', 'p1080'), NEW_ITEM_RECT)).toEqual({
      x: 930,
      y: 780,
      w: 450,
      h: 254,
    });
  });

  it('scales the size by the smaller factor so the shape stays', () => {
    const placed = placeOnCanvas(canvasSize('square', 'p720'), NEW_ITEM_RECT);

    expect(placed.w / placed.h).toBeCloseTo(NEW_ITEM_RECT.w / NEW_ITEM_RECT.h, 1);
  });

  it('keeps a centred rectangle centred on every canvas', () => {
    for (const format of CANVAS_FORMATS) {
      const canvas = canvasSize(format, 'p1080');
      const placed = placeOnCanvas(canvas, { x: 160, y: 390, w: 1600, h: 300 });

      expect(Math.abs(placed.x + placed.w / 2 - canvas.width / 2)).toBeLessThanOrEqual(1);
      expect(Math.abs(placed.y + placed.h / 2 - canvas.height / 2)).toBeLessThanOrEqual(1);
    }
  });
});
