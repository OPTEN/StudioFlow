import { ITEM_BOUNDS, isHexColor, snapRotation, type Rotation } from '@flowstudio/scene-model';
import type { BorderDto, CropDto, ItemFit, SceneItemDto } from '@flowstudio/scene-model';

import type { CanvasRect, DesiredSize } from './types';

/**
 * Pure geometry of one item: sanitising wire values (the renderer must never produce NaN styles or divide by zero for
 * a malformed item) and the box math for crop, rotation, blur and desired picture sizes.
 *
 * Rotation snapping and the colour check are the scene-model ones (`snapRotation`, `isHexColor`). The clamping here
 * deliberately differs from scene-model's `clampItem`, which prepares editor input for the server: the renderer
 * sanitises whatever arrives over the wire without rounding, falls back to 0 instead of the new-item defaults and
 * tolerates a missing crop or an invalid border.
 */

/** A box relative to its parent, in canvas pixels. */
export interface Box {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** Crop fractions after sanitising: every side within [0, 0.45], so opposite sides keep at least 10 %. */
export type Crop = Readonly<Pick<CropDto, 'top' | 'right' | 'bottom' | 'left'>>;

/** A border that is safe to render. */
export type Border = Readonly<Pick<BorderDto, 'width' | 'color'>>;

/** Everything about an item's picture that does not depend on its source. */
export interface ItemLook {
  readonly fit: ItemFit;
  readonly crop: Crop;
  readonly radius: number;
  readonly mirror: boolean;
  readonly rotation: Rotation;
  readonly border: Border | null;
}

const HELD_BLUR_FRACTION = 0.025;
const HELD_BLUR_MIN_PX = 3;
const DESIRED_SIZE_STEP = 16;

/** Clamps a number into [min, max]; non-finite values become `fallback`. */
export function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, value));
}

/** Stored geometry of an item, clamped to the API bounds. */
export function itemRect(item: SceneItemDto): CanvasRect {
  return {
    x: clampNumber(item.x, ITEM_BOUNDS.minX, ITEM_BOUNDS.maxX, 0),
    y: clampNumber(item.y, ITEM_BOUNDS.minY, ITEM_BOUNDS.maxY, 0),
    w: clampNumber(item.w, ITEM_BOUNDS.minW, ITEM_BOUNDS.maxW, ITEM_BOUNDS.minW),
    h: clampNumber(item.h, ITEM_BOUNDS.minH, ITEM_BOUNDS.maxH, ITEM_BOUNDS.minH),
  };
}

function cropSide(value: unknown): number {
  return clampNumber(value, 0, ITEM_BOUNDS.maxCropPerSide, 0);
}

/** Crop with every side clamped; a missing crop means no crop. */
export function sanitizeCrop(crop: CropDto | null | undefined): Crop {
  return {
    top: cropSide(crop?.top),
    right: cropSide(crop?.right),
    bottom: cropSide(crop?.bottom),
    left: cropSide(crop?.left),
  };
}

/** The look of an item with every field sanitised. */
export function itemLook(item: SceneItemDto): ItemLook {
  const border = item.border;
  return {
    fit: item.fit === 'contain' ? 'contain' : 'cover',
    crop: sanitizeCrop(item.crop),
    radius: clampNumber(item.radius, 0, ITEM_BOUNDS.maxRadius, 0),
    mirror: item.mirror === true,
    rotation: snapRotation(item.rotation),
    border:
      border && isHexColor(border.color)
        ? {
            width: clampNumber(border.width, 1, ITEM_BOUNDS.maxBorderWidth, 1),
            color: border.color,
          }
        : null,
  };
}

/**
 * Box of the uncropped picture relative to the item: scaled up so that the visible part (1 − left − right,
 * 1 − top − bottom) exactly fills the item, and shifted so the cropped edges lie outside the item (clipped there).
 */
export function cropBox(itemWidth: number, itemHeight: number, crop: Crop): Box {
  const width = itemWidth / (1 - crop.left - crop.right);
  const height = itemHeight / (1 - crop.top - crop.bottom);
  return { left: -crop.left * width, top: -crop.top * height, width, height };
}

/**
 * Box of the media element inside the crop box before rotation. For 90° and 270° width and height are swapped and the
 * box is centred, so that after `rotate()` around its centre the picture covers the crop box exactly.
 */
export function mediaBox(cropWidth: number, cropHeight: number, rotation: Rotation): Box {
  if (rotation === 90 || rotation === 270) {
    return {
      left: (cropWidth - cropHeight) / 2,
      top: (cropHeight - cropWidth) / 2,
      width: cropHeight,
      height: cropWidth,
    };
  }
  return { left: 0, top: 0, width: cropWidth, height: cropHeight };
}

/** Blur of a held picture: about 2.5 % of the item width, at least 3 px, so nothing reads as overlaid text. */
export function heldBlurPx(itemWidth: number): number {
  return Math.max(HELD_BLUR_MIN_PX, Math.round(itemWidth * HELD_BLUR_FRACTION));
}

function roundUpToStep(value: number): number {
  const safe = Number.isFinite(value) && value > 0 ? value : 0;
  return Math.max(DESIRED_SIZE_STEP, Math.ceil(safe / DESIRED_SIZE_STEP) * DESIRED_SIZE_STEP);
}

/**
 * Picture size a source needs to look sharp: the media box (uncropped, unrotated picture) in screen pixels times the
 * device pixel ratio, rounded up to 16 px steps (fewer layer switches) and at least 16 px.
 */
export function desiredPixelSize(media: Box, scale: number, devicePixelRatio: number): DesiredSize {
  const factor =
    scale * (Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1);
  return {
    width: roundUpToStep(media.width * factor),
    height: roundUpToStep(media.height * factor),
  };
}

/** Larger of two desired sizes per axis (one source shown twice needs the bigger picture). */
export function maxDesiredSize(a: DesiredSize, b: DesiredSize): DesiredSize {
  return { width: Math.max(a.width, b.width), height: Math.max(a.height, b.height) };
}
