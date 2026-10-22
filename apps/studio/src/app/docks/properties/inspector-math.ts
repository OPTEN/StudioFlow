import {
  HOLD_OPTIONS,
  ITEM_BOUNDS,
  compareCodes,
  formatDecimal,
  type BorderDto,
  type CropDto,
  type SceneItemDto,
  type SourceDto,
} from '@flowstudio/scene-model';

/**
 * Pure helpers of the element inspector (prototype «Eigenschaften»): crop in percent, hold-time choices, fallback
 * sources and border defaults. The editor clamps every committed item (`clampItem`), so these helpers only translate
 * between the fields and the item. No Angular, no DOM.
 */

/** A crop side. */
export type CropSide = keyof CropDto;

/** Crop sides in the order of the fields (top, bottom, left, right). */
export const CROP_SIDES: readonly { readonly side: CropSide; readonly label: string }[] = [
  { side: 'top', label: 'Oben' },
  { side: 'bottom', label: 'Unten' },
  { side: 'left', label: 'Links' },
  { side: 'right', label: 'Rechts' },
];

/** Largest crop per side in percent (server: 0.45). */
export const MAX_CROP_PERCENT = ITEM_BOUNDS.maxCropPerSide * 100;

/** Border of a newly enabled «Rahmen». */
export const DEFAULT_BORDER: BorderDto = { width: 4, color: '#ffffff' };

/** A crop fraction (0–0.45) as percent with one decimal: 0.125 → 12.5. */
export function cropToPercent(fraction: number): number {
  return Number.isFinite(fraction) ? Math.round(fraction * 1000) / 10 : 0;
}

/** The item with one crop side set from a percent value (clamped by the editor). */
export function withCropPercent(item: SceneItemDto, side: CropSide, percent: number): SceneItemDto {
  const fraction = Math.min(MAX_CROP_PERCENT, Math.max(0, percent)) / 100;
  return { ...item, crop: { ...item.crop, [side]: fraction } };
}

/** True when any side is cropped. */
export function hasCrop(item: SceneItemDto): boolean {
  const { top, right, bottom, left } = item.crop;
  return top > 0 || right > 0 || bottom > 0 || left > 0;
}

/** The item without crop («Zurücksetzen»). */
export function withoutCrop(item: SceneItemDto): SceneItemDto {
  return { ...item, crop: { top: 0, right: 0, bottom: 0, left: 0 } };
}

/** The item with «Rahmen» switched on (default border) or off. */
export function withBorderEnabled(item: SceneItemDto, enabled: boolean): SceneItemDto {
  if (enabled) {
    return item.border ? item : { ...item, border: { ...DEFAULT_BORDER } };
  }
  return item.border ? { ...item, border: null } : item;
}

/** A choice of «Bei Ausfall». */
export interface HoldChoice {
  /** Value of the `<option>`: the hold time in ms or `hold`. */
  readonly value: string;
  readonly label: string;
}

/** Option value of a hold time (`hold` for «Standbild halten»). */
export function holdValue(holdMs: number | null): string {
  return holdMs === null ? 'hold' : String(holdMs);
}

/** Hold time of an option value; undefined for anything unknown. */
export function parseHoldValue(value: string): number | null | undefined {
  if (value === 'hold') {
    return null;
  }
  const ms = Number(value);
  return Number.isInteger(ms) && ms >= 0 && ms <= ITEM_BOUNDS.maxHoldMs ? ms : undefined;
}

/**
 * The «Bei Ausfall» options (`HOLD_OPTIONS`), plus the item's current hold time when it is none of them (set through
 * the API), so the select never shows a wrong value.
 */
export function holdChoices(current: number | null): HoldChoice[] {
  const choices = HOLD_OPTIONS.map((option) => ({
    value: holdValue(option.holdMs),
    label: option.label,
  }));
  if (!HOLD_OPTIONS.some((option) => option.holdMs === current) && current !== null) {
    choices.unshift({
      value: holdValue(current),
      label: `Standbild ${formatDecimal(current / 1000, 1)} s, dann abgedunkelt`,
    });
  }
  return choices;
}

/** A group of the «Ersatzquelle» select. */
export interface FallbackGroup {
  readonly label: 'Medien' | 'Kameras' | 'Screens';
  readonly options: readonly { readonly id: string; readonly label: string }[];
}

/**
 * Sources that can replace the item's source after the hold time (spec 4.3: any existing source except its own),
 * media first (a pause slate is the usual choice), then cameras and screens; each by slot code.
 */
export function fallbackGroups(
  sources: ReadonlyMap<string, SourceDto>,
  ownSourceId: string,
): FallbackGroup[] {
  const candidates = [...sources.values()]
    .filter((source) => source.id !== ownSourceId)
    .sort((a, b) => compareCodes(a.code, b.code));
  const option = (source: SourceDto): { id: string; label: string } => ({
    id: source.id,
    label: `${source.code} · ${source.label}`,
  });
  const groups: FallbackGroup[] = [
    {
      label: 'Medien',
      options: candidates
        .filter((source) => source.kind === 'image' || source.kind === 'video')
        .map(option),
    },
    {
      label: 'Kameras',
      options: candidates.filter((source) => source.kind === 'camera').map(option),
    },
    {
      label: 'Screens',
      options: candidates.filter((source) => source.kind === 'screen').map(option),
    },
  ];
  return groups.filter((group) => group.options.length > 0);
}
