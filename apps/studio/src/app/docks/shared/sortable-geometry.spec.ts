import { dropIndex, edgeScrollSpeed, heldLayout, type Slot } from './sortable-geometry';

/** Four entries of 40 px with a 2 px gap: 0-40, 42-82, 84-124, 126-166. */
const SLOTS: Slot[] = [0, 1, 2, 3].map((index) => ({ start: index * 42, end: index * 42 + 40 }));

describe('dropIndex', () => {
  it.each([
    ['above the list', -50, 1, 0],
    ['over its own slot', 62, 1, 1],
    ['just past the next centre', 105, 1, 2],
    ['below the list', 400, 1, 3],
    ['past the first centre from the end', 25, 3, 1],
    ['before every centre', 5, 3, 0],
  ])('%s (centre %i, origin %i) -> %i', (_name, center, origin, expected) => {
    expect(dropIndex(SLOTS, origin, center)).toBe(expected);
  });

  it('returns 0 for a single entry', () => {
    expect(dropIndex([{ start: 0, end: 40 }], 0, 500)).toBe(0);
  });
});

describe('heldLayout', () => {
  it('moves nothing and draws no line over the own position', () => {
    const layout = heldLayout(SLOTS, 1, 1);
    expect(layout.shifts).toEqual([0, 0, 0, 0]);
    expect(layout.line).toBeNull();
  });

  it('makes room when held further back: the entries in between move up', () => {
    const { shifts, line } = heldLayout(SLOTS, 0, 2);
    expect(shifts).toEqual([84, -42, -42, 0]);
    expect(line).toBe(125);
  });

  it('makes room when held further forward: the entries in between move down', () => {
    const { shifts, line } = heldLayout(SLOTS, 3, 1);
    expect(shifts).toEqual([0, 42, 42, -84]);
    expect(line).toBe(41);
  });

  it('keeps unequal sizes and the gap', () => {
    const slots: Slot[] = [
      { start: 0, end: 40 },
      { start: 42, end: 102 },
      { start: 104, end: 144 },
    ];
    const { shifts } = heldLayout(slots, 1, 0);
    expect(shifts).toEqual([62, -42, 0]);
  });

  it('handles a single entry and an empty list', () => {
    expect(heldLayout([{ start: 0, end: 40 }], 0, 0)).toEqual({ shifts: [0], line: null });
    expect(heldLayout([], 0, 0)).toEqual({ shifts: [], line: null });
  });
});

describe('edgeScrollSpeed', () => {
  it('is zero in the middle of the view', () => {
    expect(edgeScrollSpeed(150, 0, 300, 40, 12)).toBe(0);
  });

  it('grows towards the start edge, negative', () => {
    expect(edgeScrollSpeed(20, 0, 300, 40, 12)).toBe(-6);
    expect(edgeScrollSpeed(-30, 0, 300, 40, 12)).toBe(-12);
  });

  it('grows towards the end edge, positive', () => {
    expect(edgeScrollSpeed(280, 0, 300, 40, 12)).toBe(6);
    expect(edgeScrollSpeed(400, 0, 300, 40, 12)).toBe(12);
  });

  it('shrinks the zone in a very small view and ignores an empty one', () => {
    expect(edgeScrollSpeed(10, 0, 30, 40, 12)).toBe(0);
    expect(edgeScrollSpeed(0, 0, 30, 40, 12)).toBe(-12);
    expect(edgeScrollSpeed(5, 100, 100, 40, 12)).toBe(0);
  });
});
