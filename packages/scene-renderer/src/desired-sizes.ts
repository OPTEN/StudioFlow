import { parseSourceRef, type SceneDto } from '@studioflow/scene-model';

import { maxDesiredSize } from './geometry';
import type { DesiredSize, SourceMediaProvider } from './types';

/**
 * Small picture (LOW layer) for sources that must stay subscribed without being visible: preloaded scenes, and
 * Auto-Grid items waiting for their source to return.
 */
export const SMALL_PICTURE: DesiredSize = { width: 320, height: 180 };

/**
 * Small-picture requests for the device sources of preloaded scenes (output: preview and other scenes) that are not
 * already requested for the stage. Malformed scenes and items are skipped.
 */
export function preloadRequests(
  scenes: readonly SceneDto[],
  onStage: ReadonlyMap<string, DesiredSize>,
): Map<string, DesiredSize> {
  const requests = new Map<string, DesiredSize>();
  for (const scene of scenes) {
    const items: unknown = scene?.items;
    if (!Array.isArray(items)) {
      continue;
    }
    for (const item of items as SceneDto['items']) {
      const source = item?.source;
      if (
        !item?.hidden &&
        typeof source === 'string' &&
        !onStage.has(source) &&
        parseSourceRef(source)?.kind === 'device'
      ) {
        requests.set(source, SMALL_PICTURE);
      }
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
