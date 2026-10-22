import { ITEM_BOUNDS, type CanvasRect, type CropDto } from '@flowstudio/scene-model';
import {
  MIN_DRAG_HEIGHT,
  MIN_DRAG_WIDTH,
  NO_GUIDES,
  boxLabel,
  cropRect,
  cropSummary,
  hasCrop,
  isArrowKey,
  isCorner,
  moveRect,
  nudgeRect,
  passedDragThreshold,
  resizeRect,
  snapLines,
  snapThreshold,
  snapValue,
  toCanvasPoint,
  toPercent,
} from './edit-geometry';

const NO_CROP: CropDto = { top: 0, right: 0, bottom: 0, left: 0 };
const ITEM: CanvasRect = { x: 400, y: 300, w: 600, h: 338 };
const CANVAS_ONLY = snapLines([]);

/** Uncropped picture box of an item (the renderer's crop maths). */
function pictureBox(rect: CanvasRect, crop: CropDto): CanvasRect {
  const w = rect.w / (1 - crop.left - crop.right);
  const h = rect.h / (1 - crop.top - crop.bottom);
  return { x: rect.x - crop.left * w, y: rect.y - crop.top * h, w, h };
}

describe('edit geometry', () => {
  describe('snap lines', () => {
    it('contains the canvas edges, the safe margin and the centre', () => {
      expect(CANVAS_ONLY.xs).toEqual([0, 40, 960, 1880, 1920]);
      expect(CANVAS_ONLY.ys).toEqual([0, 40, 540, 1040, 1080]);
    });

    it('adds edges and centres of the other elements', () => {
      const lines = snapLines([{ x: 100, y: 200, w: 300, h: 100 }]);
      expect(lines.xs).toEqual(expect.arrayContaining([100, 250, 400]));
      expect(lines.ys).toEqual(expect.arrayContaining([200, 250, 300]));
    });

    it('finds the nearest line within the threshold', () => {
      expect(snapValue(45, [0, 40, 50], 7)).toEqual({ line: 40, distance: 5 });
      expect(snapValue(47, [0, 40, 50], 7)).toEqual({ line: 50, distance: 3 });
      expect(snapValue(20, [0, 40], 7)).toBeNull();
      expect(snapValue(47, [40], 7)).toEqual({ line: 40, distance: 7 });
    });

    it('converts the 7 screen px threshold into canvas px', () => {
      expect(snapThreshold(0.5)).toBe(14);
      expect(snapThreshold(1)).toBe(7);
      expect(snapThreshold(0)).toBe(0);
      expect(snapThreshold(Number.NaN)).toBe(0);
    });
  });

  describe('move', () => {
    const options = { lines: CANVAS_ONLY, threshold: 14, snap: true };

    it('moves by the delta and rounds to whole pixels', () => {
      const result = moveRect(ITEM, 100.4, -50.6, options);
      expect(result.rect).toEqual({ x: 500, y: 249, w: 600, h: 338 });
      expect(result.guides).toEqual(NO_GUIDES);
    });

    it('snaps the left edge to the safe margin and shows the guide', () => {
      const result = moveRect(ITEM, -352, 0, options);
      expect(result.rect.x).toBe(40);
      expect(result.guides.x).toBe(40);
      expect(result.guides.y).toBeNull();
    });

    it('snaps the centre to the canvas centre', () => {
      // Centre at 400 + 300 + 255 = 955 → 960.
      const result = moveRect(ITEM, 255, 0, options);
      expect(result.rect.x).toBe(660);
      expect(result.guides.x).toBe(960);
    });

    it('snaps the right edge to the canvas edge and the bottom to the safe margin', () => {
      const result = moveRect(ITEM, 1920 - 1000 - 5, 1040 - 638 + 6, options);
      expect(result.rect.x + result.rect.w).toBe(1920);
      expect(result.rect.y + result.rect.h).toBe(1040);
      expect(result.guides).toEqual({ x: 1920, y: 1040 });
    });

    it('snaps to the edges of other elements', () => {
      const lines = snapLines([{ x: 1200, y: 0, w: 400, h: 200 }]);
      const result = moveRect(ITEM, 195, 0, { ...options, lines });
      // Right edge 400 + 600 + 195 = 1195 → 1200.
      expect(result.rect.x).toBe(600);
      expect(result.guides.x).toBe(1200);
    });

    it('does not snap with Alt', () => {
      const result = moveRect(ITEM, -352, 0, { ...options, snap: false });
      expect(result.rect.x).toBe(48);
      expect(result.guides).toEqual(NO_GUIDES);
    });
  });

  describe('resize from a corner', () => {
    const options = { lines: CANVAS_ONLY, threshold: 0, snap: false, keepRatio: true };

    it('keeps the aspect ratio and the opposite corner (se)', () => {
      const result = resizeRect(ITEM, 'se', 300, 0, options);
      expect(result.rect.x).toBe(400);
      expect(result.rect.y).toBe(300);
      expect(result.rect.w).toBe(900);
      expect(result.rect.h).toBe(Math.round(900 / (600 / 338)));
    });

    it('keeps the bottom-right corner when dragging the top-left corner (nw)', () => {
      const result = resizeRect(ITEM, 'nw', -300, -10, options);
      expect(result.rect.x + result.rect.w).toBe(1000);
      expect(result.rect.y + result.rect.h).toBe(638);
      expect(result.rect.w / result.rect.h).toBeCloseTo(600 / 338, 2);
    });

    it('lets the larger relative change win', () => {
      const result = resizeRect(ITEM, 'se', 10, 200, options);
      expect(result.rect.h).toBe(538);
      expect(result.rect.w).toBe(Math.round(538 * (600 / 338)));
    });

    it('frees the aspect ratio with Shift', () => {
      const result = resizeRect(ITEM, 'ne', 100, 50, { ...options, keepRatio: false });
      expect(result.rect).toEqual({ x: 400, y: 350, w: 700, h: 288 });
    });

    it('never drops below the prototype minimum of 96 × 54', () => {
      const free = resizeRect(ITEM, 'se', -2000, -2000, { ...options, keepRatio: false });
      expect(free.rect.w).toBe(MIN_DRAG_WIDTH);
      expect(free.rect.h).toBe(MIN_DRAG_HEIGHT);
      expect(free.rect.x).toBe(400);
      const locked = resizeRect(ITEM, 'sw', 2000, -2000, options);
      expect(locked.rect.w).toBeGreaterThanOrEqual(MIN_DRAG_WIDTH);
      expect(locked.rect.h).toBeGreaterThanOrEqual(MIN_DRAG_HEIGHT);
      expect(locked.rect.x + locked.rect.w).toBe(1000);
    });

    it('snaps the dragged corner and shows a guide only where the edge ends on the line', () => {
      const snapping = { ...options, snap: true, threshold: 14 };
      const free = resizeRect(ITEM, 'se', 875, 0, { ...snapping, keepRatio: false });
      expect(free.rect.x + free.rect.w).toBe(1880);
      expect(free.guides.x).toBe(1880);
      // With the ratio kept the height wins here, so the right edge leaves the line and no guide remains.
      const ratio = resizeRect(ITEM, 'se', 557, 400, snapping);
      expect(ratio.guides.y).toBe(1040);
      expect(ratio.rect.y + ratio.rect.h).toBe(1040);
      expect(ratio.guides.x).toBeNull();
    });
  });

  describe('crop', () => {
    it('crops the right side: the edge follows the pointer and the picture stays in place', () => {
      const result = cropRect(ITEM, NO_CROP, 'e', -60, 0);
      expect(result.rect).toEqual({ x: 400, y: 300, w: 540, h: 338 });
      expect(result.crop.right).toBeCloseTo(0.1, 6);
      expect(result.crop.left).toBe(0);
      const box = pictureBox(result.rect, result.crop);
      expect(box.x).toBeCloseTo(400, 6);
      expect(box.w).toBeCloseTo(600, 6);
    });

    it('crops the left side and moves the box edge with it', () => {
      const result = cropRect(ITEM, NO_CROP, 'w', 120, 0);
      expect(result.rect).toEqual({ x: 520, y: 300, w: 480, h: 338 });
      expect(result.crop.left).toBeCloseTo(0.2, 6);
      const box = pictureBox(result.rect, result.crop);
      expect(box.x).toBeCloseTo(400, 6);
      expect(box.w).toBeCloseTo(600, 6);
    });

    it('crops two sides from a corner', () => {
      const result = cropRect(ITEM, NO_CROP, 'nw', 60, 34);
      expect(result.rect).toEqual({ x: 460, y: 334, w: 540, h: 304 });
      expect(result.crop.left).toBeCloseTo(0.1, 6);
      expect(result.crop.top).toBeCloseTo(34 / 338, 6);
      expect(result.crop.right).toBe(0);
      expect(result.crop.bottom).toBe(0);
    });

    it('crops top and bottom edges', () => {
      const top = cropRect(ITEM, NO_CROP, 'n', 0, 50);
      expect(top.rect).toEqual({ x: 400, y: 350, w: 600, h: 288 });
      const bottom = cropRect(ITEM, NO_CROP, 's', 0, -50);
      expect(bottom.rect).toEqual({ x: 400, y: 300, w: 600, h: 288 });
      expect(bottom.crop.bottom).toBeCloseTo(50 / 338, 6);
    });

    it('keeps the picture when an already cropped item is cropped further', () => {
      const crop: CropDto = { top: 0, right: 0.1, bottom: 0, left: 0.2 };
      const rect = { x: 520, y: 300, w: 420, h: 338 };
      const before = pictureBox(rect, crop);
      const result = cropRect(rect, crop, 'e', -60, 0);
      const after = pictureBox(result.rect, result.crop);
      expect(after.x).toBeCloseTo(before.x, 6);
      expect(after.w).toBeCloseTo(before.w, 6);
      expect(result.crop.left).toBeCloseTo(0.2, 6);
      expect(result.crop.right).toBeCloseTo(0.2, 6);
    });

    it('stops at the picture edge when dragged outwards (no negative crop)', () => {
      const crop: CropDto = { top: 0, right: 0.1, bottom: 0, left: 0 };
      const rect = { x: 400, y: 300, w: 540, h: 338 };
      const result = cropRect(rect, crop, 'e', 500, 0);
      expect(result.rect.w).toBe(600);
      expect(result.crop.right).toBe(0);
      const left = cropRect(ITEM, NO_CROP, 'w', -300, 0);
      expect(left.rect).toEqual(ITEM);
      expect(left.crop).toEqual(NO_CROP);
    });

    it('clamps each side to 0.45 and opposite sides below 0.9', () => {
      const single = cropRect(ITEM, NO_CROP, 'e', -2000, 0);
      expect(single.crop.right).toBeLessThanOrEqual(ITEM_BOUNDS.maxCropPerSide);
      expect(single.crop.right).toBeGreaterThan(0.44);
      const crop: CropDto = { top: 0, right: 0, bottom: 0, left: 0.45 };
      const rect = { x: 670, y: 300, w: 330, h: 338 };
      const both = cropRect(rect, crop, 'e', -2000, 0);
      expect(both.crop.left + both.crop.right).toBeLessThan(ITEM_BOUNDS.maxCropPerAxis);
      expect(both.rect.w).toBeGreaterThanOrEqual(ITEM_BOUNDS.minW);
      expect(pictureBox(both.rect, both.crop).w).toBeCloseTo(600, 0);
    });

    it('treats malformed crop values as no crop', () => {
      const result = cropRect(ITEM, { top: Number.NaN, right: 0, bottom: 0, left: 0 }, 's', 0, -10);
      expect(result.crop.top).toBe(0);
      expect(result.rect.h).toBe(328);
    });

    it('never shows guides while cropping', () => {
      expect(cropRect(ITEM, NO_CROP, 'se', -20, -20).guides).toEqual(NO_GUIDES);
    });
  });

  describe('keyboard nudge', () => {
    it('moves 1 px, with Shift 10 px', () => {
      expect(nudgeRect(ITEM, 'ArrowLeft', false)).toEqual({ ...ITEM, x: 399 });
      expect(nudgeRect(ITEM, 'ArrowRight', true)).toEqual({ ...ITEM, x: 410 });
      expect(nudgeRect(ITEM, 'ArrowUp', true)).toEqual({ ...ITEM, y: 290 });
      expect(nudgeRect(ITEM, 'ArrowDown', false)).toEqual({ ...ITEM, y: 301 });
    });

    it('ignores other keys', () => {
      expect(nudgeRect(ITEM, 'a', false)).toBeNull();
      expect(isArrowKey('ArrowUp')).toBe(true);
      expect(isArrowKey('Enter')).toBe(false);
    });
  });

  describe('labels and conversions', () => {
    it('labels the selection like the prototype, with the crop when there is one', () => {
      expect(boxLabel('K1', ITEM)).toBe('K1 · 600 × 338');
      expect(boxLabel('K1', { ...ITEM, w: 540.4 }, { ...NO_CROP, right: 0.1 })).toBe(
        'K1 · 540 × 338 · Zuschnitt R 10 %',
      );
      expect(cropSummary({ top: 0.05, right: 0, bottom: 0.002, left: 0.25 })).toBe(
        'L 25 % O 5 % U 1 %',
      );
      expect(cropSummary(null)).toBe('');
      expect(hasCrop(NO_CROP)).toBe(false);
      expect(hasCrop({ ...NO_CROP, top: 0.1 })).toBe(true);
    });

    it('converts canvas rectangles to percentages', () => {
      expect(toPercent({ x: 960, y: 540, w: 480, h: 270 })).toEqual({
        left: 50,
        top: 50,
        width: 25,
        height: 25,
      });
    });

    it('converts client coordinates to canvas pixels', () => {
      const point = toCanvasPoint(150, 120, { left: 100, top: 70, width: 960, height: 540 });
      expect(point).toEqual({ x: 100, y: 100, scale: 0.5 });
      expect(toCanvasPoint(0, 0, { left: 0, top: 0, width: 0, height: 0 }).scale).toBeGreaterThan(
        0,
      );
    });

    it('starts a drag after 2 screen px', () => {
      expect(passedDragThreshold(2, 0, 0.5)).toBe(false);
      expect(passedDragThreshold(4, 0, 0.5)).toBe(true);
      expect(passedDragThreshold(3, 3, 0.5)).toBe(true);
    });

    it('tells corners from edges', () => {
      expect(isCorner('nw')).toBe(true);
      expect(isCorner('e')).toBe(false);
    });
  });
});
