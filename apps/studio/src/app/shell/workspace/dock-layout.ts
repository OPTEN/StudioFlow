import type { PlainMessageKey } from '@studioflow/i18n';

/**
 * Pure model of the dock layout (prototype "Layout: move docks and change sizes"), stored per browser as
 * `studioflow.layout` (version 1). No Angular, no DOM: `DockLayoutService` holds it in a signal.
 */

/** The movable docks. */
export type DockId = 'scenes' | 'src' | 'insp' | 'st';
/** Every dock that can appear in a zone, including the temporary pairing dock. */
export type DockSlotId = DockId | 'pair';
/** Dock zones around the stage. */
export type DockZone = 'left' | 'bottom' | 'right';

/** The movable docks in default order. */
export const DOCK_IDS: readonly DockId[] = ['scenes', 'src', 'insp', 'st'];
/** Zones in keyboard order (the grip arrows walk left → bottom → right). */
export const DOCK_ZONES: readonly DockZone[] = ['left', 'bottom', 'right'];

/** Message keys of the dock titles (header label, toasts, splitter labels); resolve them with `t` when shown. */
export const DOCK_TITLE_KEYS = {
  scenes: 'regie.workspace.dock.scenes',
  src: 'regie.workspace.dock.src',
  insp: 'regie.workspace.dock.insp',
  st: 'regie.workspace.dock.st',
  pair: 'regie.workspace.dock.pair',
} as const satisfies Record<DockSlotId, PlainMessageKey>;

/** Message keys of the accessible region names of the docks (prototype `aria-label` of the sections). */
export const DOCK_REGION_KEYS = {
  ...DOCK_TITLE_KEYS,
  src: 'regie.workspace.dockRegion.src',
} as const satisfies Record<DockSlotId, PlainMessageKey>;

/** Layout of the docks, version 1 of the stored format. */
export interface DockLayout {
  readonly v: 1;
  /** Docks per zone, in order (left/right: top to bottom; bottom: left to right). Every dock exactly once. */
  readonly zones: Readonly<Record<DockZone, readonly DockId[]>>;
  /** Flex weights per dock (the pairing dock takes the space of Sources and Properties). */
  readonly weights: Readonly<Record<DockSlotId, number>>;
  /** Hidden docks ("Docks and layout"). */
  readonly hidden: readonly DockId[];
  /** Height of the bottom zone as a fraction of the centre column, or null for the default height. */
  readonly bottomH: number | null;
  /** Width of the left zone in px. */
  readonly leftW: number;
  /** Width of the right zone in px. */
  readonly rightW: number;
  /** Share of the Preview monitor in Studio Mode (0.3–0.7). */
  readonly split: number;
}

/** Limits of the resizable values. */
export const LAYOUT_LIMITS = {
  sideMin: 220,
  sideMax: 4000,
  splitMin: 0.3,
  splitMax: 0.7,
  bottomMinPx: 150,
  /** Space the stage keeps above the bottom zone. */
  stageMinPx: 160,
  bottomDockMinPx: 180,
  sideDockMinPx: 110,
  weightMin: 0.05,
  weightMax: 20,
} as const;

/** The default layout: Scenes | Sources | Properties | Stations at the bottom. */
export function defaultLayout(): DockLayout {
  return {
    v: 1,
    zones: { left: [], bottom: ['scenes', 'src', 'insp', 'st'], right: [] },
    weights: { scenes: 0.95, src: 1, insp: 1.2, st: 1.1, pair: 2.2 },
    hidden: [],
    bottomH: null,
    leftW: 320,
    rightW: 340,
    split: 0.5,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isDockId(value: unknown): value is DockId {
  return typeof value === 'string' && (DOCK_IDS as readonly string[]).includes(value);
}

/**
 * Validates stored JSON. Returns null on ANY inconsistency (wrong version, a dock missing or twice, unknown ids,
 * values out of range); the caller then uses {@link defaultLayout}. Missing optional values (weights of single docks,
 * `hidden`, sizes) take their defaults, like the prototype `loadLayout`.
 */
export function validateLayout(raw: unknown): DockLayout | null {
  if (!isRecord(raw) || raw['v'] !== 1 || !isRecord(raw['zones'])) {
    return null;
  }
  const defaults = defaultLayout();
  const zonesRaw = raw['zones'];
  const zones: Record<DockZone, DockId[]> = { left: [], bottom: [], right: [] };
  const seen = new Set<DockId>();
  for (const zone of DOCK_ZONES) {
    const list = zonesRaw[zone] ?? [];
    if (!Array.isArray(list)) {
      return null;
    }
    for (const id of list) {
      if (!isDockId(id) || seen.has(id)) {
        return null;
      }
      seen.add(id);
      zones[zone].push(id);
    }
  }
  if (seen.size !== DOCK_IDS.length) {
    return null;
  }
  const weights: Record<DockSlotId, number> = { ...defaults.weights };
  if (raw['weights'] !== undefined) {
    if (!isRecord(raw['weights'])) {
      return null;
    }
    for (const [id, value] of Object.entries(raw['weights'])) {
      if (!(id in weights)) {
        continue;
      }
      if (
        !isFiniteNumber(value) ||
        value < LAYOUT_LIMITS.weightMin ||
        value > LAYOUT_LIMITS.weightMax
      ) {
        return null;
      }
      weights[id as DockSlotId] = value;
    }
  }
  const hiddenRaw = raw['hidden'] ?? [];
  if (!Array.isArray(hiddenRaw) || !hiddenRaw.every(isDockId)) {
    return null;
  }
  const bottomH = raw['bottomH'] ?? null;
  if (bottomH !== null && (!isFiniteNumber(bottomH) || bottomH <= 0 || bottomH >= 1)) {
    return null;
  }
  const leftW = raw['leftW'] ?? defaults.leftW;
  const rightW = raw['rightW'] ?? defaults.rightW;
  for (const width of [leftW, rightW]) {
    if (!isFiniteNumber(width) || width < LAYOUT_LIMITS.sideMin || width > LAYOUT_LIMITS.sideMax) {
      return null;
    }
  }
  const split = raw['split'] ?? defaults.split;
  if (!isFiniteNumber(split) || split < LAYOUT_LIMITS.splitMin || split > LAYOUT_LIMITS.splitMax) {
    return null;
  }
  return {
    v: 1,
    zones,
    weights,
    hidden: [...new Set(hiddenRaw)],
    bottomH: bottomH as number | null,
    leftW: leftW as number,
    rightW: rightW as number,
    split,
  };
}

/** Zone that holds a dock. */
export function zoneOf(layout: DockLayout, id: DockId): DockZone {
  return DOCK_ZONES.find((zone) => layout.zones[zone].includes(id)) ?? 'bottom';
}

/** Moves a dock to `zone` at `index` (clamped). Returns the same object when nothing changes. */
export function moveDock(
  layout: DockLayout,
  id: DockId,
  zone: DockZone,
  index: number,
): DockLayout {
  const zones: Record<DockZone, DockId[]> = {
    left: layout.zones.left.filter((entry) => entry !== id),
    bottom: layout.zones.bottom.filter((entry) => entry !== id),
    right: layout.zones.right.filter((entry) => entry !== id),
  };
  const target = zones[zone];
  target.splice(Math.min(Math.max(index, 0), target.length), 0, id);
  const unchanged = DOCK_ZONES.every(
    (entry) =>
      zones[entry].length === layout.zones[entry].length &&
      zones[entry].every((dock, position) => dock === layout.zones[entry][position]),
  );
  return unchanged ? layout : { ...layout, zones };
}

/**
 * Keyboard move of the grip (prototype): one step forward/back within the zone; past the end it continues at the
 * start of the next zone (left → bottom → right), past the start at the end of the previous one. Returns the target
 * or null at the outer ends.
 */
export function stepTarget(
  layout: DockLayout,
  id: DockId,
  direction: -1 | 1,
): { zone: DockZone; index: number } | null {
  const zone = zoneOf(layout, id);
  const zoneIndex = DOCK_ZONES.indexOf(zone);
  const index = layout.zones[zone].indexOf(id) + direction;
  if (index < 0) {
    if (zoneIndex === 0) {
      return null;
    }
    const previous = DOCK_ZONES[zoneIndex - 1];
    return { zone: previous, index: layout.zones[previous].length };
  }
  if (index >= layout.zones[zone].length) {
    if (zoneIndex === DOCK_ZONES.length - 1) {
      return null;
    }
    return { zone: DOCK_ZONES[zoneIndex + 1], index: 0 };
  }
  return { zone, index };
}

/**
 * Where the pairing dock appears (prototype `pairSlot`): at the place of the first shown Sources or Properties
 * dock; without those next to Stations, else at the end of the bottom zone.
 */
export function pairSlot(layout: DockLayout): { zone: DockZone; index: number } {
  const shown = (id: DockId): boolean => !layout.hidden.includes(id);
  for (const zone of DOCK_ZONES) {
    const index = layout.zones[zone].filter(shown).findIndex((id) => id === 'src' || id === 'insp');
    if (index >= 0) {
      return { zone, index };
    }
  }
  const stationsZone = layout.zones.left.includes('st')
    ? 'left'
    : layout.zones.right.includes('st')
      ? 'right'
      : 'bottom';
  const list = layout.zones[stationsZone].filter(shown);
  return { zone: stationsZone, index: list.includes('st') ? list.indexOf('st') : list.length };
}

/** Docks shown per zone, with the pairing dock in place of Sources and Properties while it is open. */
export function visibleZones(
  layout: DockLayout,
  pairingOpen: boolean,
): Readonly<Record<DockZone, readonly DockSlotId[]>> {
  const shown = (id: DockId): boolean => !layout.hidden.includes(id);
  const result: Record<DockZone, DockSlotId[]> = { left: [], bottom: [], right: [] };
  const slot = pairingOpen ? pairSlot(layout) : null;
  for (const zone of DOCK_ZONES) {
    let list: DockSlotId[] = layout.zones[zone].filter(shown);
    if (slot) {
      list = list.filter((id) => id !== 'src' && id !== 'insp');
      if (slot.zone === zone) {
        list.splice(Math.min(slot.index, list.length), 0, 'pair');
      }
    }
    result[zone] = list;
  }
  return result;
}
