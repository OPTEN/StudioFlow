import type { CanvasSize, SlateDto } from '@studioflow/scene-model';

import { createElement, FILL, px, setStyle, setText, setVisible } from './dom';
import { AssetLoader } from './asset-loader';
import { fadeOpacity, type Fade } from './fade';
import { createImage } from './media-view';
import { PALETTE, UI_FONT } from './palette';

/** Fade of slates in and out. */
const SLATE_FADE_MS = 300;
/** Sizes of the slate text on a canvas with a short side of 1080 pixels; other canvases scale them with the short side. */
const TITLE_PX = 72;
const SUBTITLE_PX = 36;
const GAP_PX = 24;
const REFERENCE_SHORT_SIDE = 1080;

/**
 * Full-stage slate (“Starting soon”, “Thanks for watching”) above all scene layers. Showing and hiding fade over
 * {@link SLATE_FADE_MS}; reversing mid-way continues from the current opacity, so there is never a jump.
 */
export class SlateView {
  private element: HTMLDivElement | null = null;
  private image: HTMLImageElement | null = null;
  private imageLoader: AssetLoader | null = null;
  private title: HTMLDivElement | null = null;
  private subtitle: HTMLDivElement | null = null;
  private fade: Fade | null = null;
  private visible = false;
  /** Size of the slate text relative to a 1080 pixel short side. */
  private scale: number;

  constructor(
    private readonly doc: Document,
    private readonly host: HTMLElement,
    private readonly reducedMotion: boolean,
    canvas: CanvasSize,
  ) {
    this.scale = Math.min(canvas.width, canvas.height) / REFERENCE_SHORT_SIDE;
  }

  /** Shows (or updates) a slate; null hides it. */
  show(slate: SlateDto | null, imageUrl: string | null): void {
    if (!slate) {
      this.hide();
      return;
    }
    const element = this.element ?? this.build();
    this.applyContent(slate, imageUrl);
    if (!this.visible) {
      this.visible = true;
      const from = this.fade ? this.fade.stop() : 0;
      this.startFade(element, from, 1);
    }
  }

  /** The canvas changed: the text keeps its size relative to the short side. */
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
    this.element = this.image = this.title = this.subtitle = null;
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
    const element = createElement(this.doc, 'div', 'sf-r-slate', {
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
    const image = createImage(this.doc, 'sf-r-slate-image', {
      ...FILL,
      'object-fit': 'cover',
      display: 'none',
    });
    this.imageLoader = new AssetLoader(image);
    const textStyles = { position: 'relative', 'max-width': '80%', 'overflow-wrap': 'anywhere' };
    const title = createElement(this.doc, 'div', 'sf-r-slate-title', {
      ...textStyles,
      'font-weight': '600',
      'line-height': '1.1',
    });
    const subtitle = createElement(this.doc, 'div', 'sf-r-slate-subtitle', {
      ...textStyles,
      'font-weight': '400',
      'line-height': '1.25',
    });
    element.append(image, title, subtitle);
    this.host.append(element);
    this.element = element;
    this.image = image;
    this.title = title;
    this.subtitle = subtitle;
    this.applySizes();
    return element;
  }

  private applySizes(): void {
    const { element, title, subtitle } = this;
    if (!element || !title || !subtitle) {
      return;
    }
    setStyle(element, 'gap', px(Math.round(GAP_PX * this.scale)));
    setStyle(title, 'font-size', px(Math.round(TITLE_PX * this.scale)));
    setStyle(subtitle, 'font-size', px(Math.round(SUBTITLE_PX * this.scale)));
  }

  private applyContent(slate: SlateDto, imageUrl: string | null): void {
    const { image, imageLoader, title, subtitle } = this;
    if (!image || !imageLoader || !title || !subtitle) {
      return;
    }
    imageLoader.load(imageUrl || null);
    setVisible(image, Boolean(imageUrl));
    const shadow = imageUrl ? '0 2px 16px rgba(0, 0, 0, 0.6)' : '';
    setText(title, typeof slate.title === 'string' ? slate.title : '');
    setStyle(title, 'text-shadow', shadow);
    const subtitleText = typeof slate.subtitle === 'string' ? slate.subtitle : '';
    setText(subtitle, subtitleText);
    setVisible(subtitle, subtitleText !== '');
    setStyle(subtitle, 'text-shadow', shadow);
  }
}
