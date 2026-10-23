/**
 * Pure geometry of the edit overlay (prototype "Overlay: edit items", spec 9.1): snapping, moving, resizing
 * from a corner (aspect ratio kept unless Shift), cropping from a corner or an edge (Alt, like OBS), keyboard nudges
 * and the label text of the selection box. Everything works in canvas pixels (1920 × 1080); thresholds that are
 * defined in screen pixels are converted with the monitor scale by the caller.
 *
 * No Angular, no DOM: the overlay component feeds pointer deltas in and writes the results to the EditorService.
 */
import { t } from '@studioflow/i18n';
import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  ITEM_BOUNDS,
  SAFE_MARGIN,
  formatPercent,
  type CanvasRect,
  type CropDto,
} from '@studioflow/scene-model';

/** Snap distance in screen pixels (prototype: 7 px, divided by the monitor scale). */
export const SNAP_THRESHOLD_SCREEN_PX = 7;
/** Pointer travel in screen pixels before a press becomes a drag (prototype: 2 px). */
export const DRAG_START_SCREEN_PX = 2;
/** Smallest size a corner drag produces (prototype minimum, GAP-11); typed values may go down to the server bounds. */
export const MIN_DRAG_WIDTH = 96;
/** Smallest height a corner drag produces (prototype minimum, GAP-11). */
export const MIN_DRAG_HEIGHT = 54;
/** Arrow key step (prototype: 1 px). */
export const NUDGE_STEP = 1;
/** Arrow key step with Shift (prototype: 10 px). */
export const NUDGE_STEP_LARGE = 10;
/** Pitch of the dot raster shown while dragging, in canvas pixels (prototype `--grid`: 40 canvas px). */
export const RASTER_PITCH = 40;

/**
 * Largest sum of two opposite crop sides a crop drag produces: the server demands strictly less than 0.9, the margin
 * keeps rounding errors on the safe side.
 */
const MAX_CROP_AXIS = ITEM_BOUNDS.maxCropPerAxis - 0.001;
/** Crop fractions below this are treated as no crop (rounding residue when an edge returns to the picture edge). */
const CROP_EPSILON = 0.0005;

/** A corner handle of the selection box. */
export type Corner = 'nw' | 'ne' | 'sw' | 'se';
/** An edge of the selection box (hit strips along the outline; only Alt+drag uses them, for cropping). */
export type Edge = 'n' | 'e' | 's' | 'w';
/** A corner or an edge. */
export type Handle = Corner | Edge;

/** Every corner, in the order the handles are rendered. */
export const CORNERS: readonly Corner[] = ['nw', 'ne', 'sw', 'se'];
/** Every edge, in the order the hit strips are rendered. */
export const EDGES: readonly Edge[] = ['n', 'e', 's', 'w'];

/** Vertical (`xs`) and horizontal (`ys`) lines an element snaps to, in canvas pixels. */
export interface SnapLines {
  readonly xs: readonly number[];
  readonly ys: readonly number[];
}

/** The blue guide lines to show (canvas pixels), null when that axis did not snap. */
export interface Guides {
  readonly x: number | null;
  readonly y: number | null;
}

/** Result of a move or resize step. */
export interface GeometryResult {
  readonly rect: CanvasRect;
  readonly guides: Guides;
}

/** Result of a crop step: the visible box and the crop fractions that keep the picture in place. */
export interface CropResult extends GeometryResult {
  readonly crop: CropDto;
}

/** A snap hit: the line and the distance to it. */
export interface SnapHit {
  readonly line: number;
  readonly distance: number;
}

/** No guide lines. */
export const NO_GUIDES: Guides = { x: null, y: null };

/** True for the four corner handles. */
export function isCorner(handle: Handle): handle is Corner {
  return handle.length === 2;
}

/**
 * Lines every element snaps to (prototype `snapLines`): the canvas edges, the safe margin (40 px) and the centre,
 * plus the edges and centres of the other visible elements.
 */
export function snapLines(others: readonly CanvasRect[]): SnapLines {
  const xs: number[] = [0, SAFE_MARGIN, CANVAS_WIDTH / 2, CANVAS_WIDTH - SAFE_MARGIN, CANVAS_WIDTH];
  const ys: number[] = [
    0,
    SAFE_MARGIN,
    CANVAS_HEIGHT / 2,
    CANVAS_HEIGHT - SAFE_MARGIN,
    CANVAS_HEIGHT,
  ];
  for (const rect of others) {
    xs.push(rect.x, rect.x + rect.w / 2, rect.x + rect.w);
    ys.push(rect.y, rect.y + rect.h / 2, rect.y + rect.h);
  }
  return { xs, ys };
}

/** The nearest line within `threshold` of `value` (prototype `snap1`), or null. Ties keep the first line. */
export function snapValue(
  value: number,
  lines: readonly number[],
  threshold: number,
): SnapHit | null {
  let best: SnapHit | null = null;
  for (const line of lines) {
    const distance = Math.abs(value - line);
    if (distance <= threshold && (!best || distance < best.distance)) {
      best = { line, distance };
    }
  }
  return best;
}

/** Snap threshold in canvas pixels for a monitor scale (screen px per canvas px). */
export function snapThreshold(scale: number): number {
  return scale > 0 && Number.isFinite(scale) ? SNAP_THRESHOLD_SCREEN_PX / scale : 0;
}

/**
 * Best snap of a span (start, centre, end) against the lines: returns the corrected start and the line, or null.
 * Prototype: the element's left edge, centre or right edge, whichever is closest to a line.
 */
function snapSpan(
  start: number,
  size: number,
  lines: readonly number[],
  threshold: number,
): { readonly start: number; readonly line: number } | null {
  let best: { start: number; line: number; distance: number } | null = null;
  for (const offset of [0, size / 2, size]) {
    const hit = snapValue(start + offset, lines, threshold);
    if (hit && (!best || hit.distance < best.distance)) {
      best = { start: hit.line - offset, line: hit.line, distance: hit.distance };
    }
  }
  return best && { start: best.start, line: best.line };
}

/** Options of a move or resize step. */
export interface SnapOptions {
  readonly lines: SnapLines;
  /** Snap distance in canvas pixels (see {@link snapThreshold}). */
  readonly threshold: number;
  /** False while Alt is held during a move (prototype). */
  readonly snap: boolean;
}

/**
 * Moves a rectangle by a pointer delta (canvas px). With snapping, the left edge, centre or right edge (and top,
 * middle, bottom) jumps to the nearest line within the threshold and that line becomes a guide. The size never
 * changes; the position is rounded to whole pixels.
 */
export function moveRect(
  origin: CanvasRect,
  dx: number,
  dy: number,
  options: SnapOptions,
): GeometryResult {
  let x = origin.x + dx;
  let y = origin.y + dy;
  let guideX: number | null = null;
  let guideY: number | null = null;
  if (options.snap) {
    const sx = snapSpan(x, origin.w, options.lines.xs, options.threshold);
    const sy = snapSpan(y, origin.h, options.lines.ys, options.threshold);
    if (sx) {
      x = sx.start;
      guideX = sx.line;
    }
    if (sy) {
      y = sy.start;
      guideY = sy.line;
    }
  }
  return {
    rect: { x: Math.round(x), y: Math.round(y), w: origin.w, h: origin.h },
    guides: { x: guideX, y: guideY },
  };
}

/** Options of a corner resize. */
export interface ResizeOptions extends SnapOptions {
  /** Keep the aspect ratio of the origin (Shift frees it). */
  readonly keepRatio: boolean;
}

/**
 * Resizes a rectangle from a corner (prototype): the opposite corner stays fixed, the dragged corner follows the
 * pointer and snaps to lines, the size never drops below {@link MIN_DRAG_WIDTH} × {@link MIN_DRAG_HEIGHT}, and
 * without Shift the aspect ratio of the origin is kept (the larger relative change wins). Dragging past the fixed
 * corner keeps the minimum size instead of flipping. A guide is shown only for an axis whose edge really ends on the
 * line after the ratio correction.
 */
export function resizeRect(
  origin: CanvasRect,
  corner: Corner,
  dx: number,
  dy: number,
  options: ResizeOptions,
): GeometryResult {
  const right = corner.includes('e');
  const bottom = corner.includes('s');
  let cornerX = (right ? origin.x + origin.w : origin.x) + dx;
  let cornerY = (bottom ? origin.y + origin.h : origin.y) + dy;
  let guideX: number | null = null;
  let guideY: number | null = null;
  if (options.snap) {
    const sx = snapValue(cornerX, options.lines.xs, options.threshold);
    const sy = snapValue(cornerY, options.lines.ys, options.threshold);
    if (sx) {
      cornerX = sx.line;
      guideX = sx.line;
    }
    if (sy) {
      cornerY = sy.line;
      guideY = sy.line;
    }
  }
  const anchorX = right ? origin.x : origin.x + origin.w;
  const anchorY = bottom ? origin.y : origin.y + origin.h;
  let w = Math.max(MIN_DRAG_WIDTH, right ? cornerX - anchorX : anchorX - cornerX);
  let h = Math.max(MIN_DRAG_HEIGHT, bottom ? cornerY - anchorY : anchorY - cornerY);
  const ratio = origin.h > 0 ? origin.w / origin.h : 0;
  if (options.keepRatio && ratio > 0 && Number.isFinite(ratio)) {
    if (w / h > ratio) {
      h = w / ratio;
    } else {
      w = h * ratio;
    }
  }
  w = Math.round(w);
  h = Math.round(h);
  const x = Math.round(right ? anchorX : anchorX - w);
  const y = Math.round(bottom ? anchorY : anchorY - h);
  const movingX = right ? x + w : x;
  const movingY = bottom ? y + h : y;
  return {
    rect: { x, y, w, h },
    guides: {
      x: guideX !== null && Math.abs(movingX - guideX) <= 0.5 ? guideX : null,
      y: guideY !== null && Math.abs(movingY - guideY) <= 0.5 ? guideY : null,
    },
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Integer position in [min, max] (both rounded inwards); when the range is empty, `fallback`. */
function clampToPixels(value: number, min: number, max: number, fallback: number): number {
  const low = Math.ceil(min - 1e-9);
  const high = Math.floor(max + 1e-9);
  if (low > high) {
    return fallback;
  }
  return clamp(Math.round(value), low, high);
}

function cleanCrop(value: number): number {
  return value < CROP_EPSILON ? 0 : value;
}

/**
 * Crops an element from a corner or an edge (Alt+drag, like OBS): the dragged edge follows the pointer while the
 * picture stays where it is, so the visible part shrinks or grows instead of being scaled. The crop fractions use the
 * renderer's maths (fraction of the uncropped picture box: `box = item / (1 − left − right)`), so the picture keeps
 * its size and position exactly. Bounds: each side within [0, 0.45], opposite sides below 0.9, the visible part at
 * least the server minimum (16 px); dragging outwards stops at the picture edge (no negative crop).
 */
export function cropRect(
  origin: CanvasRect,
  crop: CropDto,
  handle: Handle,
  dx: number,
  dy: number,
): CropResult {
  const safe = {
    top: clamp(Number.isFinite(crop.top) ? crop.top : 0, 0, ITEM_BOUNDS.maxCropPerSide),
    right: clamp(Number.isFinite(crop.right) ? crop.right : 0, 0, ITEM_BOUNDS.maxCropPerSide),
    bottom: clamp(Number.isFinite(crop.bottom) ? crop.bottom : 0, 0, ITEM_BOUNDS.maxCropPerSide),
    left: clamp(Number.isFinite(crop.left) ? crop.left : 0, 0, ITEM_BOUNDS.maxCropPerSide),
  };
  // The uncropped picture box: it stays fixed while the edges move.
  const fullW = origin.w / Math.max(0.01, 1 - safe.left - safe.right);
  const fullH = origin.h / Math.max(0.01, 1 - safe.top - safe.bottom);
  const fullX = origin.x - safe.left * fullW;
  const fullY = origin.y - safe.top * fullH;
  let { x, y, w, h } = origin;
  let { top, right, bottom, left } = safe;

  if (handle.includes('e')) {
    const maxSide = Math.min(ITEM_BOUNDS.maxCropPerSide, MAX_CROP_AXIS - left);
    const minEdge = Math.max(x + ITEM_BOUNDS.minW, fullX + fullW * (1 - maxSide));
    const edge = clampToPixels(origin.x + origin.w + dx, minEdge, fullX + fullW, x + w);
    w = edge - x;
    right = cleanCrop(clamp(1 - left - w / fullW, 0, ITEM_BOUNDS.maxCropPerSide));
  } else if (handle.includes('w')) {
    const maxSide = Math.min(ITEM_BOUNDS.maxCropPerSide, MAX_CROP_AXIS - right);
    const end = origin.x + origin.w;
    const maxEdge = Math.min(end - ITEM_BOUNDS.minW, fullX + fullW * maxSide);
    const edge = clampToPixels(origin.x + dx, fullX, maxEdge, x);
    x = edge;
    w = end - edge;
    left = cleanCrop(clamp((edge - fullX) / fullW, 0, ITEM_BOUNDS.maxCropPerSide));
  }

  if (handle.includes('s')) {
    const maxSide = Math.min(ITEM_BOUNDS.maxCropPerSide, MAX_CROP_AXIS - top);
    const minEdge = Math.max(y + ITEM_BOUNDS.minH, fullY + fullH * (1 - maxSide));
    const edge = clampToPixels(origin.y + origin.h + dy, minEdge, fullY + fullH, y + h);
    h = edge - y;
    bottom = cleanCrop(clamp(1 - top - h / fullH, 0, ITEM_BOUNDS.maxCropPerSide));
  } else if (handle.includes('n')) {
    const maxSide = Math.min(ITEM_BOUNDS.maxCropPerSide, MAX_CROP_AXIS - bottom);
    const end = origin.y + origin.h;
    const maxEdge = Math.min(end - ITEM_BOUNDS.minH, fullY + fullH * maxSide);
    const edge = clampToPixels(origin.y + dy, fullY, maxEdge, y);
    y = edge;
    h = end - edge;
    top = cleanCrop(clamp((edge - fullY) / fullH, 0, ITEM_BOUNDS.maxCropPerSide));
  }

  return { rect: { x, y, w, h }, crop: { top, right, bottom, left }, guides: NO_GUIDES };
}

/** Moves a rectangle with an arrow key: 1 px, with Shift 10 px. Returns null for other keys. */
export function nudgeRect(rect: CanvasRect, key: string, large: boolean): CanvasRect | null {
  const step = large ? NUDGE_STEP_LARGE : NUDGE_STEP;
  const delta: Readonly<Record<string, readonly [number, number]>> = {
    ArrowLeft: [-step, 0],
    ArrowRight: [step, 0],
    ArrowUp: [0, -step],
    ArrowDown: [0, step],
  };
  const move = delta[key];
  return move ? { ...rect, x: rect.x + move[0], y: rect.y + move[1] } : null;
}

/** True for the four arrow keys. */
export function isArrowKey(key: string): boolean {
  return key === 'ArrowLeft' || key === 'ArrowRight' || key === 'ArrowUp' || key === 'ArrowDown';
}

/** True when any side is cropped. */
export function hasCrop(crop: CropDto | null | undefined): boolean {
  return !!crop && (crop.top > 0 || crop.right > 0 || crop.bottom > 0 || crop.left > 0);
}

/**
 * Short crop text for the selection label: "L 10% R 5%" (left, right, top, bottom; whole percent of the picture);
 * empty without crop.
 */
export function cropSummary(crop: CropDto | null | undefined): string {
  if (!crop) {
    return '';
  }
  const sides: readonly [string, number][] = [
    [t('regie.stage.crop.left'), crop.left],
    [t('regie.stage.crop.right'), crop.right],
    [t('regie.stage.crop.top'), crop.top],
    [t('regie.stage.crop.bottom'), crop.bottom],
  ];
  return sides
    .filter(([, value]) => value > 0)
    .map(([letter, value]) => `${letter} ${formatPercent(Math.max(1, Math.round(value * 100)))}`)
    .join(' ');
}

/**
 * Text of the selection label (prototype "K1 · 600 × 338"), with the crop when there is one:
 * "K1 · 540 × 338 · Crop R 10%".
 */
export function boxLabel(code: string, rect: CanvasRect, crop?: CropDto | null): string {
  const size = `${code} · ${Math.round(rect.w)} × ${Math.round(rect.h)}`;
  const cropped = cropSummary(crop);
  return cropped ? `${size} · ${t('regie.stage.crop.summary', { sides: cropped })}` : size;
}

/** A rectangle as percentages of the canvas (for absolutely positioned overlay boxes). */
export interface PercentRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** Converts canvas pixels to percentages of the canvas. */
export function toPercent(rect: CanvasRect): PercentRect {
  return {
    left: (rect.x / CANVAS_WIDTH) * 100,
    top: (rect.y / CANVAS_HEIGHT) * 100,
    width: (rect.w / CANVAS_WIDTH) * 100,
    height: (rect.h / CANVAS_HEIGHT) * 100,
  };
}

/** A pointer position in canvas pixels plus the monitor scale (screen px per canvas px). */
export interface CanvasPointer {
  readonly x: number;
  readonly y: number;
  readonly scale: number;
}

/** The part of a DOMRect the conversion needs. */
export interface ScreenBox {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** Converts client coordinates to canvas pixels for an overlay at `box` (prototype `toCanvas`). */
export function toCanvasPoint(clientX: number, clientY: number, box: ScreenBox): CanvasPointer {
  const width = box.width > 0 ? box.width : 1;
  const height = box.height > 0 ? box.height : 1;
  return {
    x: ((clientX - box.left) / width) * CANVAS_WIDTH,
    y: ((clientY - box.top) / height) * CANVAS_HEIGHT,
    scale: width / CANVAS_WIDTH,
  };
}

/** True once the pointer travelled far enough (screen px) for a press to become a drag. */
export function passedDragThreshold(dx: number, dy: number, scale: number): boolean {
  return Math.hypot(dx * scale, dy * scale) >= DRAG_START_SCREEN_PX;
}
