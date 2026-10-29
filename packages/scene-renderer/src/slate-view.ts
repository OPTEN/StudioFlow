import type { CanvasSize, SlateDto } from '@studioflow/scene-model';

import { createElement, FILL, px, setStyle, setStyles, setText, setVisible } from './dom';
import { AssetLoader } from './asset-loader';
import { fadeOpacity, type Fade } from './fade';
import { createImage } from './media-view';
import { PALETTE, UI_FONT } from './palette';
import type { SlateNotice } from './types';

/** Fade of slates in and out. */
const SLATE_FADE_MS = 300;
/** Slates are laid out for a canvas with a short side of 1080 pixels; other canvases scale every size with it. */
const REFERENCE_SHORT_SIDE = 1080;
/** Height of the rule of a production slate at the reference size. */
const RULE_HEIGHT_PX = 4;
/** Extra space above the last line of a notice at the reference size. */
const NOTE_SPACE_PX = 8;
const SVG_NS = 'http://www.w3.org/2000/svg';

/** One look of the slate: sizes in canvas pixels at the reference short side, line limits and measures. */
interface SlateLook {
  readonly titlePx: number;
  readonly subtitlePx: number;
  readonly notePx: number;
  /** Space between the parts. */
  readonly gapPx: number;
  /** Production: the width of the rule; notice: the size of the glyph. */
  readonly markPx: number;
  readonly titleLines: number;
  readonly subtitleLines: number;
  readonly titleWidth: string;
  readonly subtitleWidth: string;
}

/**
 * A production slate is a broadcast title card: a large, tight title of at most three lines, a short rule, and the
 * subtitle one step back in size and brightness.
 */
const PRODUCTION: SlateLook = {
  titlePx: 80,
  subtitlePx: 36,
  notePx: 0,
  gapPx: 28,
  markPx: 56,
  titleLines: 3,
  subtitleLines: 2,
  titleWidth: '80%',
  subtitleWidth: '72%',
};

/**
 * A notice is a quiet state of the page itself: a glyph, a modest title, a paragraph at reading width and a small last
 * line, all on the same ground, so it never reads as a production's own slate.
 */
const NOTICE: SlateLook = {
  titlePx: 48,
  subtitlePx: 30,
  notePx: 24,
  gapPx: 20,
  markPx: 64,
  titleLines: 2,
  subtitleLines: 4,
  titleWidth: '80%',
  subtitleWidth: '32em',
};

/** Lock glyph of a notice: the 24-unit grid and 1.6 stroke of the Regie's icon set. */
function createGlyph(doc: Document): SVGSVGElement {
  const svg = doc.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', '100%');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.6');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const body = doc.createElementNS(SVG_NS, 'rect');
  for (const [name, value] of [
    ['x', '5'],
    ['y', '10.5'],
    ['width', '14'],
    ['height', '10'],
    ['rx', '1.5'],
  ]) {
    body.setAttribute(name, value);
  }
  const shackle = doc.createElementNS(SVG_NS, 'path');
  shackle.setAttribute('d', 'M8 10.5V8a4 4 0 0 1 8 0v2.5');
  svg.append(body, shackle);
  return svg;
}

/** Display of a text that keeps to a number of lines (with {@link clampStyles}). */
const CLAMPED_DISPLAY = '-webkit-box';

/** Styles of a text that keeps to `lines` lines and ends the last one with an ellipsis. */
function clampStyles(lines: number): Readonly<Record<string, string>> {
  return {
    '-webkit-box-orient': 'vertical',
    '-webkit-line-clamp': String(lines),
    overflow: 'hidden',
  };
}

/**
 * Full-stage slate above all scene layers: the production's standby and end slates (“Starting soon”, “Thanks for
 * watching”) and, with a {@link SlateNotice}, the page's own notice (“No access”). Showing and hiding fade over
 * {@link SLATE_FADE_MS}; reversing mid-way continues from the current opacity, so there is never a jump.
 */
export class SlateView {
  private element: HTMLDivElement | null = null;
  private image: HTMLImageElement | null = null;
  private imageLoader: AssetLoader | null = null;
  private scrim: HTMLDivElement | null = null;
  private mark: HTMLDivElement | null = null;
  private title: HTMLDivElement | null = null;
  private rule: HTMLDivElement | null = null;
  private subtitle: HTMLDivElement | null = null;
  private note: HTMLDivElement | null = null;
  private fade: Fade | null = null;
  private visible = false;
  private look: SlateLook = PRODUCTION;
  /** Size of the slate relative to a 1080 pixel short side. */
  private scale: number;

  constructor(
    private readonly doc: Document,
    private readonly host: HTMLElement,
    private readonly reducedMotion: boolean,
    canvas: CanvasSize,
  ) {
    this.scale = Math.min(canvas.width, canvas.height) / REFERENCE_SHORT_SIDE;
  }

  /** Shows (or updates) a slate; null hides it. A notice is drawn in the quieter look of the page's own states. */
  show(slate: SlateDto | null, imageUrl: string | null, notice: SlateNotice | null = null): void {
    if (!slate) {
      this.hide();
      return;
    }
    const element = this.element ?? this.build();
    this.look = notice ? NOTICE : PRODUCTION;
    this.applyContent(slate, imageUrl, notice);
    this.applySizes();
    if (!this.visible) {
      this.visible = true;
      const from = this.fade ? this.fade.stop() : 0;
      this.startFade(element, from, 1);
    }
  }

  /** The canvas changed: the slate keeps its proportions relative to the short side. */
  setCanvas(canvas: CanvasSize): void {
    this.scale = Math.min(canvas.width, canvas.height) / REFERENCE_SHORT_SIDE;
    this.applySizes();
  }

  /** Removes the slate at once (renderer teardown). */
  dispose(): void {
    this.fade?.finish();
    this.fade = null;
    this.imageLoader?.dispose();
    this.imageLoader = null;
    this.element?.remove();
    this.element = this.image = this.scrim = this.mark = null;
    this.title = this.rule = this.subtitle = this.note = null;
    this.visible = false;
  }

  private hide(): void {
    const element = this.element;
    if (!element || !this.visible) {
      return;
    }
    this.visible = false;
    const from = this.fade ? this.fade.stop() : 1;
    this.startFade(element, from, 0);
  }

  private startFade(element: HTMLDivElement, from: number, to: number): void {
    const duration = this.reducedMotion ? 0 : SLATE_FADE_MS * Math.abs(to - from);
    const fade = fadeOpacity(element, from, to, duration);
    this.fade = fade;
    void fade.done.then(() => {
      if (this.fade !== fade) {
        return;
      }
      this.fade = null;
      if (!this.visible) {
        this.dispose();
      }
    });
  }

  private build(): HTMLDivElement {
    const doc = this.doc;
    const element = createElement(doc, 'div', 'sf-r-slate', {
      ...FILL,
      display: 'flex',
      'flex-direction': 'column',
      'align-items': 'center',
      'justify-content': 'center',
      'background-color': PALETTE.ground,
      color: PALETTE.slateText,
      'font-family': UI_FONT,
      'text-align': 'center',
      overflow: 'hidden',
    });
    const image = createImage(doc, 'sf-r-slate-image', {
      ...FILL,
      'object-fit': 'cover',
      display: 'none',
    });
    this.imageLoader = new AssetLoader(image);
    const scrim = createElement(doc, 'div', 'sf-r-slate-scrim', {
      ...FILL,
      background: PALETTE.slateScrim,
      display: 'none',
    });
    const mark = createElement(doc, 'div', 'sf-r-slate-mark', {
      position: 'relative',
      flex: 'none',
      color: PALETTE.noticeMuted,
      display: 'none',
    });
    mark.setAttribute('aria-hidden', 'true');
    mark.append(createGlyph(doc));
    const text = { position: 'relative', 'overflow-wrap': 'anywhere', 'text-wrap': 'balance' };
    const title = createElement(doc, 'div', 'sf-r-slate-title', {
      ...text,
      display: CLAMPED_DISPLAY,
      'font-weight': '600',
    });
    const rule = createElement(doc, 'div', 'sf-r-slate-rule', {
      position: 'relative',
      flex: 'none',
      'border-radius': '999px',
      background: PALETTE.slateRule,
      display: 'none',
    });
    rule.setAttribute('aria-hidden', 'true');
    const subtitle = createElement(doc, 'div', 'sf-r-slate-subtitle', {
      ...text,
      'font-weight': '400',
    });
    const note = createElement(doc, 'div', 'sf-r-slate-note', {
      ...text,
      'font-weight': '400',
      'line-height': '1.4',
      'max-width': '40em',
      color: PALETTE.noticeMuted,
      display: 'none',
    });
    element.append(image, scrim, mark, title, rule, subtitle, note);
    this.host.append(element);
    this.element = element;
    this.image = image;
    this.scrim = scrim;
    this.mark = mark;
    this.title = title;
    this.rule = rule;
    this.subtitle = subtitle;
    this.note = note;
    return element;
  }

  private applySizes(): void {
    const { element, mark, title, rule, subtitle, note, look, scale } = this;
    if (!element || !mark || !title || !rule || !subtitle || !note) {
      return;
    }
    const size = (value: number): string => px(Math.round(value * scale));
    setStyle(element, 'gap', size(look.gapPx));
    setStyles(mark, { width: size(look.markPx), height: size(look.markPx) });
    setStyle(title, 'font-size', size(look.titlePx));
    setStyles(rule, {
      width: size(look.markPx),
      height: px(Math.max(2, Math.round(RULE_HEIGHT_PX * scale))),
    });
    setStyle(subtitle, 'font-size', size(look.subtitlePx));
    setStyles(note, { 'font-size': size(look.notePx), 'margin-top': size(NOTE_SPACE_PX) });
  }

  private applyContent(slate: SlateDto, imageUrl: string | null, notice: SlateNotice | null): void {
    const { image, imageLoader, scrim, mark, title, rule, subtitle, note, look } = this;
    if (!image || !imageLoader || !scrim || !mark || !title || !rule || !subtitle || !note) {
      return;
    }
    const isNotice = notice !== null;
    const withImage = Boolean(imageUrl);
    imageLoader.load(imageUrl || null);
    setVisible(image, withImage);
    // Over a picture the text gets a scrim behind it and a soft shadow, so it reads whatever the picture is.
    setVisible(scrim, withImage);
    const shadow = withImage ? PALETTE.slateShadow : '';

    setVisible(mark, isNotice);

    const titleText = typeof slate.title === 'string' ? slate.title : '';
    setText(title, titleText);
    setStyles(title, {
      ...clampStyles(look.titleLines),
      color: isNotice ? PALETTE.noticeTitle : '',
      'line-height': isNotice ? '1.15' : '1.08',
      'letter-spacing': isNotice ? '' : '-0.01em',
      'max-width': look.titleWidth,
      'text-shadow': shadow,
    });

    setVisible(rule, !isNotice && titleText !== '');

    const subtitleText = typeof slate.subtitle === 'string' ? slate.subtitle : '';
    setText(subtitle, subtitleText);
    setStyles(subtitle, {
      ...clampStyles(look.subtitleLines),
      color: isNotice ? PALETTE.noticeBody : PALETTE.slateSubtext,
      'line-height': isNotice ? '1.4' : '1.3',
      'max-width': look.subtitleWidth,
      'text-shadow': shadow,
    });
    setVisible(subtitle, subtitleText !== '', CLAMPED_DISPLAY);

    const noteText = notice?.note ?? '';
    setText(note, noteText);
    setVisible(note, noteText !== '');
  }
}
