import { DOCUMENT } from '@angular/common';
import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import {
  ProductionSync,
  backoffDelay,
  hubErrorCode,
  type HubState,
  type SyncCause,
  type SyncStatus,
} from '@studioflow/realtime-client';
import {
  ERROR_CODES,
  HUB,
  applyChanges,
  healthSummary,
  incidentPlace,
  sceneHealth,
  serverNow,
  stationOrder,
  tallyOf,
  type AssetDto,
  type DeviceDto,
  type HealthSummary,
  type IncidentDto,
  type IncidentPlace,
  type InviteDto,
  type LogEntryDto,
  type OutputStatusDto,
  type PairingRequestDto,
  type ProductionChangesDto,
  type ProductionDto,
  type ProductionEvent,
  type ProductionState,
  type SceneDto,
  type SceneHealth,
  type SourceDto,
  type SourceKind,
  type SourceStatus,
  type TallyState,
  type TransitionDto,
} from '@studioflow/scene-model';
import { ApiError } from '../api/api-error';
import { StudioApiService } from '../api/studio-api.service';
import { AuthService } from '../auth/auth.service';
import { BROWSER_STORAGE } from '../ui/preferences.service';
import { STUDIO_HUB_FACTORY, type StudioHub } from './studio-hub';
import { exposeTestHook, testHooksEnabled } from './test-hooks';

/** A program switch that arrived as a live event (not from a snapshot): drives transitions, the flash and toasts. */
export interface ProgramSwitchNotice {
  /** Increments with every switch, so equal consecutive switches are distinguishable. */
  readonly seq: number;
  readonly programSceneId: string | null;
  readonly previousProgramSceneId: string | null;
  readonly previewSceneId: string | null;
  readonly transition: TransitionDto;
  /** Server time of the switch (ISO). */
  readonly at: string;
  /** Local `Date.now()` when the event was applied. */
  readonly receivedAt: number;
}

/** Listener for every state change with its cause (see `SyncCause` of `@studioflow/realtime-client`). */
export type StoreChangeListener = (state: ProductionState, cause: SyncCause) => void;

/** What the last subscribe answer carried: missed events (`delta`) or a full `snapshot`; null before the first one. */
export type LastSyncKind = 'delta' | 'snapshot' | null;

/**
 * `window.__sfStudio` (spec 12, docs/testing.md 1.7): read-only view for the E2E tests, only with the opt-in flag
 * `localStorage['studioflow.testHooks'] = '1'`.
 */
export interface StudioTestHook {
  /** Revision of the local state, null before the first snapshot. */
  readonly revision: number | null;
  /** Kind of the last subscribe answer. */
  readonly lastSync: LastSyncKind;
  /** State of the hub connection. */
  readonly hub: HubState;
}

const EMPTY_LIST: readonly never[] = [];
const EMPTY_MAP: ReadonlyMap<string, never> = new Map<string, never>();
const NO_HEALTH: HealthSummary = { active: 0, bad: false, text: 'Stationen …' };

/** Wait before asking for the active production again after a failure, at least this long. */
const MIN_DISCOVERY_RETRY_MS = 1000;
/** Discovery message when no production is active. */
const NO_ACTIVE_PRODUCTION = 'Keine aktive Produktion gefunden.';

function incidentSeverity(incident: IncidentDto): number {
  return incident.kind === 'reconnecting' ? 1 : 2;
}

/**
 * Prototype `sortedIncidents`: open incidents before recovered ones, red before amber, then the oldest first.
 */
export function sortIncidents(incidents: readonly IncidentDto[]): IncidentDto[] {
  const started = (incident: IncidentDto): number => Date.parse(incident.startedAt) || 0;
  return [...incidents].sort(
    (a, b) =>
      (a.endedAt ? 1 : 0) - (b.endedAt ? 1 : 0) ||
      incidentSeverity(b) - incidentSeverity(a) ||
      started(a) - started(b),
  );
}

/**
 * The single source of truth of the Regie (spec 9.1): discovers the active production (`GET /api/productions/active`),
 * keeps `/hubs/studio` connected forever (`ResilientHub`) and the production state in sync (`ProductionSync` with
 * `Subscribe(productionId, since)`), and exposes everything as signals. All derived data is a `computed`, so
 * components read e.g. `store.programScene()` and update automatically (zoneless: every hub callback writes signals).
 *
 * Lifecycle: {@link start} (idempotent) is called by the pages that need live data; signing out stops it. On
 * `resync` the store follows the active production, and when `Subscribe` answers `not_found` (the production was
 * deleted or deactivated while this Regie was away) it asks for the active production again instead of retrying the
 * old id forever. A failing subscribe (e.g. `service_unavailable` during a short database outage) is retried with the
 * shared backoff and never toasted. While the hub is not connected the last state stays visible (`status()` is
 * `offline`) and {@link canCommand} is false, so commands that need the server are disabled.
 *
 * The lookup methods (`sceneById`, `sourceById`, …) read the state signal and can be used inside `computed`.
 */
@Injectable({ providedIn: 'root' })
export class ProductionStoreService {
  private readonly api = inject(StudioApiService);
  private readonly auth = inject(AuthService);
  private readonly hubFactory = inject(STUDIO_HUB_FACTORY);
  private readonly storage = inject(BROWSER_STORAGE);
  private readonly document = inject(DOCUMENT);
  private readonly changeListeners = new Set<StoreChangeListener>();

  private hub: StudioHub | null = null;
  private sync: ProductionSync<ProductionChangesDto> | null = null;
  private disposers: (() => void)[] = [];
  private discoveryTimer: ReturnType<typeof setTimeout> | null = null;
  private discoveryAttempt = 0;
  private rediscovering = false;
  private running = false;
  /** Incremented on every start/stop; async continuations of older runs are ignored. */
  private run = 0;
  private switchSeq = 0;

  private readonly productionIdSignal = signal<string | null>(null);
  private readonly stateSignal = signal<ProductionState | null>(null);
  private readonly statusSignal = signal<SyncStatus>('connecting');
  private readonly hubStateSignal = signal<HubState>('idle');
  private readonly discoveryErrorSignal = signal<string | null>(null);
  private readonly programSwitchSignal = signal<ProgramSwitchNotice | null>(null);
  private readonly lastSyncAtSignal = signal<number | null>(null);
  private readonly lastSyncKindSignal = signal<LastSyncKind>(null);

  /** Id of the production the Regie follows (the active one), or null before discovery. */
  readonly productionId = this.productionIdSignal.asReadonly();
  /** Immutable production state; null until the first snapshot. Stays (stale) while offline. */
  readonly state = this.stateSignal.asReadonly();
  /** Sync status: `connecting` → `syncing` → `live`; `offline` while the hub reconnects; `unauthorized`. */
  readonly status = this.statusSignal.asReadonly();
  /** State of the hub connection. */
  readonly hubState = this.hubStateSignal.asReadonly();
  /** German text when the active production cannot be found (e.g. «Keine aktive Produktion»), else null. */
  readonly discoveryError = this.discoveryErrorSignal.asReadonly();
  /** The last program switch that arrived as a live event (null after snapshots). */
  readonly programSwitch = this.programSwitchSignal.asReadonly();
  /** Local time of the last applied subscribe answer. */
  readonly lastSyncAt = this.lastSyncAtSignal.asReadonly();
  /** Kind of the last subscribe answer (`delta` or `snapshot`). */
  readonly lastSyncKind = this.lastSyncKindSignal.asReadonly();

  /** The hub is connected. */
  readonly online = computed(() => this.hubStateSignal() === 'connected');
  /** Connected and up to date. */
  readonly live = computed(() => this.statusSignal() === 'live');
  /** Commands that need the server may run: connected and a state is loaded. */
  readonly canCommand = computed(() => this.online() && this.stateSignal() !== null);

  /** The production (settings, broadcast, program/preview, slates). */
  readonly production = computed<ProductionDto | null>(
    () => this.stateSignal()?.production ?? null,
  );
  /** Broadcast state; `standby` before the first snapshot. */
  readonly broadcast = computed(() => this.production()?.broadcast ?? 'standby');
  /** Scenes in list order. */
  readonly scenes = computed<readonly SceneDto[]>(() => this.stateSignal()?.scenes ?? EMPTY_LIST);
  /** Id of the scene on air. */
  readonly programSceneId = computed(() => this.production()?.programSceneId ?? null);
  /** Id of the preview scene (Studio-Modus), or null. */
  readonly previewSceneId = computed(() => this.production()?.previewSceneId ?? null);
  /** The scene on air. */
  readonly programScene = computed(() => this.sceneById(this.programSceneId()));
  /** The preview scene, or null. */
  readonly previewScene = computed(() => this.sceneById(this.previewSceneId()));
  /** Sources by reference (`{deviceId}/{slot}` or `{assetId}`). */
  readonly sources = computed<ReadonlyMap<string, SourceDto>>(
    () => this.stateSignal()?.sources ?? EMPTY_MAP,
  );
  /** Devices by id. */
  readonly devices = computed<ReadonlyMap<string, DeviceDto>>(
    () => this.stateSignal()?.devices ?? EMPTY_MAP,
  );
  /** Devices in the order of the Stationen dock (prototype `stationOrder`). */
  readonly stations = computed<readonly DeviceDto[]>(() => {
    const state = this.stateSignal();
    return state ? [...state.devices.values()].sort(stationOrder(state)) : EMPTY_LIST;
  });
  /** Uploaded media by id. */
  readonly assets = computed<ReadonlyMap<string, AssetDto>>(
    () => this.stateSignal()?.assets ?? EMPTY_MAP,
  );
  /** Pending knocks, oldest first. */
  readonly pairingRequests = computed<readonly PairingRequestDto[]>(
    () => this.stateSignal()?.pairingRequests ?? EMPTY_LIST,
  );
  /** Valid invites (phone QR and laptop links). */
  readonly invites = computed<readonly InviteDto[]>(
    () => this.stateSignal()?.invites ?? EMPTY_LIST,
  );
  /** Open and recovered (not yet acknowledged) incidents in insertion order. */
  readonly incidents = computed<readonly IncidentDto[]>(
    () => this.stateSignal()?.incidents ?? EMPTY_LIST,
  );
  /** Incidents without `endedAt`. */
  readonly openIncidents = computed(() =>
    this.incidents().filter((incident) => incident.endedAt === null),
  );
  /** Incidents in the order of the message strip (open, red first, oldest first; recovered last). */
  readonly sortedIncidents = computed(() => sortIncidents(this.incidents()));
  /** The incident the health chip jumps to, or null. */
  readonly mostSevereIncident = computed(() => this.sortedIncidents()[0] ?? null);
  /** State of the output consumer (proxy). */
  readonly outputStatus = computed<OutputStatusDto | null>(
    () => this.stateSignal()?.outputStatus ?? null,
  );
  /** «Letzte Ereignisse», newest first. */
  readonly log = computed<readonly LogEntryDto[]>(() => this.stateSignal()?.log ?? EMPTY_LIST);
  /** Number of connected Regie sessions (including this one). */
  readonly operatorsOnline = computed(() => this.stateSignal()?.operatorsOnline ?? 0);
  /** Header chip text and colour («Alle 5 Stationen ok», «2 Störungen»). */
  readonly healthSummary = computed<HealthSummary>(() => {
    const state = this.stateSignal();
    return state ? healthSummary(state) : NO_HEALTH;
  });
  /** Worst outage per scene id (scene list «K2 gestört»); scenes without an outage are missing. */
  readonly sceneHealthById = computed<ReadonlyMap<string, SceneHealth>>(() => {
    const sources = this.sources();
    const result = new Map<string, SceneHealth>();
    for (const scene of this.scenes()) {
      const health = sceneHealth(scene, sources);
      if (health) {
        result.set(scene.id, health);
      }
    }
    return result;
  });

  constructor() {
    const unregister = this.auth.onSignedOut(() => this.stop());
    const removeTestHook = this.installTestHook();
    inject(DestroyRef).onDestroy(() => {
      unregister();
      removeTestHook();
      this.stop();
    });
  }

  /** Starts discovery, hub and sync. Idempotent; called by the pages that need live data. */
  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    this.run += 1;
    this.discoveryAttempt = 0;
    this.statusSignal.set('connecting');
    void this.discover(this.run);
  }

  /** Stops hub and sync and forgets the state (sign-out). */
  stop(): void {
    if (!this.running) {
      return;
    }
    this.running = false;
    this.run += 1;
    if (this.discoveryTimer !== null) {
      clearTimeout(this.discoveryTimer);
      this.discoveryTimer = null;
    }
    for (const dispose of this.disposers) {
      dispose();
    }
    this.disposers = [];
    this.sync?.stop();
    this.sync = null;
    void this.hub?.stop();
    this.hub = null;
    this.stateSignal.set(null);
    this.productionIdSignal.set(null);
    this.statusSignal.set('connecting');
    this.hubStateSignal.set('idle');
    this.discoveryErrorSignal.set(null);
    this.programSwitchSignal.set(null);
    this.lastSyncKindSignal.set(null);
  }

  /** Forces a full snapshot («Neu laden»). Resolves when it was applied; never rejects. */
  async resync(): Promise<void> {
    try {
      await this.sync?.resync();
    } catch {
      // Stopped meanwhile.
    }
  }

  /**
   * Makes another production the active one (`activate`); every Regie receives `resync` and follows. The store also
   * follows directly in case the hub message is missed. Rejects with an ApiError.
   */
  async switchProduction(productionId: string): Promise<void> {
    await this.api.activateProduction(productionId);
    if (this.productionIdSignal() !== productionId) {
      this.productionIdSignal.set(productionId);
      void this.resync();
    }
  }

  /** Notifies about every state change with its cause; returns the unsubscribe function. */
  onChange(listener: StoreChangeListener): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  // ---------------------------------------------------------------- Lookups (reactive)

  /** Scene by id, or null. */
  sceneById(sceneId: string | null | undefined): SceneDto | null {
    return sceneId ? (this.scenes().find((scene) => scene.id === sceneId) ?? null) : null;
  }

  /** Source by reference, or null («Quelle fehlt»). */
  sourceById(sourceId: string | null | undefined): SourceDto | null {
    return sourceId ? (this.sources().get(sourceId) ?? null) : null;
  }

  /** Device by id, or null. */
  deviceById(deviceId: string | null | undefined): DeviceDto | null {
    return deviceId ? (this.devices().get(deviceId) ?? null) : null;
  }

  /** Asset by id, or null. */
  assetById(assetId: string | null | undefined): AssetDto | null {
    return assetId ? (this.assets().get(assetId) ?? null) : null;
  }

  /** Kind of a source (camera, screen, image, video), or undefined for deleted sources. */
  kindOf(sourceId: string): SourceKind | undefined {
    return this.sources().get(sourceId)?.kind;
  }

  /** Display name of a source; «Quelle fehlt» when it was deleted. */
  sourceLabel(sourceId: string): string {
    return this.sources().get(sourceId)?.label ?? 'Quelle fehlt';
  }

  /** Slot code of a source (K1, S2, M3), or undefined. */
  codeOf(sourceId: string): string | undefined {
    return this.sources().get(sourceId)?.code;
  }

  /** Health of a source for the renderer's monitor alerts; undefined for deleted sources. */
  statusOf(sourceId: string): SourceStatus | undefined {
    return this.sources().get(sourceId)?.status;
  }

  /** Sources (slots) of a device, sorted by code. */
  deviceSources(deviceId: string): SourceDto[] {
    return [...this.sources().values()]
      .filter((source) => source.deviceId === deviceId)
      .sort((a, b) => a.code.localeCompare(b.code, 'de-CH', { numeric: true }));
  }

  /** Incident of a source (open or recovered), or null. */
  incidentOf(sourceId: string): IncidentDto | null {
    return this.incidents().find((incident) => incident.sourceId === sourceId) ?? null;
  }

  /** PGM/PVW tally of a source in the Regie. */
  tallyOf(sourceId: string): TallyState {
    const state = this.stateSignal();
    return state ? tallyOf(state, sourceId) : 'off';
  }

  /** Where the source is on air: `program`, `preview` or `off` (words: `incidentPlaceWord`). */
  incidentPlace(sourceId: string): IncidentPlace {
    const state = this.stateSignal();
    return state ? incidentPlace(state, sourceId) : 'off';
  }

  /** Current server time in ms (corrected by the offset of the last snapshot). Not reactive by itself. */
  serverNow(localNowMs = Date.now()): number {
    const state = this.stateSignal();
    return state ? serverNow(state, localNowMs) : localNowMs;
  }

  /**
   * Milliseconds since a server timestamp, for timers. Pass `ClockService.now()` to make the value tick once per
   * second inside a template or computed. Unparsable or missing timestamps give 0.
   */
  elapsedSince(iso: string | null | undefined, localNowMs = Date.now()): number {
    const time = iso ? Date.parse(iso) : Number.NaN;
    return Number.isNaN(time) ? 0 : Math.max(0, this.serverNow(localNowMs) - time);
  }

  // ---------------------------------------------------------------- Internals

  /** Installs `window.__sfStudio` when the opt-in flag is set; returns the function that removes it. */
  private installTestHook(): () => void {
    if (!testHooksEnabled(this.storage)) {
      return () => undefined;
    }
    const revision = () => this.stateSignal()?.revision ?? null;
    const lastSync = () => this.lastSyncKindSignal();
    const hub = () => this.hubStateSignal();
    const view: StudioTestHook = {
      get revision() {
        return revision();
      },
      get lastSync() {
        return lastSync();
      },
      get hub() {
        return hub();
      },
    };
    return exposeTestHook(this.document.defaultView, '__sfStudio', view);
  }

  private async discover(run: number): Promise<void> {
    try {
      const active = await this.api.getActiveProduction();
      if (run !== this.run) {
        return;
      }
      this.discoveryErrorSignal.set(null);
      this.connect(run, active.id);
    } catch (error) {
      if (run !== this.run) {
        return;
      }
      const apiError = ApiError.from(error);
      if (apiError.status === 401) {
        // The auth interceptor already sends the operator to the login page.
        return;
      }
      this.discoveryErrorSignal.set(
        apiError.status === 404
          ? NO_ACTIVE_PRODUCTION
          : 'Der Server ist nicht erreichbar. Die Regie verbindet neu …',
      );
      this.statusSignal.set('connecting');
      this.discoveryAttempt += 1;
      const delay = Math.max(MIN_DISCOVERY_RETRY_MS, backoffDelay(this.discoveryAttempt));
      this.discoveryTimer = setTimeout(() => {
        this.discoveryTimer = null;
        if (run === this.run) {
          void this.discover(run);
        }
      }, delay);
    }
  }

  private connect(run: number, productionId: string): void {
    this.productionIdSignal.set(productionId);
    const hub = this.hubFactory();
    this.hub = hub;
    this.disposers.push(
      hub.onStateChange((state) => {
        if (run !== this.run) {
          return;
        }
        this.hubStateSignal.set(state);
        if (state === 'unauthorized') {
          this.auth.handleUnauthorized();
        }
      }),
      // Registered before the sync's own handler: the sync then resubscribes with the new production id.
      hub.on(HUB.resync, (payload) => {
        if (run === this.run && typeof payload === 'string' && payload) {
          this.productionIdSignal.set(payload);
        }
      }),
    );
    const sync = new ProductionSync<ProductionChangesDto>({
      hub,
      subscribe: (since) => this.subscribe(run, hub, since),
      apply: applyChanges,
    });
    this.sync = sync;
    this.disposers.push(
      sync.onChange((state, cause) => {
        if (run === this.run) {
          this.applyChange(state, cause);
        }
      }),
      sync.onStatus((status) => {
        if (run !== this.run) {
          return;
        }
        this.statusSignal.set(status);
        this.lastSyncAtSignal.set(sync.lastSyncAt);
      }),
    );
    this.hubStateSignal.set(hub.state);
    sync.start();
    hub.start();
  }

  /** `Subscribe(productionId, since)`; a `not_found` answer starts {@link rediscover} (the sync retries meanwhile). */
  private async subscribe(
    run: number,
    hub: StudioHub,
    since: number | null,
  ): Promise<ProductionChangesDto> {
    try {
      const changes = await hub.invoke<ProductionChangesDto>(
        HUB.subscribe,
        this.productionIdSignal(),
        since,
      );
      if (run === this.run) {
        this.lastSyncKindSignal.set(changes.snapshot ? 'snapshot' : 'delta');
      }
      return changes;
    } catch (error) {
      if (run === this.run && hubErrorCode(error) === ERROR_CODES.notFound) {
        void this.rediscover(run);
      }
      throw error;
    }
  }

  /**
   * The followed production does not exist (any more): asks for the active one and, when it is another one, follows it
   * with a fresh snapshot (the local revision belongs to the old production). Without an active production the strip
   * says so; the next `not_found` of the retrying sync asks again.
   */
  private async rediscover(run: number): Promise<void> {
    if (this.rediscovering) {
      return;
    }
    this.rediscovering = true;
    try {
      const active = await this.api.getActiveProduction();
      if (run !== this.run) {
        return;
      }
      this.discoveryErrorSignal.set(null);
      if (active.id !== this.productionIdSignal()) {
        this.productionIdSignal.set(active.id);
        void this.resync();
      }
    } catch (error) {
      if (run === this.run && ApiError.from(error).status === 404) {
        this.discoveryErrorSignal.set(NO_ACTIVE_PRODUCTION);
      }
    } finally {
      this.rediscovering = false;
    }
  }

  private applyChange(state: ProductionState, cause: SyncCause): void {
    const previousProgram = this.stateSignal()?.production.programSceneId ?? null;
    this.stateSignal.set(state);
    if (cause.kind === 'snapshot') {
      this.discoveryErrorSignal.set(null);
      this.lastSyncAtSignal.set(this.sync?.lastSyncAt ?? Date.now());
      if (state.production.id !== this.productionIdSignal()) {
        this.productionIdSignal.set(state.production.id);
      }
    }
    if (cause.kind === 'event') {
      this.noteEvent(cause.event, previousProgram);
    }
    for (const listener of [...this.changeListeners]) {
      try {
        listener(state, cause);
      } catch (error) {
        console.warn('[StudioFlow] store listener failed', error);
      }
    }
  }

  private noteEvent(event: ProductionEvent, previousProgram: string | null): void {
    if (event.type !== 'programSwitched' || event.programSceneId === previousProgram) {
      // Not a switch, or only the preview changed.
      return;
    }
    this.switchSeq += 1;
    this.programSwitchSignal.set({
      seq: this.switchSeq,
      programSceneId: event.programSceneId,
      previousProgramSceneId: event.previousProgramSceneId ?? previousProgram,
      previewSceneId: event.previewSceneId,
      transition: event.transition,
      at: event.at,
      receivedAt: Date.now(),
    });
  }
}
