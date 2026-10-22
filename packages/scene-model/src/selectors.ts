import type {
  AssetDto,
  DeviceDto,
  IncidentKind,
  SceneDto,
  SourceDto,
  SourceStatus,
  TallyDto,
  TallyState,
} from './contracts';
import { pluralize } from './format';
import type { ProductionState } from './production-state';

/** Worst outage among the visible items of a scene (scene list lamp, «K2 gestört»). `bad` is false for amber. */
export interface SceneHealth {
  readonly code: string;
  readonly bad: boolean;
}

/** Where an incident's source is on air, as shown in the message strip. */
export type IncidentPlace = 'im Program' | 'in der Preview' | 'nicht live';

/** Station health in the header chip. */
export interface HealthSummary {
  /** Number of open (not yet recovered) incidents. */
  readonly active: number;
  /** True when at least one open incident is red (ended or lost), false when all are amber or none is open. */
  readonly bad: boolean;
  /** «Alle 5 Stationen ok», «1 Störung», «2 Störungen». */
  readonly text: string;
}

const TALLY_RANK: Readonly<Record<TallyState, number>> = { off: 0, preview: 1, program: 2 };

const codeCollator = new Intl.Collator('de-CH', { numeric: true, sensitivity: 'base' });

/** Natural order of slot codes: K1 < K2 < K10 < M1 < S1. */
export function compareCodes(a: string, b: string): number {
  return codeCollator.compare(a, b);
}

/** Scene with the id, or null for null, undefined and unknown ids. */
export function sceneById(
  state: ProductionState,
  sceneId: string | null | undefined,
): SceneDto | null {
  return sceneId ? (state.scenes.find((scene) => scene.id === sceneId) ?? null) : null;
}

/** The scene on air. */
export function programScene(state: ProductionState): SceneDto | null {
  return sceneById(state, state.production.programSceneId);
}

/** The scene in the preview (Studio-Modus), or null when no operator uses Studio-Modus. */
export function previewScene(state: ProductionState): SceneDto | null {
  return sceneById(state, state.production.previewSceneId);
}

/** Sources of the visible items, each once, in z-order (back to front). */
export function sourcesInScene(scene: SceneDto | null | undefined): string[] {
  if (!scene) {
    return [];
  }
  return [...new Set(scene.items.filter((item) => !item.hidden).map((item) => item.source))];
}

/** True when a visible item of the scene shows the source. */
export function isSourceVisibleIn(scene: SceneDto | null | undefined, sourceId: string): boolean {
  return !!scene && scene.items.some((item) => !item.hidden && item.source === sourceId);
}

/** True for states that count as an outage (amber or red): reconnecting, ended, lost, blocked. */
export function isDown(status: SourceStatus): boolean {
  return (
    status === 'reconnecting' || status === 'ended' || status === 'lost' || status === 'blocked'
  );
}

/**
 * Worst down source among the visible items of a scene, like the prototype `sceneHealth`: the first down source in
 * z-order, replaced by the first red one if the first is only amber (reconnecting). Unknown sources are ignored.
 */
export function sceneHealth(
  scene: SceneDto,
  sources: ReadonlyMap<string, SourceDto>,
): SceneHealth | null {
  let worst: SceneHealth | null = null;
  for (const item of scene.items) {
    const source = sources.get(item.source);
    if (item.hidden || !source || !isDown(source.status)) {
      continue;
    }
    const bad = source.status !== 'reconnecting';
    if (!worst || (bad && !worst.bad)) {
      worst = { code: source.code, bad };
    }
  }
  return worst;
}

/**
 * Tally of a source for the Regie (PGM/PVW tags): `program` when visible in the program scene, else `preview` when
 * visible in the preview scene, else `off`. Independent of the broadcast state.
 */
export function tallyOf(state: ProductionState, sourceId: string): TallyState {
  if (isSourceVisibleIn(programScene(state), sourceId)) {
    return 'program';
  }
  return isSourceVisibleIn(previewScene(state), sourceId) ? 'preview' : 'off';
}

/**
 * Tally a device receives (spec 4.6): per slot like {@link tallyOf}, overall the highest slot tally; everything is
 * `off` while the broadcast is not live (nothing is on air during standby and after the end).
 */
export function deviceTally(state: ProductionState, deviceId: string): TallyDto {
  const live = state.production.broadcast === 'live';
  const slots: Record<string, TallyState> = {};
  let overall: TallyState = 'off';
  for (const source of state.sources.values()) {
    if (source.deviceId !== deviceId || !source.slot) {
      continue;
    }
    const tally = live ? tallyOf(state, source.id) : 'off';
    slots[source.slot] = tally;
    if (TALLY_RANK[tally] > TALLY_RANK[overall]) {
      overall = tally;
    }
  }
  return { overall, slots };
}

/** Where the source of an incident is on air, for the message strip. */
export function incidentPlace(state: ProductionState, sourceId: string): IncidentPlace {
  switch (tallyOf(state, sourceId)) {
    case 'program':
      return 'im Program';
    case 'preview':
      return 'in der Preview';
    case 'off':
      return 'nicht live';
  }
}

/** Red incidents (ended, lost) outrank amber ones (reconnecting). */
function isBadIncident(kind: IncidentKind): boolean {
  return kind !== 'reconnecting';
}

/** Sources of a device (its slots), sorted by slot code. */
export function deviceSources(state: ProductionState, deviceId: string): SourceDto[] {
  return [...state.sources.values()]
    .filter((source) => source.deviceId === deviceId)
    .sort((a, b) => compareCodes(a.code, b.code));
}

interface StationKey {
  readonly rank: number;
  readonly firstCode: string | null;
}

/** Rank of one source: 0 open red incident, 1 open amber, 2 recovered, 3 connecting, 4 program, 5 preview, 6 rest. */
function sourceRank(state: ProductionState, source: SourceDto): number {
  const incidents = state.incidents.filter((entry) => entry.sourceId === source.id);
  const open = incidents.find((entry) => entry.endedAt === null);
  if (open) {
    return isBadIncident(open.kind) ? 0 : 1;
  }
  if (incidents.length > 0) {
    return 2;
  }
  if (source.status === 'connecting') {
    return 3;
  }
  switch (tallyOf(state, source.id)) {
    case 'program':
      return 4;
    case 'preview':
      return 5;
    case 'off':
      return 6;
  }
}

function stationKey(state: ProductionState, deviceId: string): StationKey {
  const sources = deviceSources(state, deviceId);
  const rank = Math.min(6, ...sources.map((source) => sourceRank(state, source)));
  return { rank, firstCode: sources[0]?.code ?? null };
}

/**
 * Comparator for the Stationen dock (prototype `stationOrder`): devices with an open red incident first, then open
 * amber, recovered, connecting, in program, in preview, the rest; within a rank by first slot code (devices without
 * slots last), then by name. A device ranks by its most urgent slot. Keys are computed once per comparator, so create
 * a new comparator for every sort.
 */
export function stationOrder(state: ProductionState): (a: DeviceDto, b: DeviceDto) => number {
  const keys = new Map<string, StationKey>();
  const keyOf = (device: DeviceDto): StationKey => {
    let key = keys.get(device.id);
    if (!key) {
      key = stationKey(state, device.id);
      keys.set(device.id, key);
    }
    return key;
  };
  return (a, b) => {
    const keyA = keyOf(a);
    const keyB = keyOf(b);
    if (keyA.rank !== keyB.rank) {
      return keyA.rank - keyB.rank;
    }
    if (keyA.firstCode !== keyB.firstCode) {
      if (keyA.firstCode === null || keyB.firstCode === null) {
        return keyA.firstCode === null ? 1 : -1;
      }
      const byCode = compareCodes(keyA.firstCode, keyB.firstCode);
      if (byCode !== 0) {
        return byCode;
      }
    }
    return codeCollator.compare(a.name, b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  };
}

/** The asset behind a media source (`{assetId}` reference), or null for device sources and unknown ids. */
export function assetForSource(state: ProductionState, sourceId: string): AssetDto | null {
  const assetId = state.sources.get(sourceId)?.assetId ?? sourceId;
  return state.assets.get(assetId) ?? null;
}

/** Display name of a source; «Quelle fehlt» when the source was deleted. */
export function sourceLabel(state: ProductionState, sourceId: string): string {
  return state.sources.get(sourceId)?.label ?? 'Quelle fehlt';
}

function stationsOkText(count: number): string {
  if (count === 0) {
    return 'Keine Stationen';
  }
  return count === 1 ? '1 Station ok' : `Alle ${count} Stationen ok`;
}

/** Header chip: «2 Störungen» while incidents are open, else «Alle 5 Stationen ok» (blocked devices not counted). */
export function healthSummary(state: ProductionState): HealthSummary {
  const open = state.incidents.filter((incident) => incident.endedAt === null);
  if (open.length > 0) {
    return {
      active: open.length,
      bad: open.some((incident) => isBadIncident(incident.kind)),
      text: pluralize(open.length, 'Störung', 'Störungen'),
    };
  }
  const stations = [...state.devices.values()].filter(
    (device) => device.state !== 'blocked',
  ).length;
  return { active: 0, bad: false, text: stationsOkText(stations) };
}
