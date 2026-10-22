import type { SceneDto, SceneItemDto } from '@flowstudio/scene-model';

import { autoGridRects } from './auto-grid';
import type { DesiredSizeCollector } from './desired-sizes';
import { createElement, FILL, setStyle, setVisible } from './dom';
import { isHexColor, itemRect } from './geometry';
import { ItemView, type MediaFactory } from './item-view';
import { AssetLoader } from './asset-loader';
import { createImage, MediaView } from './media-view';
import type { RenderContext, RenderFrame } from './render-context';
import { isSameSource, type ResolvedSource } from './source-resolver';
import { isGridAvailable } from './source-state';
import type { CanvasRect } from './types';

/**
 * Media views of an outgoing layer that the incoming layer may take over (cut between scenes that share a source:
 * the `<video>` moves instead of being recreated, so the picture does not flash).
 */
export class MediaPool {
  private readonly views: MediaView[];

  constructor(views: readonly MediaView[]) {
    this.views = [...views];
  }

  /** Takes a view of the same source, if any. */
  take(source: ResolvedSource): MediaView | undefined {
    const index = this.views.findIndex((view) => isSameSource(view.source, source));
    return index < 0 ? undefined : this.views.splice(index, 1)[0];
  }

  /** Disposes every view nobody took. */
  disposeRest(): void {
    for (const view of this.views.splice(0)) {
      view.dispose();
    }
  }
}

/** Items of a scene that can be rendered: entries with a string id, first occurrence of an id wins. */
function renderableItems(scene: SceneDto): SceneItemDto[] {
  const items: unknown = scene.items;
  if (!Array.isArray(items)) {
    return [];
  }
  const seen = new Set<string>();
  return items.filter((item: SceneItemDto | null | undefined): item is SceneItemDto => {
    if (
      !item ||
      typeof item.id !== 'string' ||
      typeof item.source !== 'string' ||
      seen.has(item.id)
    ) {
      return false;
    }
    seen.add(item.id);
    return true;
  });
}

/**
 * One shown scene: background plus one {@link ItemView} per item id. Items keep their DOM across updates; paint order
 * follows the item array through `z-index`, so reordering never re-parents a `<video>`. Hidden items keep their view
 * (not displayed), so showing them again does not recreate the video either.
 */
export class SceneLayer {
  readonly element: HTMLDivElement;
  private readonly backgroundImage: HTMLImageElement;
  private readonly backgroundLoader: AssetLoader;
  private readonly itemsEl: HTMLDivElement;
  private readonly views = new Map<string, ItemView>();
  /** Views in item order (back to front). */
  private order: ItemView[] = [];
  private scene: SceneDto;
  private rects = new Map<string, CanvasRect>();
  private nextExpiry: number | null = null;
  /** Only set while the constructor builds the items. */
  private pool: MediaPool | null;

  /**
   * Builds the layer on top of `host`'s existing layers. The layer is connected before its items are built, so a
   * `<video>` taken from the pool moves between connected trees and keeps playing.
   */
  constructor(
    scene: SceneDto,
    private readonly ctx: RenderContext,
    host: HTMLElement,
    options: { readonly pool?: MediaPool; readonly opacity?: number } = {},
  ) {
    // Own stacking context: item z-indexes must never reach above a later layer or the slate.
    this.element = createElement(ctx.doc, 'div', 'fs-r-layer', {
      ...FILL,
      overflow: 'hidden',
      isolation: 'isolate',
    });
    this.element.setAttribute('data-scene-id', scene.id);
    if (options.opacity !== undefined) {
      this.element.style.opacity = String(options.opacity);
    }
    this.backgroundImage = createImage(ctx.doc, 'fs-r-background', {
      ...FILL,
      'object-fit': 'cover',
      display: 'none',
    });
    this.backgroundLoader = new AssetLoader(this.backgroundImage);
    this.itemsEl = createElement(ctx.doc, 'div', 'fs-r-items', FILL);
    this.element.append(this.backgroundImage, this.itemsEl);
    host.append(this.element);
    this.scene = scene;
    this.pool = options.pool ?? null;
    this.applyScene(scene);
    this.pool = null;
  }

  /** Id of the shown scene. */
  get sceneId(): string {
    return this.scene.id;
  }

  /** Version of the shown scene. */
  get sceneVersion(): number {
    return this.scene.version;
  }

  /** Earliest hold expiry of this layer's items after the last render (performance.now() base), or null. */
  get holdExpiry(): number | null {
    return this.nextExpiry;
  }

  /** Rectangles of the visible items after the last render. */
  get effectiveRects(): ReadonlyMap<string, CanvasRect> {
    return this.rects;
  }

  /** True when an alert with a running timer is shown (monitor). */
  get hasTimedAlert(): boolean {
    return this.order.some((view) => view.shownAlert?.timed === true);
  }

  /** Applies a changed version of the same scene (diff in place). */
  update(scene: SceneDto): void {
    this.scene = scene;
    this.applyScene(scene);
  }

  /** Recomputes source states, Auto-Grid rectangles and every item's styles. */
  render(frame: RenderFrame): void {
    const states = this.order.map((view) => view.state(frame.now));
    const visible = this.order.flatMap((view, index) =>
      view.current.hidden ? [] : [{ view, state: states[index] }],
    );
    this.rects =
      this.scene.layoutMode === 'autoGrid'
        ? autoGridRects(
            visible.map(({ view, state }) => ({
              id: view.current.id,
              available: isGridAvailable(state),
            })),
          )
        : new Map(visible.map(({ view }) => [view.current.id, itemRect(view.current)]));

    let nextExpiry: number | null = null;
    this.order.forEach((view, index) => {
      const state = states[index];
      view.render(this.rects.get(view.current.id) ?? null, state, frame);
      if (state.kind === 'holding' && state.expiresAt !== null && !view.current.hidden) {
        nextExpiry = nextExpiry === null ? state.expiresAt : Math.min(nextExpiry, state.expiresAt);
      }
    });
    this.nextExpiry = nextExpiry;
  }

  /** Adds the picture sizes of every item to the collector. */
  collectDesiredSizes(collector: DesiredSizeCollector, frame: RenderFrame): void {
    for (const view of this.order) {
      view.collectDesiredSizes(collector, frame);
    }
  }

  /** True when a live device picture is shown whose hold frame must be kept fresh. */
  get keepsHoldFrames(): boolean {
    return this.order.some((view) => view.keepsHoldFrame);
  }

  /** Refreshes the rolling hold frames of all live device pictures. */
  refreshHoldFrames(frame: RenderFrame): void {
    for (const view of this.order) {
      view.refreshHoldFrame(frame);
    }
  }

  /** A hold frame of `sourceId` held by an item other than `except`, if any. */
  holdFrameOf(sourceId: string, except: object): HTMLCanvasElement | null {
    for (const view of this.order) {
      const canvas = view === except ? null : view.holdFrameOf(sourceId);
      if (canvas) {
        return canvas;
      }
    }
    return null;
  }

  /** Gives up the primary media views for the next layer (see {@link MediaPool}). */
  releaseMedia(): MediaView[] {
    return this.order
      .map((view) => view.releaseMedia())
      .filter((media): media is MediaView => media !== null);
  }

  /** Removes the DOM and releases all items. */
  dispose(): void {
    for (const view of this.order) {
      view.dispose();
    }
    this.views.clear();
    this.order = [];
    this.rects = new Map();
    this.nextExpiry = null;
    this.backgroundLoader.dispose();
    this.element.remove();
  }

  private readonly createMedia: MediaFactory = (source: ResolvedSource) =>
    this.pool?.take(source) ?? new MediaView(source, this.ctx);

  private applyScene(scene: SceneDto): void {
    this.applyBackground(scene);
    const items = renderableItems(scene);
    const order: ItemView[] = [];
    items.forEach((item, index) => {
      let view = this.views.get(item.id);
      if (view) {
        view.setItem(item);
      } else {
        view = new ItemView(item, this.ctx, this.createMedia);
        this.views.set(item.id, view);
        this.itemsEl.append(view.root);
      }
      view.setOrder(index);
      order.push(view);
    });
    const kept = new Set(order);
    for (const [id, view] of this.views) {
      if (!kept.has(view)) {
        view.dispose();
        this.views.delete(id);
      }
    }
    this.order = order;
  }

  private applyBackground(scene: SceneDto): void {
    const color = scene.background?.color;
    setStyle(
      this.element,
      'background-color',
      !this.ctx.transparent && isHexColor(color) ? color : '',
    );
    const assetId = scene.background?.assetId;
    const source = typeof assetId === 'string' && assetId !== '' ? this.ctx.resolve(assetId) : null;
    const url = source?.kind === 'image' ? source.url : null;
    this.backgroundLoader.load(url);
    setVisible(this.backgroundImage, url !== null);
  }
}
