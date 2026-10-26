import {
  DEFAULT_TEXT_THEME,
  MIN_TEXT_CONTRAST,
  TEXT_LIMITS,
  TEXT_STYLES,
  contrastRatio,
  defaultTextAlign,
  hasReadableContrast,
  relativeLuminance,
  styleHasAlignment,
  textItemRect,
} from './text';
import { CANVAS_FORMATS, CANVAS_RESOLUTIONS, DEFAULT_CANVAS, canvasSize } from './canvas';

describe('text styles', () => {
  it('offers the three fixed styles in the order of the menu', () => {
    expect(TEXT_STYLES).toEqual(['lowerThird', 'title', 'note']);
  });

  it('centres titles and aligns the other styles left by default', () => {
    expect(TEXT_STYLES.map(defaultTextAlign)).toEqual(['left', 'center', 'left']);
  });

  it('lets the operator choose the alignment of titles and notes, not of the lower third', () => {
    expect(TEXT_STYLES.map(styleHasAlignment)).toEqual([false, true, true]);
  });

  it.each(TEXT_STYLES)(
    'places a new %s on every canvas, at least 3 % of the short side from the edges',
    (style) => {
      for (const format of CANVAS_FORMATS) {
        for (const resolution of CANVAS_RESOLUTIONS) {
          const canvas = canvasSize(format, resolution);
          const margin = Math.floor(Math.min(canvas.width, canvas.height) * 0.03);
          const { x, y, w, h } = textItemRect(style, canvas);

          expect(x, `${style} ${format} ${resolution}`).toBeGreaterThanOrEqual(margin);
          expect(y).toBeGreaterThanOrEqual(margin);
          expect(x + w).toBeLessThanOrEqual(canvas.width - margin);
          expect(y + h).toBeLessThanOrEqual(canvas.height - margin);
        }
      }
    },
  );

  it('puts the lower third at the bottom left, the title in the middle and the note in the top right', () => {
    expect(textItemRect('lowerThird', DEFAULT_CANVAS)).toEqual({ x: 80, y: 820, w: 960, h: 180 });
    expect(textItemRect('title', DEFAULT_CANVAS)).toEqual({ x: 160, y: 390, w: 1600, h: 300 });
    expect(textItemRect('note', DEFAULT_CANVAS)).toEqual({ x: 1320, y: 60, w: 540, h: 96 });
  });

  it('keeps the corners and the centre on a portrait canvas', () => {
    const portrait = canvasSize('portrait', 'p1080');

    expect(textItemRect('lowerThird', portrait)).toEqual({ x: 45, y: 1774, w: 540, h: 101 });
    expect(textItemRect('title', portrait)).toEqual({ x: 90, y: 876, w: 900, h: 169 });
    expect(textItemRect('note', portrait)).toEqual({ x: 743, y: 34, w: 304, h: 54 });
  });

  it('mirrors the limits of the API', () => {
    expect(TEXT_LIMITS).toEqual({ lineLength: 120, perProduction: 64 });
  });
});

describe('contrast', () => {
  it('knows the luminance of black and white', () => {
    expect(relativeLuminance('#000000')).toBe(0);
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 10);
    expect(relativeLuminance('#FFFFFF')).toBeCloseTo(1, 10);
  });

  it('is NaN for anything that is not #rrggbb', () => {
    for (const value of ['', 'red', '#fff', '#ggg000', '#ff000000', 'ffffff']) {
      expect(relativeLuminance(value)).toBeNaN();
      expect(contrastRatio(value, '#000000')).toBeNaN();
    }
  });

  it('gives 21 for black on white in either order and 1 for equal colours', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 10);
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 10);
    expect(contrastRatio('#123456', '#123456')).toBe(1);
  });

  it('matches known WCAG values', () => {
    // #767676 on white is the lightest grey that still reaches 4.5 : 1; #777777 just misses it.
    expect(contrastRatio('#767676', '#ffffff')).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
    expect(contrastRatio('#777777', '#ffffff')).toBeLessThan(MIN_TEXT_CONTRAST);
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
  });

  it('accepts the default colours and a theme just at the limit, and rejects one just below', () => {
    expect(hasReadableContrast(DEFAULT_TEXT_THEME)).toBe(true);
    expect(
      hasReadableContrast({ ...DEFAULT_TEXT_THEME, background: '#ffffff', foreground: '#767676' }),
    ).toBe(true);
    expect(
      hasReadableContrast({ ...DEFAULT_TEXT_THEME, background: '#ffffff', foreground: '#777777' }),
    ).toBe(false);
    expect(
      hasReadableContrast({ ...DEFAULT_TEXT_THEME, foreground: DEFAULT_TEXT_THEME.background }),
    ).toBe(false);
  });

  it('does not call a theme with an invalid colour readable', () => {
    expect(hasReadableContrast({ ...DEFAULT_TEXT_THEME, foreground: 'white' })).toBe(false);
  });
});
