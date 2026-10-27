import { parseSourceRef, type CanvasSize, type SceneDto } from '@studioflow/scene-model';

import { autoGridRects } from './auto-grid';
import { desiredPixelSize, itemLook, itemRect, maxDesiredSize, pictureBoxOf } from './geometry';
import type { CanvasRect, DesiredSize, SourceMediaProvider } from './types';

/**
 * Small picture (LOW layer) for sources that must stay subscribed without being visible: preloaded scenes, and
 * Auto-Grid items waiting for their source to return.
 */
export const SMALL_PICTURE: DesiredSize = { width: 320, height: 180 };

/** How the stage looks, for the sizes a preloaded scene will need once it is on stage. */
export interface PreloadGeometry {
  readonly canvas: CanvasSize;
  /** Stage scale (canvas → CSS pixels). */
  readonly scale: number;
  /** The pixel ratio sizes are requested for (see `requestPixelRatio`). */
  readonly devicePixelRatio: number;
}

/** True when `have` is at least as large as `need` on both axes. */
function covers(have: DesiredSize | undefined, need: DesiredSize): boolean {
  return have !== undefined && have.width >= need.width && have.height >= need.height;
}

/** Rectangles of the visible items of a scene as they would be placed on stage (every source counts as available). */
function plannedRects(
  items: SceneDto['items'],
  layoutMode: SceneDto['layoutMode'],
  canvas: CanvasSize,
): Map<string, CanvasRect> {
  const visible = items.filter((item) => item && !item.hidden && typeof item.id === 'string');
  if (layoutMode !== 'autoGrid') {
    return new Map(visible.map((item) => [item.id, itemRect(item)]));
  }
  // Texts keep their own rectangle in an Auto-Grid scene, everything else is placed by the grid.
  const isText = (item: SceneDto['items'][number]): boolean =>
    parseSourceRef(item.source)?.kind === 'text';
  const placed = autoGridRects(
    visible.filter((item) => !isText(item)).map((item) => ({ id: item.id, available: true })),
    canvas,
  );
  return new Map([
    ...visible.filter(isText).map((item): [string, CanvasRect] => [item.id, itemRect(item)]),
    ...placed,
  ]);
}

/**
 * Picture requests for the device sources of preloaded scenes (output: the preview scene, the next Take): each source
 * at the size it will have once the scene is on stage, so the Take shows the sharp picture at once and the layer does not
 * change after it. A source that the stage already requests at least that large is left out. Malformed scenes and items
 * are skipped.
 */
export function preloadRequests(
  scenes: readonly SceneDto[],
  onStage: ReadonlyMap<string, DesiredSize>,
  geometry: PreloadGeometry,
): Map<string, DesiredSize> {
  const collector = new DesiredSizeCollector();
  for (const scene of scenes) {
    const items: unknown = scene?.items;
    if (!Array.isArray(items)) {
      continue;
    }
    const rects = plannedRects(items as SceneDto['items'], scene.layoutMode, geometry.canvas);
    for (const item of items as SceneDto['items']) {
      const source = item?.source;
      const rect = rects.get(item?.id);
      if (
        !item ||
        item.hidden ||
        !rect ||
        typeof source !== 'string' ||
        parseSourceRef(source)?.kind !== 'device'
      ) {
        continue;
      }
      const box = pictureBoxOf(rect, itemLook(item));
      collector.add(
        source,
        desiredPixelSize(box, geometry.scale, geometry.devicePixelRatio, geometry.canvas),
      );
    }
  }
  const requests = new Map<string, DesiredSize>();
  for (const [source, size] of collector.result()) {
    if (!covers(onStage.get(source), size)) {
      requests.set(source, size);
    }
  }
  return requests;
}

/** Collects desired sizes per source; a source requested twice keeps the larger size per axis. */
export class DesiredSizeCollector {
  private readonly sizes = new Map<string, DesiredSize>();

  /** Adds a request for a source. */
  add(sourceId: string, size: DesiredSize): void {
    const current = this.sizes.get(sourceId);
    this.sizes.set(sourceId, current ? maxDesiredSize(current, size) : size);
  }

  /** The collected sizes. */
  result(): ReadonlyMap<string, DesiredSize> {
    return this.sizes;
  }
}

/**
 * Reports the desired sizes of one consumer to the provider and only sends differences: changed sizes, and null for
 * sources that are no longer needed.
 */
export class DesiredSizeReporter {
  private reported = new Map<string, DesiredSize>();

  constructor(
    private readonly provider: SourceMediaProvider,
    readonly consumerId: string,
    private readonly guard: (run: () => void) => void,
  ) {}

  /** Makes the reported state equal to `next`. */
  sync(next: ReadonlyMap<string, DesiredSize>): void {
    for (const sourceId of this.reported.keys()) {
      if (!next.has(sourceId)) {
        this.guard(() => this.provider.setDesiredSize(sourceId, this.consumerId, null));
      }
    }
    for (const [sourceId, size] of next) {
      const previous = this.reported.get(sourceId);
      if (!previous || previous.width !== size.width || previous.height !== size.height) {
        this.guard(() => this.provider.setDesiredSize(sourceId, this.consumerId, size));
      }
    }
    this.reported = new Map(next);
  }

  /** Withdraws every request of this consumer. */
  clear(): void {
    this.sync(new Map());
  }
}
