import { t } from '@studioflow/i18n';
import {
  DEFAULT_FADE_MS,
  parseSourceRef,
  slotKind,
  type SceneItemDto,
} from '@studioflow/scene-model';

import { SMALL_PICTURE, type DesiredSizeCollector } from './desired-sizes';
import { createElement, FILL, px, setStyle, setStyles, setText, setVisible } from './dom';
import {
  cropBox,
  desiredPixelSize,
  heldBlurPx,
  heldMessagePx,
  itemLook,
  mediaBox,
  type Box,
  type ItemLook,
} from './geometry';
import {
  blurCanvas,
  copyHoldFrame,
  copyVideoFrame,
  hasRunningTrack,
  hasVideoFrame,
  releaseCanvas,
  waitForVideoFrame,
} from './hold-frame';
import type { MediaView } from './media-view';
import { alertPresentation, type AlertPresentation } from './monitor-alert';
import { MonitorOverlay } from './monitor-overlay';
import { PALETTE, UI_FONT } from './palette';
import { animatePresence, type PresenceAnimation } from './presence';
import type { RenderContext, RenderFrame } from './render-context';
import { snapshotBudget } from './snapshot-budget';
import { isSameSource, type ResolvedSource } from './source-resolver';
import { isLostState, normalizeHoldMs, sourceState, type SourceState } from './source-state';
import type { StillHolder } from './still-pool';
import { TextBlock } from './text-block';
import type { CanvasRect } from './types';

/** The hold message (`renderer.held`) is only drawn on items at least this wide (canvas pixels). */
const HELD_MESSAGE_MIN_WIDTH = 320;
/** Longest wait for the first new frame of a returned source before the hold picture is removed anyway. */
const REVEAL_TIMEOUT_MS = 1500;

/** What a lost source currently looks like (independent of the source state, see {@link ItemView.render}). */
type LostVisual = 'none' | 'holding' | 'held';

/** Creates the media view of a source (reusing one from an outgoing layer where possible). */
export type MediaFactory = (source: ResolvedSource) => MediaView;

/**
 * DOM of one scene item. The element tree is stable for the lifetime of the item id; every render only writes the
 * styles that changed.
 *
 * ```
 * div.sf-r-item            position, size, radius, clipping, bars/placeholder colour, z-index
 *   div.sf-r-crop          uncropped picture box (crop math)
 *     div.sf-r-box         rotation; hidden while the fallback shows
 *       video|img          object-fit, mirror
 *       canvas             hold frame: rolling copy of the live picture, shown while lost, blurred once when held;
 *                          in a thumbnail the snapshot of the picture, always shown (no video)
 *   div.sf-r-fallback      fallback source after the hold time
 *   div.sf-r-held          dark scrim + “Picture returns shortly”
 *   div.sf-r-border        inset box-shadow border
 *   div.sf-r-text          text items only: the text drawn as HTML ({@link TextBlock})
 *   …                      monitor overlay: “Source missing”, alert outline and label ({@link MonitorOverlay})
 * ```
 */
export class ItemView {
  readonly root: HTMLDivElement;
  private readonly cropEl: HTMLDivElement;
  private readonly boxEl: HTMLDivElement;
  private readonly fallbackEl: HTMLDivElement;
  private readonly heldEl: HTMLDivElement;
  private readonly heldTextEl: HTMLSpanElement;
  private readonly borderEl: HTMLDivElement;
  private readonly overlay: MonitorOverlay;

  private item: SceneItemDto;
  private look: ItemLook;
  private holdMs: number | null;
  private media: MediaView | null;
  private fallbackSource: ResolvedSource | null;
  private fallbackMedia: MediaView | null = null;
  private holdFrame: HTMLCanvasElement | null = null;
  /** Source whose picture the hold frame shows (kept when the media view is handed over). */
  private holdFrameSource: string | null = null;
  /** The hold frame was blurred for the held state (tried once per copy, see {@link blurHoldFrame}). */
  private holdBlur: 'sharp' | 'blurred' | 'failed' = 'sharp';
  /** Thumbnail: the device source whose snapshot this item shows, and the registration with the pool. */
  private stillSource: string | null = null;
  private stillHolder: StillHolder | null = null;
  /** Thumbnail: the snapshot as an image (see {@link StillPool}); created with the first one. */
  private stillImage: HTMLImageElement | null = null;
  private cancelReveal: (() => void) | null = null;
  private lostVisual: LostVisual = 'none';
  private lastState: SourceState['kind'] | null = null;
  private rect: CanvasRect | null = null;
  private pictureBox: Box | null = null;
  private alert: AlertPresentation | null = null;
  private textBlock: TextBlock | null = null;
  private presence: PresenceAnimation | null = null;
  /** Whether the text item is shown; null before its first render. */
  private textShown: boolean | null = null;

  constructor(
    item: SceneItemDto,
    private readonly ctx: RenderContext,
    private readonly createMedia: MediaFactory,
  ) {
    const doc = ctx.doc;
    this.root = createElement(doc, 'div', 'sf-r-item', {
      position: 'absolute',
      left: '0',
      top: '0',
      overflow: 'hidden',
      'transform-origin': '0 0',
      contain: 'strict',
    });
    this.cropEl = createElement(doc, 'div', 'sf-r-crop', { position: 'absolute' });
    this.boxEl = createElement(doc, 'div', 'sf-r-box', {
      position: 'absolute',
      'transform-origin': '50% 50%',
    });
    this.fallbackEl = createElement(doc, 'div', 'sf-r-fallback', { ...FILL, display: 'none' });
    this.heldEl = createElement(doc, 'div', 'sf-r-held', {
      ...FILL,
      display: 'none',
      'align-items': 'center',
      'justify-content': 'center',
      overflow: 'hidden',
      'white-space': 'nowrap',
      background: PALETTE.heldScrim,
      color: PALETTE.text,
      'font-family': UI_FONT,
      'font-weight': '600',
      'letter-spacing': '0.01em',
    });
    this.heldTextEl = createElement(doc, 'span', 'sf-r-held-text');
    this.borderEl = createElement(doc, 'div', 'sf-r-border', {
      ...FILL,
      'border-radius': 'inherit',
      display: 'none',
    });
    this.overlay = new MonitorOverlay(doc);
    this.root.setAttribute('data-item-id', item.id);
    this.heldEl.append(this.heldTextEl);
    this.cropEl.append(this.boxEl);
    this.root.append(
      this.cropEl,
      this.fallbackEl,
      this.heldEl,
      this.borderEl,
      ...this.overlay.elements,
    );

    this.item = item;
    this.look = itemLook(item);
    this.holdMs = normalizeHoldMs(item.onLost?.holdMs);
    this.fallbackSource = this.resolveFallback(item);
    this.media = this.mountMedia(ctx.resolve(item.source));
  }

  /** The item as last set. */
  get current(): SceneItemDto {
    return this.item;
  }

  /** The alert drawn in the last render (monitor), null when none is shown. */
  get shownAlert(): AlertPresentation | null {
    return this.alert;
  }

  /** Applies a changed item; the media element is only replaced when the resolved source changed. */
  setItem(item: SceneItemDto): void {
    this.item = item;
    this.look = itemLook(item);
    this.holdMs = normalizeHoldMs(item.onLost?.holdMs);
    const source = this.ctx.resolve(item.source);
    if (!this.media || !isSameSource(this.media.source, source)) {
      this.resetLostState();
      this.releaseStill();
      this.releaseHoldFrame();
      this.releaseText();
      this.media?.dispose();
      this.media = this.mountMedia(source);
    }
    const fallback = this.resolveFallback(item);
    if (!this.fallbackSource || !fallback || !isSameSource(this.fallbackSource, fallback)) {
      this.fallbackMedia?.dispose();
      this.fallbackMedia = null;
    }
    this.fallbackSource = fallback;
  }

  /** Current state of the primary source. */
  state(now: number): SourceState {
    const source = this.media?.source;
    if (!source) {
      return { kind: 'missing' };
    }
    const isDevice = source.kind === 'device';
    return sourceState(
      source,
      isDevice ? this.ctx.availability(source.sourceId) : { state: 'live' },
      this.holdMs,
      this.isKnown(source),
      now,
    );
  }

  /** True for a text item: it overlays the picture, keeps its own rectangle in the Auto-Grid and fades in and out. */
  get isText(): boolean {
    return this.media?.source.kind === 'text';
  }

  /** Paint order within the layer (array index). */
  setOrder(index: number): void {
    setStyle(this.root, 'z-index', String(index));
  }

  /** Renders the item at `rect` (null: hidden, or not placed by the Auto-Grid) for the given source state. */
  render(rect: CanvasRect | null, state: SourceState, frame: RenderFrame): void {
    this.rect = rect;
    if (this.isText) {
      this.renderText(rect, state, frame);
      return;
    }
    setVisible(this.root, rect !== null);
    if (rect) {
      this.renderGeometry(rect);
    }
    this.updateLostVisual(state, frame);
    if (!rect) {
      this.alert = null;
      return;
    }
    this.renderPicture(rect, state);
    this.renderOverlays(rect, state, frame);
  }

  /** True while the item shows a live device picture whose hold frame should be kept fresh (not a thumbnail: its snapshot is renewed by the pool). */
  get keepsHoldFrame(): boolean {
    return (
      this.lastState === 'live' &&
      this.lostVisual === 'none' &&
      this.rect !== null &&
      !!this.media?.deviceVideo
    );
  }

  /**
   * Refreshes the rolling hold frame (called about once per second while {@link keepsHoldFrame}). A copy that is
   * expensive on this computer makes the next ones wait (see {@link snapshotBudget}); the first copy and the one at the
   * moment of a loss never wait.
   */
  refreshHoldFrame(frame: RenderFrame): void {
    if (this.keepsHoldFrame) {
      this.copyHoldFrame(frame, false);
    }
  }

  /** Adds the picture sizes this item needs to the collector. */
  collectDesiredSizes(collector: DesiredSizeCollector, frame: RenderFrame): void {
    const { scale, devicePixelRatio } = frame;
    const source = this.media?.source;
    if (this.item.hidden || !source) {
      return;
    }
    if (!this.rect || !this.pictureBox) {
      // Not placed by the Auto-Grid: keep the source subscribed so it can come back.
      if (source.kind === 'device') {
        collector.add(source.sourceId, SMALL_PICTURE);
      }
      return;
    }
    const canvas = this.ctx.canvas();
    if (source.kind === 'device') {
      collector.add(
        source.sourceId,
        desiredPixelSize(this.pictureBox, scale, devicePixelRatio, canvas),
      );
    }
    const fallback = this.fallbackMedia?.source;
    if (fallback?.kind === 'device') {
      const box = { left: 0, top: 0, width: this.rect.w, height: this.rect.h };
      collector.add(fallback.sourceId, desiredPixelSize(box, scale, devicePixelRatio, canvas));
    }
  }

  /** The hold frame of `sourceId` if this item has one with content (donor for other items, see RenderContext). */
  holdFrameOf(sourceId: string): HTMLCanvasElement | null {
    const canvas = this.holdFrame;
    return canvas && this.holdFrameSource === sourceId && canvas.width > 0 ? canvas : null;
  }

  /** Hands the primary media view over (cut to a scene with the same source); the item no longer owns it. */
  releaseMedia(): MediaView | null {
    const media = this.media;
    this.media = null;
    return media;
  }

  /** Removes the DOM and releases media, hold frame and listeners. */
  dispose(): void {
    this.resetLostState();
    this.releaseStill();
    this.releaseHoldFrame();
    this.releaseText();
    this.media?.dispose();
    this.media = null;
    this.root.remove();
  }

  private isKnown(source: ResolvedSource): boolean {
    switch (source.kind) {
      case 'device':
        return this.ctx.isKnown(source.sourceId);
      case 'text':
        return this.ctx.textOf(source.sourceId) !== undefined;
      default:
        return true;
    }
  }

  /**
   * A text item: drawn as HTML into the item rectangle and faded and slid in or out when it is shown or hidden. While
   * it hides (`rect` null) it keeps its last geometry until the animation has ended.
   */
  private renderText(rect: CanvasRect | null, state: SourceState, frame: RenderFrame): void {
    const block = this.textBlock ?? this.mountText();
    const sourceId = this.media?.source.sourceId ?? '';
    if (rect) {
      this.renderGeometry(rect);
      block.render(rect, this.ctx.textOf(sourceId), this.ctx.textTheme());
    }
    this.present(rect !== null, block);
    const missing = this.ctx.mode === 'monitor' && state.kind === 'missing';
    setStyle(this.root, 'background-color', missing ? PALETTE.placeholder : '');
    this.alert = null;
    this.overlay.render({ missing, alert: null, radius: this.look.radius, scale: frame.scale });
  }

  private mountText(): TextBlock {
    const block = new TextBlock(this.ctx.doc);
    this.root.append(block.element);
    this.textBlock = block;
    return block;
  }

  /**
   * Shows or hides the text. The first render only sets the state (a scene that is cut or faded in brings its texts
   * along); later changes animate, and a change while an animation runs finishes that one first, so every
   * animation runs to completion.
   */
  private present(shown: boolean, block: TextBlock): void {
    if (shown === this.textShown) {
      return;
    }
    const first = this.textShown === null;
    this.textShown = shown;
    this.presence?.finish();
    if (shown) {
      setVisible(this.root, true);
    }
    if (first) {
      setVisible(this.root, shown);
      return;
    }
    const duration = this.ctx.reducedMotion ? 0 : DEFAULT_FADE_MS;
    this.presence = animatePresence(block.element, shown, block.enterOffset, duration, () =>
      this.ctx.guard(() => {
        this.presence = null;
        if (!this.textShown) {
          setVisible(this.root, false);
        }
      }),
    );
  }

  private releaseText(): void {
    this.presence?.finish();
    this.presence = null;
    this.textShown = null;
    this.textBlock?.element.remove();
    this.textBlock = null;
  }

  private mountMedia(source: ResolvedSource): MediaView {
    const media = this.createMedia(source);
    if (media.element) {
      this.boxEl.prepend(media.element);
    }
    if (source.kind === 'device' && this.ctx.stillPictures) {
      this.acquireStill(source.sourceId);
    }
    return media;
  }

  /** Thumbnail: shows the shared snapshot of the source; a new one is copied into the item's own canvas. */
  private acquireStill(sourceId: string): void {
    const holder: StillHolder = {
      onUpdate: () => this.takeStill(),
      wanted: () => this.ctx.visible() && this.rect !== null,
    };
    this.stillSource = sourceId;
    this.stillHolder = holder;
    this.ctx.stills()?.acquire(sourceId, holder);
    this.takeStill();
  }

  private releaseStill(): void {
    if (this.stillSource !== null && this.stillHolder !== null) {
      this.ctx.stills()?.release(this.stillSource, this.stillHolder);
    }
    this.stillSource = null;
    this.stillHolder = null;
    this.stillImage?.remove();
    this.stillImage = null;
  }

  /** Shows the snapshot of the pool in the item's image, which a thumbnail always shows; a lost source keeps the last one. */
  private takeStill(): void {
    const sourceId = this.stillSource;
    const url = sourceId === null ? null : (this.ctx.stills()?.urlOf(sourceId) ?? null);
    if (url === null || this.lostVisual !== 'none') {
      return;
    }
    let image = this.stillImage;
    if (image === null) {
      image = createElement(this.ctx.doc, 'img', 'sf-r-still', { ...FILL, display: 'none' });
      image.alt = '';
      image.decoding = 'async';
      image.setAttribute('aria-hidden', 'true');
      this.boxEl.append(image);
      this.stillImage = image;
    }
    if (image.getAttribute('src') !== url) {
      image.src = url;
    }
    if (image.style.display === 'none') {
      // The first picture: the next render pass shows the image and gives it the fit and the mirror of the item.
      this.ctx.requestRender();
    }
  }

  private resolveFallback(item: SceneItemDto): ResolvedSource | null {
    const ref = item.onLost?.fallbackSource;
    return typeof ref === 'string' && ref !== '' && ref !== item.source
      ? this.ctx.resolve(ref)
      : null;
  }

  /**
   * Tracks the lost picture independently of the source state: entering a lost state refreshes the hold frame one
   * last time (refused when the track already ended, so the rolling copy stays); returning to live keeps the lost
   * picture until the video has a new frame (no black flash).
   */
  private updateLostVisual(state: SourceState, frame: RenderFrame): void {
    if (isLostState(state)) {
      this.stopReveal();
      if (this.lastState !== 'holding' && this.lastState !== 'held') {
        this.copyHoldFrame(frame);
      }
      this.lostVisual = state.kind;
    } else if (state.kind === 'live') {
      if (this.lostVisual !== 'none') {
        this.revealWhenReady();
      }
    } else {
      this.resetLostState();
      this.releaseHoldFrame();
    }
    this.lastState = state.kind;
  }

  /**
   * Copies the current frame into the hold frame canvas at on-screen resolution. When the video has no usable frame
   * and this item has no hold frame yet (it appeared while the source was lost), another item's copy is taken.
   */
  private copyHoldFrame(frame: RenderFrame, urgent = true): void {
    if (this.stillSource !== null) {
      this.takeStill();
      return;
    }
    const media = this.media;
    const video = media?.deviceVideo;
    if (!media || !video || !this.pictureBox) {
      return;
    }
    const sourceId = media.source.sourceId;
    // Checked before a canvas is allocated: until the first frame arrives this runs every second.
    if (hasVideoFrame(video) && hasRunningTrack(video)) {
      if (!urgent && this.holdFrame !== null && !snapshotBudget.allows()) {
        return;
      }
      const limit = desiredPixelSize(this.pictureBox, frame.scale, frame.devicePixelRatio);
      this.storeHoldFrame(sourceId, (canvas) =>
        snapshotBudget.measure(() => copyVideoFrame(video, canvas, limit)),
      );
    } else if (!this.holdFrame) {
      const donor = this.ctx.holdFrameDonor(sourceId, this);
      if (donor) {
        this.storeHoldFrame(sourceId, (canvas) => copyHoldFrame(donor, canvas));
      }
    }
  }

  /** Runs a copy into the hold frame canvas (created on the first successful copy). */
  private storeHoldFrame(sourceId: string, copy: (canvas: HTMLCanvasElement) => boolean): void {
    const canvas =
      this.holdFrame ??
      createElement(this.ctx.doc, 'canvas', 'sf-r-hold-frame', { ...FILL, display: 'none' });
    if (!copy(canvas)) {
      return;
    }
    this.holdFrameSource = sourceId;
    this.holdBlur = 'sharp';
    if (!this.holdFrame) {
      canvas.setAttribute('aria-hidden', 'true');
      this.boxEl.append(canvas);
      this.holdFrame = canvas;
    }
  }

  private releaseHoldFrame(): void {
    if (this.holdFrame) {
      releaseCanvas(this.holdFrame);
      this.holdFrame = null;
    }
    this.holdFrameSource = null;
    this.holdBlur = 'sharp';
  }

  /**
   * The held state shows the last picture blurred. The blur is computed once into the copy (a CSS `filter` on the live
   * element would be re-run by the browser for every frame it paints); a new copy starts sharp again.
   */
  private blurHoldFrame(rect: CanvasRect): void {
    const canvas = this.holdFrame;
    if (!canvas || this.holdBlur !== 'sharp' || canvas.width === 0) {
      return;
    }
    const across = this.pictureBox?.width ?? rect.w;
    const radius = Math.round(heldBlurPx(rect.w) * (canvas.width / Math.max(1, across)) * 10) / 10;
    this.holdBlur = blurCanvas(canvas, radius) ? 'blurred' : 'failed';
  }

  private revealWhenReady(): void {
    if (this.cancelReveal) {
      return;
    }
    const video = this.media?.deviceVideo;
    if (!video || hasVideoFrame(video)) {
      this.clearLostVisual();
      return;
    }
    this.cancelReveal = waitForVideoFrame(video, REVEAL_TIMEOUT_MS, () => {
      this.ctx.guard(() => {
        this.cancelReveal = null;
        this.clearLostVisual();
        this.ctx.requestRender();
      });
    });
  }

  private stopReveal(): void {
    this.cancelReveal?.();
    this.cancelReveal = null;
  }

  private clearLostVisual(): void {
    this.fallbackMedia?.dispose();
    this.fallbackMedia = null;
    this.lostVisual = 'none';
  }

  private resetLostState(): void {
    this.stopReveal();
    this.clearLostVisual();
    this.lastState = null;
  }

  private renderGeometry(rect: CanvasRect): void {
    const { crop, rotation, radius } = this.look;
    setStyles(this.root, {
      transform: `translate(${px(rect.x)}, ${px(rect.y)})`,
      width: px(rect.w),
      height: px(rect.h),
      'border-radius': radius > 0 ? px(radius) : '',
    });
    const outer = cropBox(rect.w, rect.h, crop);
    setStyles(this.cropEl, {
      left: px(outer.left),
      top: px(outer.top),
      width: px(outer.width),
      height: px(outer.height),
    });
    const inner = mediaBox(outer.width, outer.height, rotation);
    this.pictureBox = inner;
    setStyles(this.boxEl, {
      left: px(inner.left),
      top: px(inner.top),
      width: px(inner.width),
      height: px(inner.height),
      transform: rotation === 0 ? '' : `rotate(${rotation}deg)`,
    });
    const border = this.look.border;
    setVisible(this.borderEl, border !== null);
    setStyle(
      this.borderEl,
      'box-shadow',
      border ? `inset 0 0 0 ${px(border.width)} ${border.color}` : '',
    );
  }

  private renderPicture(rect: CanvasRect, state: SourceState): void {
    const { fit, mirror } = this.look;
    const pictureStyles = { 'object-fit': fit, transform: mirror ? 'scaleX(-1)' : '' };
    if (this.media?.element) {
      setStyles(this.media.element, pictureStyles);
    }
    const showFallback = this.lostVisual === 'held' && this.fallbackSource !== null;
    const darken = this.lostVisual === 'held' && !showFallback;
    if (darken) {
      this.blurHoldFrame(rect);
    }
    if (this.holdFrame) {
      setStyles(this.holdFrame, pictureStyles);
      setVisible(this.holdFrame, this.lostVisual !== 'none');
    }
    if (this.stillImage) {
      setStyles(this.stillImage, pictureStyles);
      setVisible(this.stillImage, true);
    }
    setStyle(this.root, 'background-color', this.backgroundOf(state));
    // The blur sits in the copy; only a picture that could not be blurred there gets the (costly) CSS filter.
    setStyle(
      this.boxEl,
      'filter',
      darken && this.holdBlur !== 'blurred' ? `blur(${px(heldBlurPx(rect.w))})` : '',
    );
    // The radius of the blur in canvas pixels, for tests and tools: the pixels themselves are blurred in the copy.
    if (darken && this.holdBlur === 'blurred') {
      this.boxEl.setAttribute('data-held-blur', String(Math.round(heldBlurPx(rect.w) * 10) / 10));
    } else {
      this.boxEl.removeAttribute('data-held-blur');
    }
    setStyle(this.boxEl, 'opacity', showFallback ? '0' : '');
    setVisible(this.heldEl, darken, 'flex');
    if (darken) {
      setText(this.heldTextEl, t('renderer.held'));
      setStyle(this.heldEl, 'font-size', px(heldMessagePx(rect.w, rect.h)));
    }
    setVisible(this.heldTextEl, rect.w >= HELD_MESSAGE_MIN_WIDTH, 'inline');
    this.renderFallback(showFallback);
  }

  private backgroundOf(state: SourceState): string {
    const noPicture =
      (state.kind === 'missing' || state.kind === 'pending') && this.lostVisual === 'none';
    if (noPicture) {
      return PALETTE.placeholder;
    }
    return this.look.fit === 'contain' ? PALETTE.containBars : '';
  }

  private renderFallback(show: boolean): void {
    setVisible(this.fallbackEl, show);
    if (!show || !this.fallbackSource) {
      return;
    }
    if (!this.fallbackMedia) {
      this.fallbackMedia = this.createMedia(this.fallbackSource);
      if (this.fallbackMedia.element) {
        this.fallbackEl.append(this.fallbackMedia.element);
      }
    }
    const missing = this.fallbackMedia.source.kind === 'missing';
    setStyle(
      this.fallbackEl,
      'background-color',
      missing ? PALETTE.placeholder : this.look.fit === 'contain' ? PALETTE.containBars : '',
    );
    if (this.fallbackMedia.element) {
      // Crop, rotation and mirror belong to the primary picture (a mirrored camera must not mirror a pause slate).
      setStyle(this.fallbackMedia.element, 'object-fit', this.look.fit);
    }
  }

  private renderOverlays(rect: CanvasRect, state: SourceState, frame: RenderFrame): void {
    const monitor = this.ctx.mode === 'monitor';
    this.alert = monitor ? this.alertFor(rect, state, frame) : null;
    this.overlay.render({
      missing: monitor && state.kind === 'missing',
      alert: this.alert,
      radius: this.look.radius,
      scale: frame.scale,
    });
  }

  private alertFor(
    rect: CanvasRect,
    state: SourceState,
    frame: RenderFrame,
  ): AlertPresentation | null {
    const source = this.media?.source;
    if (!source) {
      return null;
    }
    const status = this.ctx.statusOf(source.sourceId);
    if (!status) {
      return null;
    }
    // The earliest known start of the outage: the provider's lost time or the moment the status was first seen.
    const statusSince = this.ctx.statusSince(source.sourceId, status, frame.now);
    const since = isLostState(state) ? Math.min(state.since, statusSince) : statusSince;
    const ref = parseSourceRef(source.sourceId);
    return alertPresentation(
      status,
      this.ctx.codeOf(source.sourceId),
      frame.now - since,
      rect.w * frame.scale,
      ref?.kind === 'device' ? slotKind(ref.slot) : null,
    );
  }
}
