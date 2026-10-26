import { DEFAULT_CANVAS as CANVAS, autoGridSlots } from '@studioflow/scene-model';

import { autoGridRects } from './auto-grid';

function candidates(
  count: number,
  unavailable: readonly number[] = [],
): { id: string; available: boolean }[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `itm_${index}`,
    available: !unavailable.includes(index),
  }));
}

describe('autoGridRects', () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9])(
    'places %i available sources on autoGridSlots(n) in order',
    (count) => {
      const rects = autoGridRects(candidates(count), CANVAS);
      const slots = autoGridSlots(count, CANVAS);
      expect(rects.size).toBe(count);
      [...rects.values()].forEach((rect, index) => {
        const [x, y, w, h] = slots[index];
        expect(rect).toEqual({ x, y, w, h });
      });
      expect([...rects.keys()]).toEqual(candidates(count).map((candidate) => candidate.id));
    },
  );

  it('places the first nine of ten sources; the tenth has no slot', () => {
    const rects = autoGridRects(candidates(10), CANVAS);
    expect(rects.size).toBe(9);
    expect(rects.has('itm_9')).toBe(false);
  });

  it('skips unavailable sources and gives their slot to the next one', () => {
    const rects = autoGridRects(candidates(3, [0]), CANVAS);
    expect(rects.has('itm_0')).toBe(false);
    const [first, second] = autoGridSlots(2, CANVAS);
    expect(rects.get('itm_1')).toEqual({ x: first[0], y: first[1], w: first[2], h: first[3] });
    expect(rects.get('itm_2')).toEqual({ x: second[0], y: second[1], w: second[2], h: second[3] });
  });

  it('places nothing without available sources', () => {
    expect(autoGridRects([], CANVAS).size).toBe(0);
    expect(autoGridRects(candidates(3, [0, 1, 2]), CANVAS).size).toBe(0);
  });
});
