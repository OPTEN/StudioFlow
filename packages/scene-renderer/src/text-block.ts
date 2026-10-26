import {
  DEFAULT_TEXT_THEME,
  isHexColor,
  type TextAlign,
  type TextSourceDto,
  type TextStyle,
  type TextThemeDto,
} from '@studioflow/scene-model';

import { createElement, FILL, px, setStyles, setText, setVisible, type StyleMap } from './dom';
import type { PresenceOffset } from './presence';
import { TEXT_FONT } from './palette';
import type { CanvasRect } from './types';

/**
 * Proportions of a style, relative to the item height (so the text scales with the item and with the canvas, never
 * with the screen). `line1Lines`/`line2Lines` is how many lines a line may wrap to before it ends in an ellipsis.
 */
interface StyleMetrics {
  readonly line1: number;
  readonly line2: number;
  readonly line1Lines: number;
  readonly line2Lines: number;
  readonly paddingX: number;
  readonly paddingY: number;
  /** Width of the accent bar at the start edge (lower third, note) or height of the rule below (title). */
  readonly accent: number;
  readonly accentAt: 'start' | 'bottom';
  /** Where the text comes from when it is shown, as fractions of the item width and height. */
  readonly enter: PresenceOffset;
}

const METRICS: Readonly<Record<TextStyle, StyleMetrics>> = {
  lowerThird: {
    line1: 0.34,
    line2: 0.22,
    line1Lines: 1,
    line2Lines: 1,
    paddingX: 0.16,
    paddingY: 0.1,
    accent: 0.05,
    accentAt: 'start',
    enter: { x: -0.06, y: 0 },
  },
  title: {
    line1: 0.24,
    line2: 0.12,
    line1Lines: 2,
    line2Lines: 1,
    paddingX: 0.12,
    paddingY: 0.08,
    accent: 0.025,
    accentAt: 'bottom',
    enter: { x: 0, y: 0.08 },
  },
  note: {
    line1: 0.34,
    line2: 0.24,
    line1Lines: 1,
    line2Lines: 1,
    paddingX: 0.14,
    paddingY: 0.1,
    accent: 0.06,
    accentAt: 'start',
    enter: { x: 0, y: -0.12 },
  },
};

/** Smallest accent in canvas pixels, so the accent stays visible on small items. */
const MIN_ACCENT_PX = 3;

function styleOf(style: TextStyle | undefined): TextStyle {
  return style === 'title' || style === 'note' ? style : 'lowerThird';
}

/** The theme with every invalid colour replaced by the default. */
function safeTheme(theme: TextThemeDto | undefined): TextThemeDto {
  const pick = (key: keyof TextThemeDto): string => {
    const value = theme?.[key];
    return isHexColor(value) ? value : DEFAULT_TEXT_THEME[key];
  };
  return { accent: pick('accent'), background: pick('background'), foreground: pick('foreground') };
}

/** `text-align` of a style: the lower third follows the reading direction of each line, the others use `align`. */
function textAlignOf(style: TextStyle, align: TextAlign | undefined): string {
  if (style === 'lowerThird') {
    return 'start';
  }
  return align === 'left' || align === 'right' ? align : 'center';
}

/** Styles that end a line in an ellipsis after `lines` lines (one line: no wrapping at all). */
function clampStyles(lines: number): StyleMap {
  return lines <= 1
    ? {
        display: 'block',
        'white-space': 'nowrap',
        'text-overflow': 'ellipsis',
        '-webkit-line-clamp': '',
      }
    : {
        display: '-webkit-box',
        'white-space': 'normal',
        'text-overflow': 'ellipsis',
        '-webkit-box-orient': 'vertical',
        '-webkit-line-clamp': String(lines),
      };
}

/**
 * A text item drawn as HTML (never as a picture): sharp at every output resolution and scaled with the stage. The
 * content is set with `textContent` only, so markup in a text is shown literally and never interpreted. Each line has
 * `dir="auto"`, so right-to-left lines read correctly.
 *
 * ```
 * div.sf-r-text            panel: background, padding, the element that is animated when shown and hidden
 *   div.sf-r-text-accent   accent bar (start edge) or rule (bottom)
 *   div.sf-r-text-line1    main line
 *   div.sf-r-text-line2    second line
 * ```
 */
export class TextBlock {
  readonly element: HTMLDivElement;
  private readonly accentEl: HTMLDivElement;
  private readonly line1El: HTMLDivElement;
  private readonly line2El: HTMLDivElement;
  private style: TextStyle = 'lowerThird';
  private rect: CanvasRect | null = null;

  constructor(doc: Document) {
    this.element = createElement(doc, 'div', 'sf-r-text', {
      ...FILL,
      'box-sizing': 'border-box',
      display: 'flex',
      'flex-direction': 'column',
      'justify-content': 'center',
      overflow: 'hidden',
      'font-family': TEXT_FONT,
      'font-kerning': 'normal',
      'text-rendering': 'optimizeLegibility',
    });
    this.accentEl = createElement(doc, 'div', 'sf-r-text-accent', { position: 'absolute' });
    this.line1El = this.createLine(doc, 'sf-r-text-line1', '700');
    this.line2El = this.createLine(doc, 'sf-r-text-line2', '500');
    this.element.append(this.accentEl, this.line1El, this.line2El);
  }

  /** Draws the text into a rectangle of the given size; null content (unknown text) draws nothing. */
  render(rect: CanvasRect, text: TextSourceDto | undefined, theme: TextThemeDto | undefined): void {
    this.rect = rect;
    const line1 = typeof text?.line1 === 'string' ? text.line1 : '';
    const line2 = typeof text?.line2 === 'string' ? text.line2 : '';
    setVisible(this.element, line1 !== '' || line2 !== '', 'flex');
    if (line1 === '' && line2 === '') {
      return;
    }
    this.style = styleOf(text?.style);
    const metrics = METRICS[this.style];
    const colors = safeTheme(theme);
    const h = rect.h;
    const accent = Math.max(MIN_ACCENT_PX, Math.round(h * metrics.accent));
    const startAccent = metrics.accentAt === 'start';
    setStyles(this.element, {
      'background-color': colors.background,
      color: colors.foreground,
      'text-align': textAlignOf(this.style, text?.align),
      'padding-top': px(Math.round(h * metrics.paddingY)),
      'padding-bottom': px(Math.round(h * metrics.paddingY) + (startAccent ? 0 : accent)),
      'padding-left': px(Math.round(h * metrics.paddingX) + (startAccent ? accent : 0)),
      'padding-right': px(Math.round(h * metrics.paddingX)),
    });
    setStyles(this.accentEl, {
      'background-color': colors.accent,
      left: '0',
      top: startAccent ? '0' : '',
      bottom: '0',
      width: startAccent ? px(accent) : '100%',
      height: startAccent ? '100%' : px(accent),
    });
    this.renderLine(this.line1El, line1, h * metrics.line1, metrics.line1Lines);
    this.renderLine(this.line2El, line2, h * metrics.line2, metrics.line2Lines);
  }

  /** Where the text comes from when it is shown, in canvas pixels (from the last rendered size). */
  get enterOffset(): PresenceOffset {
    const enter = METRICS[this.style].enter;
    const pixels = (length: number, fraction: number): number =>
      Math.round(length * fraction * 100) / 100;
    return { x: pixels(this.rect?.w ?? 0, enter.x), y: pixels(this.rect?.h ?? 0, enter.y) };
  }

  private createLine(doc: Document, className: string, weight: string): HTMLDivElement {
    const line = createElement(doc, 'div', className, {
      overflow: 'hidden',
      'overflow-wrap': 'anywhere',
      'line-height': '1.15',
      'font-weight': weight,
      'unicode-bidi': 'plaintext',
    });
    line.setAttribute('dir', 'auto');
    return line;
  }

  private renderLine(element: HTMLDivElement, text: string, fontSize: number, lines: number): void {
    setVisible(element, text !== '');
    setText(element, text);
    if (text === '') {
      return;
    }
    setStyles(element, {
      ...clampStyles(lines),
      'font-size': px(Math.round(fontSize * 100) / 100),
    });
  }
}
