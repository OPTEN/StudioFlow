import { t } from '@studioflow/i18n';

/** Margin used by layout templates and as a snap line on a 1080p canvas (prototype: 40 px); see `safeMargin`. */
export const SAFE_MARGIN = 40;

/** Allowed fade durations in milliseconds (no T-bar: a fade always runs to completion). */
export const FADE_DURATIONS_MS = [200, 300, 500, 800, 1000, 1500, 2000] as const;
/** One of the allowed fade durations. */
export type FadeDurationMs = (typeof FADE_DURATIONS_MS)[number];

/** Default fade duration. */
export const DEFAULT_FADE_MS: FadeDurationMs = 300;

/**
 * Options of "On failure" in the item inspector. `holdMs: null` keeps the last frame forever. The label is a getter, so
 * it is looked up when it is read and follows the active language.
 */
export const HOLD_OPTIONS: readonly { readonly label: string; readonly holdMs: number | null }[] = [
  {
    get label() {
      return t('model.scene.holdThenDim3');
    },
    holdMs: 3000,
  },
  {
    get label() {
      return t('model.scene.holdThenDim10');
    },
    holdMs: 10000,
  },
  {
    get label() {
      return t('model.scene.holdForever');
    },
    holdMs: null,
  },
];

/** Default hold time for new items. */
export const DEFAULT_HOLD_MS = 3000;

/** Corner radius of new items and of template slots that do not fill the whole canvas. */
export const DEFAULT_ITEM_RADIUS = 12;

/** Limits enforced by the API (mirrored for client-side checks). */
export const LIMITS = {
  scenesPerProduction: 99,
  itemsPerScene: 32,
  sceneNameLength: 80,
  deviceNameLength: 60,
  productionNameLength: 80,
  assetNameLength: 80,
  messageLength: 140,
  usernameLength: 64,
  passwordMinLength: 12,
  passwordMaxLength: 256,
  screensPerDevice: 9,
  /** Entries of "Recent events" the snapshot carries and the client keeps. */
  recentLogEntries: 20,
} as const;

/**
 * Geometry bounds of a scene item in canvas pixels. They are absolute and wide enough for every canvas (at most 1920
 * pixels on a side), so they do not depend on the production.
 */
export const ITEM_BOUNDS = {
  minX: -3840,
  maxX: 3840,
  minY: -2160,
  maxY: 2160,
  minW: 16,
  maxW: 3840,
  minH: 16,
  maxH: 2160,
  maxCropPerSide: 0.45,
  maxCropPerAxis: 0.9,
  maxRadius: 200,
  maxBorderWidth: 40,
  maxHoldMs: 600_000,
} as const;

/** Allowed item rotations in degrees. */
export const ROTATIONS = [0, 90, 180, 270] as const;
/** One of the allowed item rotations. */
export type Rotation = (typeof ROTATIONS)[number];

/** Geometry the server uses for a newly added item on a 1920 × 1080 canvas; other canvases get it in proportion (`placeOnCanvas`). */
export const NEW_ITEM_RECT = { x: 1240, y: 680, w: 600, h: 338 } as const;
