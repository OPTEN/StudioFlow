import { SAFE_MARGIN } from './constants';
import type { CanvasDto, CanvasFormat, CanvasResolution, ProductionDto } from './contracts';
import type { CanvasRect } from './geometry';

/** Size of an output canvas in pixels: the coordinate system of all scene items. */
export interface CanvasSize {
  readonly width: number;
  readonly height: number;
}

/** The formats a production can have, in the order the Regie offers them. */
export const CANVAS_FORMATS: readonly CanvasFormat[] = [
  'widescreen',
  'portrait',
  'square',
  'standard',
];

/** The target resolutions, named after the short side, in the order the Regie offers them. */
export const CANVAS_RESOLUTIONS: readonly CanvasResolution[] = ['p720', 'p1080'];

/** Format of a new production. */
export const DEFAULT_CANVAS_FORMAT: CanvasFormat = 'widescreen';
/** Resolution of a new production. */
export const DEFAULT_CANVAS_RESOLUTION: CanvasResolution = 'p1080';

/** 1920 × 1080, the canvas of a new production and the reference of the layouts and the default geometry. */
export const DEFAULT_CANVAS: CanvasSize = { width: 1920, height: 1080 };

/** Aspect ratio of a format as width : height. */
const RATIOS: Readonly<Record<CanvasFormat, readonly [width: number, height: number]>> = {
  widescreen: [16, 9],
  portrait: [9, 16],
  square: [1, 1],
  standard: [4, 3],
};

/** Pixels of the short side per resolution. */
const SHORT_SIDES: Readonly<Record<CanvasResolution, number>> = { p720: 720, p1080: 1080 };

/**
 * Canvas size of a format and resolution: the short side is 720 or 1080 and the long side follows the ratio
 * (16:9 → 1280 × 720 / 1920 × 1080, 9:16 → 720 × 1280 / 1080 × 1920, 1:1 → 720 × 720 / 1080 × 1080, 4:3 → 960 × 720 /
 * 1440 × 1080). Mirrors `Canvases.SizeOf` of the API; every size is an integer.
 */
export function canvasSize(format: CanvasFormat, resolution: CanvasResolution): CanvasSize {
  const short = SHORT_SIDES[resolution];
  const [ratioWidth, ratioHeight] = RATIOS[format];
  return ratioWidth >= ratioHeight
    ? { width: (short * ratioWidth) / ratioHeight, height: short }
    : { width: short, height: (short * ratioHeight) / ratioWidth };
}

/** The wire form of a canvas, as the API sends it with a production. */
export function canvasDto(format: CanvasFormat, resolution: CanvasResolution): CanvasDto {
  return { format, resolution, ...canvasSize(format, resolution) };
}

/** The canvas of a production. */
export function canvasOf(production: Pick<ProductionDto, 'canvas'> | null | undefined): CanvasSize {
  return production
    ? { width: production.canvas.width, height: production.canvas.height }
    : DEFAULT_CANVAS;
}

/** Width divided by height. */
export function canvasAspect(canvas: CanvasSize): number {
  return canvas.width / canvas.height;
}

/** True when the canvas is at least as wide as 4:3 (16:9 and 4:3); square and portrait canvases stack their pictures. */
export function isLandscape(canvas: CanvasSize): boolean {
  return canvas.width >= canvas.height * 1.2;
}

/** The ratio of a format as text, "16:9". Not translated. */
export function formatRatioLabel(format: CanvasFormat): string {
  const [width, height] = RATIOS[format];
  return `${width}:${height}`;
}

/** The resolution as text, "1080p" (the short side). Not translated. */
export function resolutionLabel(resolution: CanvasResolution): string {
  return `${SHORT_SIDES[resolution]}p`;
}

/** The size as text, "1920 × 1080". Not translated. */
export function canvasSizeLabel(canvas: CanvasSize): string {
  return `${canvas.width} × ${canvas.height}`;
}

/** Size of the canvas relative to the 1080 pixels of the short side, which is where the fixed pixel values are set. */
function shortSideFactor(canvas: CanvasSize): number {
  return Math.min(canvas.width, canvas.height) / DEFAULT_CANVAS.height;
}

/** Margin to the edge used by snap lines and layouts: 40 px at 1080p, in proportion on other canvases. */
export function safeMargin(canvas: CanvasSize): number {
  return Math.round(SAFE_MARGIN * shortSideFactor(canvas));
}

/** One axis of {@link placeOnCanvas}: the start of a span of `length` on a reference axis, moved onto the canvas axis. */
function placeSpan(
  start: number,
  length: number,
  reference: number,
  canvasLength: number,
  size: number,
): number {
  const before = start;
  const after = reference - start - length;
  const middle = Math.abs(start + length / 2 - reference / 2);
  const scaled = length * size;
  if (middle <= Math.min(before, after)) {
    return canvasLength / 2 + (start + length / 2 - reference / 2) * size - scaled / 2;
  }
  return after < before ? canvasLength - after * size - scaled : before * size;
}

/**
 * Places a rectangle of the 1920 × 1080 reference layout on a canvas (defaults of new items). The size scales with the
 * smaller of the two axis factors, so the rectangle keeps its shape (a text keeps its proportions, a picture its 16:9).
 * On each axis the rectangle stays at the edge it is nearest to, with its distance scaled, or in the middle when that
 * is nearest, so a note in the top right corner stays in that corner and a title stays centred on every canvas.
 * Mirrors `Canvases.Place` of the API.
 */
export function placeOnCanvas(canvas: CanvasSize, rect: CanvasRect): CanvasRect {
  const size = Math.min(canvas.width / DEFAULT_CANVAS.width, canvas.height / DEFAULT_CANVAS.height);
  return {
    x: Math.round(placeSpan(rect.x, rect.w, DEFAULT_CANVAS.width, canvas.width, size)),
    y: Math.round(placeSpan(rect.y, rect.h, DEFAULT_CANVAS.height, canvas.height, size)),
    w: Math.round(rect.w * size),
    h: Math.round(rect.h * size),
  };
}
