import type { TextAlign, TextStyle, TextThemeDto } from './contracts';
import { placeOnCanvas, type CanvasSize } from './canvas';
import type { CanvasRect } from './geometry';
import { isHexColor } from './geometry';

/** Limits of texts enforced by the API (`TextRules`, `TextSourceRules`); lengths count user-perceived characters. */
export const TEXT_LIMITS = {
  lineLength: 120,
  perProduction: 64,
} as const;

/** The fixed text styles in the order the Regie offers them. */
export const TEXT_STYLES: readonly TextStyle[] = ['lowerThird', 'title', 'note'];

/** Text colours of a new production (mirrors `TextSourceRules.DefaultTheme`). */
export const DEFAULT_TEXT_THEME: TextThemeDto = {
  accent: '#1f6feb',
  background: '#0d1117',
  foreground: '#ffffff',
};

/** WCAG 2 minimum contrast of normal text against its background (level AA). */
export const MIN_TEXT_CONTRAST = 4.5;

/** Rectangle of a text style on a 1920 × 1080 canvas. */
const REFERENCE_TEXT_RECTS: Readonly<Record<TextStyle, CanvasRect>> = {
  lowerThird: { x: 80, y: 820, w: 960, h: 180 },
  title: { x: 160, y: 390, w: 1600, h: 300 },
  note: { x: 1320, y: 60, w: 540, h: 96 },
};

/** Alignment a new text of the style starts with: titles are centred, the others sit at the left edge. */
export function defaultTextAlign(style: TextStyle): TextAlign {
  return style === 'title' ? 'center' : 'left';
}

/** True when the style lets the operator choose the alignment (the lower third follows the reading direction). */
export function styleHasAlignment(style: TextStyle): boolean {
  return style !== 'lowerThird';
}

/**
 * Where a new item of a text lands, inside the safe margin (mirrors `TextSourceRules.DefaultRect`): the lower third at
 * the bottom left, the title in the middle, the note in the top right corner. The rectangles are those of a 1920 × 1080
 * canvas, placed on the canvas of the production.
 */
export function textItemRect(style: TextStyle, canvas: CanvasSize): CanvasRect {
  return placeOnCanvas(canvas, REFERENCE_TEXT_RECTS[style]);
}

/** Relative luminance of a `#rrggbb` colour (WCAG 2); NaN for anything else. */
export function relativeLuminance(color: string): number {
  if (!isHexColor(color)) {
    return Number.NaN;
  }
  const channel = (offset: number): number => {
    const value = parseInt(color.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** Contrast ratio of two `#rrggbb` colours, from 1 (equal) to 21 (black on white); NaN for invalid colours. */
export function contrastRatio(a: string, b: string): number {
  const first = relativeLuminance(a);
  const second = relativeLuminance(b);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

/** True when the text colour of the theme is readable on its background (contrast ≥ 4.5 : 1). */
export function hasReadableContrast(theme: TextThemeDto): boolean {
  return contrastRatio(theme.foreground, theme.background) >= MIN_TEXT_CONTRAST;
}
