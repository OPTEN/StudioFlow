/**
 * Geometry of dragging an entry within a list (one axis): where it would land, how far the others move to make
 * room, where the insertion line goes and how fast the list scrolls near its edges. Pure numbers, no DOM; the
 * coordinates only have to be consistent with each other (content coordinates along the list axis).
 */

/** Extent of one entry along the list axis. */
export interface Slot {
  readonly start: number;
  readonly end: number;
}

/** Where the dragged entry would be inserted: its index in the list once it is dropped. */
export function dropIndex(slots: readonly Slot[], origin: number, draggedCenter: number): number {
  let index = 0;
  slots.forEach((slot, position) => {
    if (position !== origin && (slot.start + slot.end) / 2 < draggedCenter) {
      index += 1;
    }
  });
  return index;
}

/** The list as it looks while the entry at `origin` is held over `target`. */
export interface HeldLayout {
  /** How far each entry moves along the axis; the held entry's own value is where it would snap to. */
  readonly shifts: readonly number[];
  /** Position of the insertion line (between the neighbours), or null when nothing would change. */
  readonly line: number | null;
}

/**
 * Lays the entries out again in the order they will have after the move, keeping their sizes and the average gap,
 * and reports the shift of every entry against its current slot.
 */
export function heldLayout(slots: readonly Slot[], origin: number, target: number): HeldLayout {
  if (slots.length === 0) {
    return { shifts: [], line: null };
  }
  const sizes = slots.map((slot) => slot.end - slot.start);
  const total = sizes.reduce((sum, size) => sum + size, 0);
  const gap =
    slots.length > 1
      ? (slots[slots.length - 1].end - slots[0].start - total) / (slots.length - 1)
      : 0;
  const order = slots.map((_, index) => index).filter((index) => index !== origin);
  order.splice(target, 0, origin);
  const shifts = new Array<number>(slots.length).fill(0);
  let position = slots[0].start;
  let line: number | null = null;
  for (const index of order) {
    shifts[index] = position - slots[index].start;
    if (index === origin && target !== origin) {
      line = target < origin ? position - gap / 2 : position + sizes[index] + gap / 2;
    }
    position += sizes[index] + gap;
  }
  return { shifts, line };
}

/** Scroll speed in px per frame, negative towards the start: zero in the middle, up to `maxSpeed` at the edge. */
export function edgeScrollSpeed(
  pointer: number,
  viewStart: number,
  viewEnd: number,
  zone: number,
  maxSpeed: number,
): number {
  const size = viewEnd - viewStart;
  const reach = Math.min(zone, size / 3);
  if (reach <= 0) {
    return 0;
  }
  if (pointer < viewStart + reach) {
    return -maxSpeed * Math.min(1, (viewStart + reach - pointer) / reach);
  }
  if (pointer > viewEnd - reach) {
    return maxSpeed * Math.min(1, (pointer - (viewEnd - reach)) / reach);
  }
  return 0;
}
