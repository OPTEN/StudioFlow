import { autoGridSlots } from '@flowstudio/scene-model';

import type { CanvasRect } from './types';

/** An item that may take part in the Auto-Grid. */
export interface GridCandidate {
  readonly id: string;
  /** Visible and with an available source (media, live, or lost within the hold time). */
  readonly available: boolean;
}

/**
 * Rectangles of the Auto-Grid (spec 4.3): the available items, in item order, get the slots of
 * `autoGridSlots(count)`. Unavailable items and items beyond the last slot are not placed (absent from the map).
 */
export function autoGridRects(candidates: readonly GridCandidate[]): Map<string, CanvasRect> {
  const placed = candidates.filter((candidate) => candidate.available);
  const slots = autoGridSlots(placed.length);
  const rects = new Map<string, CanvasRect>();
  placed.forEach((candidate, index) => {
    const slot = slots[index];
    if (slot) {
      const [x, y, w, h] = slot;
      rects.set(candidate.id, { x, y, w, h });
    }
  });
  return rects;
}
