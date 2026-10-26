import { LIMITS } from './constants';
import type {
  AssetDto,
  DeviceDto,
  DeviceTelemetryMessage,
  IncidentDto,
  InviteDto,
  LogEntryDto,
  OutputChangesDto,
  OutputSnapshot,
  OutputStatusDto,
  PairingRequestDto,
  ProductionChangesDto,
  ProductionDto,
  ProductionEvent,
  ProductionSnapshot,
  SceneDto,
  SourceDto,
} from './contracts';

/**
 * Immutable client copy of a production, built from a snapshot and advanced by revisioned events (spec 6).
 * Every reducer returns a new object and keeps unchanged collections by reference, so consumers can compare
 * collections with `===` to skip work.
 */
export interface ProductionState {
  /** Revision of the last applied snapshot or event. */
  readonly revision: number;
  /** `serverTime − Date.now()` at the time the snapshot was received; corrects local timers. */
  readonly serverOffsetMs: number;
  readonly production: ProductionDto;
  /** Always sorted by `sortOrder`, then id. */
  readonly scenes: readonly SceneDto[];
  /** Sources by source reference (`{deviceId}/{slot}` or `{assetId}`). */
  readonly sources: ReadonlyMap<string, SourceDto>;
  readonly devices: ReadonlyMap<string, DeviceDto>;
  readonly assets: ReadonlyMap<string, AssetDto>;
  /** Pending knocks, oldest first. */
  readonly pairingRequests: readonly PairingRequestDto[];
  readonly invites: readonly InviteDto[];
  /** Open and recovered incidents in insertion order. */
  readonly incidents: readonly IncidentDto[];
  /** Null for the output page, which does not see the output status. */
  readonly outputStatus: OutputStatusDto | null;
  /** "Recent events", newest first, at most {@link LIMITS.recentLogEntries}. */
  readonly log: readonly LogEntryDto[];
  /** Connected Regie sessions. */
  readonly operatorsOnline: number;
}

/** Outcome of {@link applyEvent}: applied (revision + 1), ignored (already covered) or gap (events missing). */
export type EventResult = 'applied' | 'ignored' | 'gap';

/** New state and outcome of {@link applyEvent}. For `ignored` and `gap` the state is the unchanged input. */
export interface EventApplication {
  readonly state: ProductionState;
  readonly result: EventResult;
}

/** Outcome of applying a subscribe answer: a full snapshot, a complete delta, or a delta that stopped at a gap. */
export type ChangesResult = 'snapshot' | 'applied' | 'gap';

/** New state and outcome of {@link applyChanges} / {@link applyOutputChanges}. */
export interface ChangesApplication {
  readonly state: ProductionState;
  readonly result: ChangesResult;
}

/** The parts of a subscribe answer the reducers need; both answer types have this shape on the wire. */
interface ChangesParts<TSnapshot> {
  readonly revision: number;
  readonly events: readonly ProductionEvent[] | null;
  readonly snapshot: TSnapshot | null;
}

/** Fields shared by the Regie and the output snapshot. */
type SnapshotBase = Pick<
  ProductionSnapshot,
  'revision' | 'serverTime' | 'production' | 'scenes' | 'sources' | 'assets'
>;

/** Sort key of an ISO timestamp: unparsable values sort last. */
function sortableTime(iso: string): number {
  const time = Date.parse(iso);
  return Number.isNaN(time) ? Number.POSITIVE_INFINITY : time;
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareScenes(a: SceneDto, b: SceneDto): number {
  return a.sortOrder - b.sortOrder || compareIds(a.id, b.id);
}

function comparePairingRequests(a: PairingRequestDto, b: PairingRequestDto): number {
  // Two unparsable timestamps give NaN (Infinity − Infinity), which is falsy and falls through to the id.
  return sortableTime(a.createdAt) - sortableTime(b.createdAt) || compareIds(a.id, b.id);
}

function sortedScenes(scenes: readonly SceneDto[]): SceneDto[] {
  return [...scenes].sort(compareScenes);
}

function toMap<T extends { readonly id: string }>(items: readonly T[]): ReadonlyMap<string, T> {
  return new Map(items.map((item) => [item.id, item]));
}

function mapWith<T>(map: ReadonlyMap<string, T>, key: string, value: T): ReadonlyMap<string, T> {
  const next = new Map(map);
  next.set(key, value);
  return next;
}

/** Removes a key; returns the same map when the key is unknown. */
function mapWithout<T>(map: ReadonlyMap<string, T>, key: string): ReadonlyMap<string, T> {
  if (!map.has(key)) {
    return map;
  }
  const next = new Map(map);
  next.delete(key);
  return next;
}

/** Replaces the element with the same id in place, or appends it. */
function upsertById<T extends { readonly id: string }>(list: readonly T[], item: T): readonly T[] {
  const index = list.findIndex((entry) => entry.id === item.id);
  if (index < 0) {
    return [...list, item];
  }
  const next = [...list];
  next[index] = item;
  return next;
}

/** Removes the element with the id; returns the same list when the id is unknown. */
function removeById<T extends { readonly id: string }>(
  list: readonly T[],
  id: string,
): readonly T[] {
  return list.some((entry) => entry.id === id) ? list.filter((entry) => entry.id !== id) : list;
}

function serverOffset(serverTime: string, receivedAtMs: number): number {
  const server = Date.parse(serverTime);
  return Number.isNaN(server) ? 0 : server - receivedAtMs;
}

function stateFromBase(snapshot: SnapshotBase, receivedAtMs: number): ProductionState {
  return {
    revision: snapshot.revision,
    serverOffsetMs: serverOffset(snapshot.serverTime, receivedAtMs),
    production: snapshot.production,
    scenes: sortedScenes(snapshot.scenes),
    sources: toMap(snapshot.sources),
    devices: new Map(),
    assets: toMap(snapshot.assets),
    pairingRequests: [],
    invites: [],
    incidents: [],
    outputStatus: null,
    log: [],
    operatorsOnline: 0,
  };
}

/** Builds the Regie state from a full snapshot. */
export function stateFromSnapshot(
  snapshot: ProductionSnapshot,
  receivedAtMs = Date.now(),
): ProductionState {
  return {
    ...stateFromBase(snapshot, receivedAtMs),
    devices: toMap(snapshot.devices),
    pairingRequests: [...snapshot.pairingRequests].sort(comparePairingRequests),
    invites: [...snapshot.invites],
    incidents: [...snapshot.incidents],
    outputStatus: snapshot.outputStatus,
    log: snapshot.recentLog.slice(0, LIMITS.recentLogEntries),
    operatorsOnline: snapshot.operatorsOnline,
  };
}

/**
 * Builds the output page state from an output snapshot. Devices, pairing requests, invites, incidents and the log are
 * empty and the output status is null: the output never sees them (their events arrive as `revisionOnly`).
 */
export function stateFromOutputSnapshot(
  snapshot: OutputSnapshot,
  receivedAtMs = Date.now(),
): ProductionState {
  return stateFromBase(snapshot, receivedAtMs);
}

/** Applies the new order of `scenesReordered`: listed scenes first (unknown ids ignored), the rest keep their order. */
function reorderScenes(
  scenes: readonly SceneDto[],
  sceneIds: readonly string[],
): readonly SceneDto[] {
  const byId = new Map(scenes.map((scene) => [scene.id, scene]));
  const listed = [...new Set(sceneIds)].flatMap((id) => byId.get(id) ?? []);
  const listedIds = new Set(listed.map((scene) => scene.id));
  const ordered = [...listed, ...scenes.filter((scene) => !listedIds.has(scene.id))];
  return ordered.map((scene, sortOrder) =>
    scene.sortOrder === sortOrder ? scene : { ...scene, sortOrder },
  );
}

function switchProgram(
  production: ProductionDto,
  event: Extract<ProductionEvent, { type: 'programSwitched' }>,
): ProductionDto {
  const programChanged = event.programSceneId !== production.programSceneId;
  return {
    ...production,
    programSceneId: event.programSceneId,
    previewSceneId: event.previewSceneId,
    // lastTransition and lastSwitchAt describe the last *program* switch (fade guard); a preview change keeps them.
    ...(programChanged ? { lastTransition: event.transition, lastSwitchAt: event.at } : {}),
  };
}

/** Exhaustiveness check: fails to compile when an event type is not handled. */
function unhandledEvent(_event: never, state: ProductionState): ProductionState {
  // A newer server may send an event type this client does not know yet: advancing the revision keeps the sync going.
  return state;
}

/** Applies the content of one event (without the revision check). */
function reduceEvent(state: ProductionState, event: ProductionEvent): ProductionState {
  switch (event.type) {
    case 'productionChanged':
      return { ...state, production: event.production };
    case 'productionCanvasChanged':
      return {
        ...state,
        production: event.production,
        scenes: sortedScenes(event.scenes.reduce(upsertById, state.scenes)),
      };
    case 'programSwitched':
      return { ...state, production: switchProgram(state.production, event) };
    case 'sceneUpserted':
      return { ...state, scenes: sortedScenes(upsertById(state.scenes, event.scene)) };
    case 'sceneRemoved':
      return { ...state, scenes: removeById(state.scenes, event.sceneId) };
    case 'scenesReordered':
      return { ...state, scenes: reorderScenes(state.scenes, event.sceneIds) };
    case 'sourceUpserted':
      return { ...state, sources: mapWith(state.sources, event.source.id, event.source) };
    case 'sourceRemoved':
      return { ...state, sources: mapWithout(state.sources, event.sourceId) };
    case 'deviceUpserted':
      return { ...state, devices: mapWith(state.devices, event.device.id, event.device) };
    case 'deviceRemoved':
      return { ...state, devices: mapWithout(state.devices, event.deviceId) };
    case 'assetUpserted':
      return { ...state, assets: mapWith(state.assets, event.asset.id, event.asset) };
    case 'assetRemoved':
      return { ...state, assets: mapWithout(state.assets, event.assetId) };
    case 'pairingRequestUpserted':
      return {
        ...state,
        pairingRequests: [...upsertById(state.pairingRequests, event.request)].sort(
          comparePairingRequests,
        ),
      };
    case 'pairingRequestRemoved':
      return { ...state, pairingRequests: removeById(state.pairingRequests, event.requestId) };
    case 'inviteUpserted':
      return { ...state, invites: upsertById(state.invites, event.invite) };
    case 'inviteRemoved':
      return { ...state, invites: removeById(state.invites, event.inviteId) };
    case 'incidentUpserted':
      return { ...state, incidents: upsertById(state.incidents, event.incident) };
    case 'incidentRemoved':
      return { ...state, incidents: removeById(state.incidents, event.incidentId) };
    case 'outputStatusChanged':
      return { ...state, outputStatus: event.status };
    case 'logAppended':
      return { ...state, log: [event.entry, ...state.log].slice(0, LIMITS.recentLogEntries) };
    case 'revisionOnly':
      return state;
    default:
      return unhandledEvent(event, state);
  }
}

/**
 * Applies one revisioned event (spec 6): only when `event.revision === state.revision + 1`. An older or equal revision
 * is `ignored` (duplicate or already covered by a snapshot), a larger one is a `gap` (the caller resubscribes). In both
 * cases the input state object is returned.
 */
export function applyEvent(state: ProductionState, event: ProductionEvent): EventApplication {
  if (event.revision <= state.revision) {
    return { state, result: 'ignored' };
  }
  if (event.revision !== state.revision + 1) {
    return { state, result: 'gap' };
  }
  return { state: { ...reduceEvent(state, event), revision: event.revision }, result: 'applied' };
}

function applyChangesParts<TSnapshot>(
  state: ProductionState | null,
  changes: ChangesParts<TSnapshot>,
  fromSnapshot: (snapshot: TSnapshot) => ProductionState,
): ChangesApplication {
  if (changes.snapshot) {
    return { state: fromSnapshot(changes.snapshot), result: 'snapshot' };
  }
  if (!state) {
    throw new Error(
      'A delta without snapshot cannot be applied to an empty state; subscribe without a revision.',
    );
  }
  const events = [...(changes.events ?? [])].sort((a, b) => a.revision - b.revision);
  let current = state;
  for (const event of events) {
    const application = applyEvent(current, event);
    if (application.result === 'gap') {
      return { state: current, result: 'gap' };
    }
    current = application.state;
  }
  return { state: current, result: current.revision >= changes.revision ? 'applied' : 'gap' };
}

/**
 * Applies the answer of `Subscribe` (Regie). A snapshot replaces the state; otherwise the events are applied in
 * revision order on top of `state`. A missing event (inside the list, or the list ends below `changes.revision`)
 * yields `gap` with the state up to the gap.
 *
 * @throws Error when `state` is null and the answer carries no snapshot (protocol violation: the client asked for a
 * snapshot by subscribing without a revision).
 */
export function applyChanges(
  state: ProductionState | null,
  changes: ProductionChangesDto,
  receivedAtMs = Date.now(),
): ChangesApplication {
  return applyChangesParts(state, changes, (snapshot) => stateFromSnapshot(snapshot, receivedAtMs));
}

/**
 * Applies the answer of `SubscribeOutput` (output page); same rules as {@link applyChanges}.
 *
 * @throws Error when `state` is null and the answer carries no snapshot.
 */
export function applyOutputChanges(
  state: ProductionState | null,
  changes: OutputChangesDto,
  receivedAtMs = Date.now(),
): ChangesApplication {
  // The generated OutputChangesDto inlines its schemas (non-null snapshot with `unknown` members) although the C#
  // record is `OutputChangesDto(long Revision, IReadOnlyList<ProductionEvent>? Events, OutputSnapshot? Snapshot)`;
  // on the wire it is an OutputSnapshot or null, so the snapshot is typed accordingly here.
  const parts: ChangesParts<OutputSnapshot> = {
    revision: changes.revision,
    events: changes.events,
    snapshot: changes.snapshot as OutputSnapshot | null,
  };
  return applyChangesParts(state, parts, (snapshot) =>
    stateFromOutputSnapshot(snapshot, receivedAtMs),
  );
}

/**
 * Replaces the telemetry of one device (`telemetry` push, not revisioned). Unknown devices and telemetry older than
 * the one already held return the same state.
 */
export function applyTelemetry(
  state: ProductionState,
  message: DeviceTelemetryMessage,
): ProductionState {
  const device = state.devices.get(message.deviceId);
  if (!device) {
    return state;
  }
  if (device.telemetry && Date.parse(message.telemetry.at) < Date.parse(device.telemetry.at)) {
    // Comparisons with NaN are false, so telemetry with an unparsable time is never treated as stale.
    return state;
  }
  return {
    ...state,
    devices: mapWith(state.devices, device.id, { ...device, telemetry: message.telemetry }),
  };
}

/** Sets the number of connected Regie sessions (`presence` push). Invalid counts return the same state. */
export function applyPresence(state: ProductionState, operatorsOnline: number): ProductionState {
  if (
    !Number.isSafeInteger(operatorsOnline) ||
    operatorsOnline < 0 ||
    operatorsOnline === state.operatorsOnline
  ) {
    return state;
  }
  return { ...state, operatorsOnline };
}

/** Current server time in ms since the epoch, corrected by the offset measured at the last snapshot. */
export function serverNow(state: ProductionState, localNowMs = Date.now()): number {
  return localNowMs + state.serverOffsetMs;
}
