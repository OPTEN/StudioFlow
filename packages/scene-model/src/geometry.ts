import { t, type MessageKey } from '@studioflow/i18n';
import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  DEFAULT_HOLD_MS,
  DEFAULT_ITEM_RADIUS,
  ITEM_BOUNDS,
  NEW_ITEM_RECT,
  ROTATIONS,
  type Rotation,
} from './constants';
import type { BorderDto, CropDto, LostBehaviorDto, SceneItemDto, SourceKind } from './contracts';
import { formatDecimal } from './format';

/** Rectangle in canvas pixels (1920 × 1080 space). Structurally identical to the renderer's `CanvasRect`. */
export interface CanvasRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** A point in canvas pixels. */
export interface CanvasPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * Opposite crop sides must sum to strictly less than {@link ITEM_BOUNDS.maxCropPerAxis}; clamping scales an axis that
 * reaches the limit down to this value so the result always passes the server validation.
 */
const MAX_CLAMPED_CROP_AXIS = ITEM_BOUNDS.maxCropPerAxis - 0.001;

const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
const BASE32_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';
const ID_RANDOM_LENGTH = 16;
const NO_CROP: CropDto = { top: 0, right: 0, bottom: 0, left: 0 };

/** True for `#rrggbb`, the only colour format the API accepts (borders, scene backgrounds). */
export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_COLOR_PATTERN.test(value);
}

/** Rounds and clamps an integer field; NaN (e.g. from an empty number input) becomes `fallback`. */
function clampInteger(value: number, min: number, max: number, fallback: number): number {
  const known = typeof value === 'number' && !Number.isNaN(value) ? Math.round(value) : fallback;
  return Math.min(max, Math.max(min, known));
}

/** Clamps a fractional field; NaN becomes `min`. */
function clampFraction(value: number, min: number, max: number): number {
  return typeof value === 'number' && !Number.isNaN(value)
    ? Math.min(max, Math.max(min, value))
    : min;
}

/** Scales both sides of one crop axis down proportionally when they reach the axis limit. */
function fitCropAxis(first: number, second: number): readonly [number, number] {
  const sum = first + second;
  if (sum < ITEM_BOUNDS.maxCropPerAxis) {
    return [first, second];
  }
  const factor = MAX_CLAMPED_CROP_AXIS / sum;
  return [first * factor, second * factor];
}

function clampCrop(crop: CropDto): CropDto {
  const side = (value: number): number => clampFraction(value, 0, ITEM_BOUNDS.maxCropPerSide);
  const [top, bottom] = fitCropAxis(side(crop.top), side(crop.bottom));
  const [left, right] = fitCropAxis(side(crop.left), side(crop.right));
  return { top, right, bottom, left };
}

function clampBorder(border: BorderDto | null): BorderDto | null {
  return (
    border && { ...border, width: clampInteger(border.width, 1, ITEM_BOUNDS.maxBorderWidth, 1) }
  );
}

function clampOnLost(onLost: LostBehaviorDto): LostBehaviorDto {
  return onLost.holdMs === null
    ? onLost
    : { ...onLost, holdMs: clampInteger(onLost.holdMs, 0, ITEM_BOUNDS.maxHoldMs, DEFAULT_HOLD_MS) };
}

/** Snaps any angle in degrees to the nearest allowed rotation (−90 → 270, 100 → 90, 360 → 0). */
export function snapRotation(degrees: number): Rotation {
  if (!Number.isFinite(degrees)) {
    return 0;
  }
  const quarterTurns = ((Math.round(degrees / 90) % 4) + 4) % 4;
  return ROTATIONS[quarterTurns];
}

/**
 * Brings every numeric field of an item into the range the server accepts (spec 4.3), so editor input never produces a
 * rejected request: geometry rounded and clamped to {@link ITEM_BOUNDS}, each crop side to [0, 0.45] and each crop axis
 * below 0.9 (both sides scaled down proportionally), radius and border width rounded and clamped, rotation snapped to
 * {@link ROTATIONS}, hold time clamped. Non-numeric fields are returned unchanged; {@link validateItem} reports them.
 * Pure: returns a new item.
 */
export function clampItem(item: SceneItemDto): SceneItemDto {
  return {
    ...item,
    x: clampInteger(item.x, ITEM_BOUNDS.minX, ITEM_BOUNDS.maxX, NEW_ITEM_RECT.x),
    y: clampInteger(item.y, ITEM_BOUNDS.minY, ITEM_BOUNDS.maxY, NEW_ITEM_RECT.y),
    w: clampInteger(item.w, ITEM_BOUNDS.minW, ITEM_BOUNDS.maxW, NEW_ITEM_RECT.w),
    h: clampInteger(item.h, ITEM_BOUNDS.minH, ITEM_BOUNDS.maxH, NEW_ITEM_RECT.h),
    crop: clampCrop(item.crop),
    radius: clampInteger(item.radius, 0, ITEM_BOUNDS.maxRadius, 0),
    rotation: snapRotation(item.rotation),
    border: clampBorder(item.border),
    onLost: clampOnLost(item.onLost),
  };
}

function isIntegerIn(value: number, min: number, max: number): boolean {
  return Number.isInteger(value) && value >= min && value <= max;
}

/** Keys of the field names used in validation messages. */
type FieldKey = Extract<MessageKey, `model.scene.field.${string}`>;

function integerRangeMessage(label: FieldKey, min: number, max: number): string {
  return t('model.scene.validation.integerRange', { label: t(label), min, max });
}

function cropMessages(crop: CropDto): string[] {
  const messages: string[] = [];
  const sides: readonly [keyof CropDto, FieldKey][] = [
    ['top', 'model.scene.field.cropTop'],
    ['right', 'model.scene.field.cropRight'],
    ['bottom', 'model.scene.field.cropBottom'],
    ['left', 'model.scene.field.cropLeft'],
  ];
  for (const [side, label] of sides) {
    const value = crop[side];
    if (!(Number.isFinite(value) && value >= 0 && value <= ITEM_BOUNDS.maxCropPerSide)) {
      messages.push(
        t('model.scene.validation.cropSide', {
          label: t(label),
          max: formatDecimal(ITEM_BOUNDS.maxCropPerSide),
        }),
      );
    }
  }
  const axisLimit = formatDecimal(ITEM_BOUNDS.maxCropPerAxis);
  if (!(crop.top + crop.bottom < ITEM_BOUNDS.maxCropPerAxis)) {
    messages.push(t('model.scene.validation.cropAxisVertical', { max: axisLimit }));
  }
  if (!(crop.left + crop.right < ITEM_BOUNDS.maxCropPerAxis)) {
    messages.push(t('model.scene.validation.cropAxisHorizontal', { max: axisLimit }));
  }
  return messages;
}

function onLostMessages(
  item: SceneItemDto,
  sourceExists: ((sourceId: string) => boolean) | undefined,
): string[] {
  const messages: string[] = [];
  const { holdMs, fallbackSource } = item.onLost;
  if (holdMs !== null && !isIntegerIn(holdMs, 0, ITEM_BOUNDS.maxHoldMs)) {
    messages.push(t('model.scene.validation.holdDuration', { max: ITEM_BOUNDS.maxHoldMs / 1000 }));
  }
  if (fallbackSource !== null) {
    if (fallbackSource === item.source) {
      messages.push(t('model.scene.validation.fallbackSelf'));
    } else if (sourceExists && !sourceExists(fallbackSource)) {
      messages.push(t('model.scene.validation.fallbackMissing'));
    }
  }
  return messages;
}

/**
 * Checks one item against the server rules of spec 4.3 and returns messages in the active language for the inspector (empty = valid).
 * Scene-level rules (at most 32 items, unique ids) and the existence of the item's own source are checked by the API;
 * pass `sourceExists` to also verify the fallback source.
 */
export function validateItem(
  item: SceneItemDto,
  sourceExists?: (sourceId: string) => boolean,
): string[] {
  const messages: string[] = [];
  if (!item.id) {
    messages.push(t('model.scene.validation.idMissing'));
  }
  if (!item.source) {
    messages.push(t('model.scene.validation.sourceMissing'));
  }
  const integers: readonly [number, FieldKey, number, number][] = [
    [item.x, 'model.scene.field.x', ITEM_BOUNDS.minX, ITEM_BOUNDS.maxX],
    [item.y, 'model.scene.field.y', ITEM_BOUNDS.minY, ITEM_BOUNDS.maxY],
    [item.w, 'model.scene.field.width', ITEM_BOUNDS.minW, ITEM_BOUNDS.maxW],
    [item.h, 'model.scene.field.height', ITEM_BOUNDS.minH, ITEM_BOUNDS.maxH],
    [item.radius, 'model.scene.field.cornerRadius', 0, ITEM_BOUNDS.maxRadius],
  ];
  for (const [value, label, min, max] of integers) {
    if (!isIntegerIn(value, min, max)) {
      messages.push(integerRangeMessage(label, min, max));
    }
  }
  if (item.fit !== 'cover' && item.fit !== 'contain') {
    messages.push(t('model.scene.validation.fit'));
  }
  messages.push(...cropMessages(item.crop));
  if (!(ROTATIONS as readonly number[]).includes(item.rotation)) {
    messages.push(t('model.scene.validation.rotation'));
  }
  if (item.border) {
    if (!isIntegerIn(item.border.width, 1, ITEM_BOUNDS.maxBorderWidth)) {
      messages.push(
        integerRangeMessage('model.scene.field.borderWidth', 1, ITEM_BOUNDS.maxBorderWidth),
      );
    }
    if (!isHexColor(item.border.color)) {
      messages.push(t('model.scene.validation.borderColor'));
    }
  }
  messages.push(...onLostMessages(item, sourceExists));
  return messages;
}

/**
 * A new item with the server defaults of `AddSceneItem` (spec 4.3): 600 × 338 at 1240/680, radius 12, contain for
 * screens and cover for everything else, no crop, no rotation, hold the last frame 3 s on loss.
 */
export function newItem(source: string, kind: SourceKind | undefined, id: string): SceneItemDto {
  return {
    id,
    source,
    ...NEW_ITEM_RECT,
    fit: kind === 'screen' ? 'contain' : 'cover',
    crop: { ...NO_CROP },
    radius: DEFAULT_ITEM_RADIUS,
    mirror: false,
    rotation: 0,
    hidden: false,
    locked: false,
    border: null,
    onLost: { holdMs: DEFAULT_HOLD_MS, fallbackSource: null },
  };
}

/**
 * Random item id `itm_` + 16 lowercase base32 characters (80 bits, spec 4.1). Uses the Web Crypto API, which every
 * supported browser and Node ≥ 20 provide.
 */
export function createItemId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(ID_RANDOM_LENGTH));
  let suffix = '';
  for (const byte of bytes) {
    // 256 is a multiple of 32, so the low five bits are uniformly distributed.
    suffix += BASE32_ALPHABET[byte & 31];
  }
  return `itm_${suffix}`;
}

/** The rectangle of an item. */
export function rectOf(item: Pick<SceneItemDto, 'x' | 'y' | 'w' | 'h'>): CanvasRect {
  return { x: item.x, y: item.y, w: item.w, h: item.h };
}

/** True when both rectangles have identical position and size. */
export function rectsEqual(a: CanvasRect, b: CanvasRect): boolean {
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

/** True when the rectangles overlap by a positive area; touching edges and empty rectangles do not intersect. */
export function rectIntersects(a: CanvasRect, b: CanvasRect): boolean {
  return (
    a.w > 0 &&
    a.h > 0 &&
    b.w > 0 &&
    b.h > 0 &&
    a.x < b.x + b.w &&
    b.x < a.x + a.w &&
    a.y < b.y + b.h &&
    b.y < a.y + a.h
  );
}

/** Centre point of a rectangle. */
export function rectCenter(rect: CanvasRect): CanvasPoint {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

/**
 * Moves a rectangle fully onto the canvas, shrinking it first if it is larger than the canvas (keyboard nudges,
 * pasted items). Size is kept whenever it fits.
 */
export function clampRectToCanvas(rect: CanvasRect): CanvasRect {
  const w = Math.min(Math.max(rect.w, 0), CANVAS_WIDTH);
  const h = Math.min(Math.max(rect.h, 0), CANVAS_HEIGHT);
  return {
    x: Math.min(Math.max(rect.x, 0), CANVAS_WIDTH - w),
    y: Math.min(Math.max(rect.y, 0), CANVAS_HEIGHT - h),
    w,
    h,
  };
}
