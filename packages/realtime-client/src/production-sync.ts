import { LogLevel, type ILogger } from '@microsoft/signalr';
import {
  HUB,
  applyEvent,
  applyPresence,
  applyTelemetry,
  type ChangesApplication,
  type DeviceTelemetryMessage,
  type EventResult,
  type OutputChangesDto,
  type ProductionChangesDto,
  type ProductionEvent,
  type ProductionState,
} from '@studioflow/scene-model';
import { defaultSchedule, promiseFrom, type Schedule } from './async';
import { backoffDelay } from './backoff';
import { consoleLogger, describeError, logSafely } from './logging';
import type { HubHandler, HubState } from './resilient-hub';

/**
 * Sync status for banners and the debug overlay:
 * - `connecting`: no state yet and no connection;
 * - `syncing`: connected, a subscribe is running or pending (first snapshot, gap, resync);
 * - `live`: connected and up to date;
 * - `offline`: connection lost (or sync stopped); the last state stays available and is shown stale;
 * - `unauthorized`: the hub refused the credentials.
 */
export type SyncStatus = 'connecting' | 'syncing' | 'live' | 'offline' | 'unauthorized';

/**
 * Why the state changed:
 * - `snapshot`: a subscribe answer (full snapshot or catch-up delta) replaced the state; render without transitions;
 * - `event`: one live event was applied (play transitions for `programSwitched`);
 * - `telemetry`: the telemetry of one device changed;
 * - `presence`: the number of connected Regie sessions changed.
 */
export type SyncCause =
  | { readonly kind: 'snapshot' }
  | { readonly kind: 'event'; readonly event: ProductionEvent }
  | { readonly kind: 'telemetry'; readonly deviceId: string }
  | { readonly kind: 'presence' };

/** The part of {@link ResilientHub} the sync needs. */
export interface SyncHub {
  readonly state: HubState;
  on(method: string, handler: HubHandler): () => void;
  onConnected(listener: () => void): () => void;
  onStateChange(listener: (state: HubState) => void): () => void;
}

/** Options of a {@link ProductionSync}. */
export interface ProductionSyncOptions<TChanges> {
  /** Hub whose lifecycle the caller owns (start/stop); the sync only listens. */
  readonly hub: SyncHub;
  /** Calls `Subscribe(productionId, sinceRevision)` or `SubscribeOutput(sinceRevision)`; null asks for a snapshot. */
  readonly subscribe: (sinceRevision: number | null) => Promise<TChanges>;
  /** Reducer for subscribe answers: `applyChanges` (Regie) or `applyOutputChanges` (output). */
  readonly apply: (
    state: ProductionState | null,
    changes: TChanges,
    receivedAtMs: number,
  ) => ChangesApplication;
  /** Default: console, warnings and errors. */
  readonly logger?: ILogger;
  /** Clock for `receivedAtMs` and {@link ProductionSync.lastSyncAt}; default `Date.now`. */
  readonly now?: () => number;
  /** Timer for subscribe retries; default `setTimeout`. */
  readonly schedule?: Schedule;
  /** Random source for the backoff jitter; default `Math.random`. */
  readonly random?: () => number;
}

/** Listener for state changes. */
export type SyncChangeListener = (state: ProductionState, cause: SyncCause) => void;

/**
 * Events kept while a subscribe is running; beyond this the buffer is dropped and a snapshot requested, so a flood
 * during a slow subscribe cannot grow memory without bound.
 */
const MAX_BUFFERED_EVENTS = 1000;

interface Waiter {
  readonly resolve: () => void;
  readonly reject: (error: Error) => void;
}

interface PendingRetry {
  cancel: () => void;
}

function isProductionEvent(value: unknown): value is ProductionEvent {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    typeof value.type === 'string' &&
    'revision' in value &&
    Number.isSafeInteger(value.revision)
  );
}

function isTelemetryMessage(value: unknown): value is DeviceTelemetryMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    'deviceId' in value &&
    typeof value.deviceId === 'string' &&
    'telemetry' in value &&
    typeof value.telemetry === 'object' &&
    value.telemetry !== null
  );
}

/**
 * Keeps a {@link ProductionState} in sync over a hub (spec 6, 8.2), for the Regie (`ProductionChangesDto`) and the
 * output page (`OutputChangesDto`):
 * - after every (re)connect it subscribes with the local revision (delta) or null (snapshot);
 * - live `event`s apply when their revision is exactly one above the local one, duplicates are ignored and a gap
 *   triggers a resubscribe with the local revision;
 * - events that arrive while a subscribe runs are buffered and applied afterwards in revision order, already covered
 *   ones are dropped; concurrent resubscribe requests are coalesced into one follow-up subscribe;
 * - `resync` forces a snapshot, `telemetry` and `presence` update the state without a revision;
 * - a failed subscribe is retried with the shared backoff while connected.
 * The state stays available while offline.
 */
export class ProductionSync<TChanges extends ProductionChangesDto | OutputChangesDto> {
  private current: ProductionState | null = null;
  private syncStatus: SyncStatus = 'offline';
  private lastSync: number | null = null;
  private running = false;
  private disposers: (() => void)[] = [];
  /** The current connection has a server-side subscription (a subscribe answered since it connected). */
  private subscribed = false;
  /** `sinceRevision` of the running subscribe call (null = snapshot). */
  private inFlightSince: number | null = null;
  /** Incremented per subscribe call; answers of superseded calls are dropped. */
  private subscribeToken = 0;
  private inFlight = false;
  /** True while a subscribe answer is being applied (listeners may re-enter). */
  private processing = false;
  /** Another subscribe is needed after the running one. */
  private again = false;
  /** The next subscribe must ask for a snapshot. */
  private forceSnapshot = false;
  private buffer: ProductionEvent[] = [];
  private retryAttempts = 0;
  private pendingRetry: PendingRetry | null = null;
  /** `resync()` callers waiting for the next snapshot subscribe to start. */
  private pendingWaiters: Waiter[] = [];
  /** `resync()` callers waiting for the running snapshot subscribe. */
  private activeWaiters: Waiter[] = [];
  private readonly changeListeners = new Set<SyncChangeListener>();
  private readonly statusListeners = new Set<(status: SyncStatus) => void>();
  private readonly logger: ILogger;
  private readonly now: () => number;
  private readonly schedule: Schedule;

  constructor(private readonly options: ProductionSyncOptions<TChanges>) {
    this.logger = options.logger ?? consoleLogger(LogLevel.Warning);
    this.now = options.now ?? (() => Date.now());
    this.schedule = options.schedule ?? defaultSchedule;
  }

  /** Latest known state; null until the first snapshot. Stays available (stale) while offline and after stop. */
  get state(): ProductionState | null {
    return this.current;
  }

  /** Current {@link SyncStatus}. */
  get status(): SyncStatus {
    return this.syncStatus;
  }

  /** Time (from `now`) of the last applied subscribe answer, or null. */
  get lastSyncAt(): number | null {
    return this.lastSync;
  }

  /** Starts listening to the hub (and subscribes right away if it is connected). Idempotent. */
  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    const { hub } = this.options;
    this.disposers = [
      hub.on(HUB.event, (payload) => this.handleEvent(payload)),
      hub.on(HUB.resync, () => this.requestSubscribe(true)),
      hub.on(HUB.telemetry, (payload) => this.handleTelemetry(payload)),
      hub.on(HUB.presence, (payload) => this.handlePresence(payload)),
      hub.onConnected(() => this.handleConnected()),
      hub.onStateChange((state) => this.handleHubState(state)),
    ];
    if (hub.state === 'connected') {
      this.handleConnected();
    } else {
      this.updateStatus();
    }
  }

  /** Stops listening; a running subscribe is ignored and pending {@link resync} calls reject. The state is kept. */
  stop(): void {
    if (!this.running) {
      return;
    }
    this.running = false;
    for (const dispose of this.disposers) {
      dispose();
    }
    this.disposers = [];
    this.clearRetry();
    this.subscribed = false;
    this.subscribeToken += 1;
    this.inFlight = false;
    this.again = false;
    this.forceSnapshot = false;
    this.buffer = [];
    const waiters = [...this.activeWaiters, ...this.pendingWaiters];
    this.activeWaiters = [];
    this.pendingWaiters = [];
    for (const waiter of waiters) {
      waiter.reject(new Error('The production sync was stopped.'));
    }
    this.updateStatus();
  }

  /**
   * Forces a full snapshot (manual «Neu laden»). Resolves once a snapshot requested after this call was applied
   * (waiting for the connection if necessary), rejects if the sync is stopped first.
   */
  resync(): Promise<void> {
    if (!this.running) {
      return Promise.reject(new Error('The production sync is not running.'));
    }
    return new Promise<void>((resolve, reject) => {
      this.pendingWaiters.push({ resolve, reject });
      this.requestSubscribe(true);
    });
  }

  /** Notifies about every state change with its cause; returns the unsubscribe function. */
  onChange(listener: SyncChangeListener): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  /** Notifies about every status change; returns the unsubscribe function. */
  onStatus(listener: (status: SyncStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  private handleHubState(state: HubState): void {
    if (state !== 'connected') {
      this.subscribed = false;
    }
    this.updateStatus();
  }

  private handleConnected(): void {
    if (!this.running) {
      return;
    }
    // A new connection has no server-side subscription yet; everything since the local revision comes with the answer.
    this.buffer = [];
    this.clearRetry();
    this.retryAttempts = 0;
    this.subscribeNow();
  }

  private requestSubscribe(snapshot: boolean): void {
    if (!this.running) {
      return;
    }
    if (snapshot) {
      this.forceSnapshot = true;
    }
    if (this.inFlight || this.processing) {
      this.again = true;
      return;
    }
    if (this.options.hub.state !== 'connected') {
      // The next connect subscribes anyway (with forceSnapshot still set).
      this.updateStatus();
      return;
    }
    this.clearRetry();
    this.subscribeNow();
  }

  private subscribeNow(): void {
    this.releaseSupersededCall();
    const since = this.forceSnapshot || !this.current ? null : this.current.revision;
    this.forceSnapshot = false;
    this.again = false;
    const token = ++this.subscribeToken;
    this.inFlight = true;
    this.inFlightSince = since;
    if (since === null) {
      this.activeWaiters = this.pendingWaiters;
      this.pendingWaiters = [];
    }
    this.updateStatus();
    promiseFrom(() => this.options.subscribe(since))
      .then(
        (changes) => this.handleSubscribed(token, changes),
        (error: unknown) => this.handleSubscribeFailed(token, since, error),
      )
      .catch((error: unknown) => this.logUnexpected('subscribe answer', error));
  }

  /**
   * A subscribe that is replaced before it answered (reconnect) keeps its intent: a snapshot request (e.g. after
   * `resync`, when the active production changed) and its waiters carry over to the next call.
   */
  private releaseSupersededCall(): void {
    if (!this.inFlight) {
      return;
    }
    this.inFlight = false;
    if (this.inFlightSince === null) {
      this.forceSnapshot = true;
      this.restoreActiveWaiters();
    }
  }

  private handleSubscribed(token: number, changes: TChanges): void {
    if (token !== this.subscribeToken || !this.running) {
      return;
    }
    this.inFlight = false;
    let application: ChangesApplication;
    try {
      application = this.options.apply(this.current, changes, this.now());
    } catch (error) {
      logSafely(
        this.logger,
        LogLevel.Warning,
        `Subscribe answer could not be applied: ${describeError(error)}`,
      );
      this.forceSnapshot = true;
      this.restoreActiveWaiters();
      this.scheduleRetry();
      return;
    }
    this.processing = true;
    this.subscribed = this.options.hub.state === 'connected';
    let complete = application.result !== 'gap';
    try {
      this.retryAttempts = 0;
      this.lastSync = this.now();
      const waiters = this.activeWaiters;
      this.activeWaiters = [];
      if (application.state !== this.current) {
        this.current = application.state;
        this.emitChange({ kind: 'snapshot' });
      }
      complete = this.drainBuffer() && complete;
      for (const waiter of waiters) {
        waiter.resolve();
      }
    } finally {
      this.processing = false;
    }
    if (!this.running) {
      return;
    }
    if (!complete || this.again) {
      this.subscribeNow();
    } else {
      this.updateStatus();
    }
  }

  private handleSubscribeFailed(token: number, since: number | null, error: unknown): void {
    if (token !== this.subscribeToken || !this.running) {
      return;
    }
    this.inFlight = false;
    logSafely(this.logger, LogLevel.Warning, `Subscribe failed: ${describeError(error)}`);
    if (since === null) {
      this.forceSnapshot = true;
    }
    this.restoreActiveWaiters();
    if (this.options.hub.state === 'connected') {
      this.scheduleRetry();
    }
    this.updateStatus();
  }

  private restoreActiveWaiters(): void {
    this.pendingWaiters = [...this.activeWaiters, ...this.pendingWaiters];
    this.activeWaiters = [];
  }

  private scheduleRetry(): void {
    this.clearRetry();
    this.retryAttempts += 1;
    const retry: PendingRetry = { cancel: () => undefined };
    this.pendingRetry = retry;
    retry.cancel = this.schedule(
      () => {
        if (this.pendingRetry !== retry) {
          return;
        }
        this.pendingRetry = null;
        if (this.running && this.options.hub.state === 'connected' && !this.inFlight) {
          this.subscribeNow();
        }
      },
      backoffDelay(this.retryAttempts, this.options.random),
    );
    this.updateStatus();
  }

  private clearRetry(): void {
    const retry = this.pendingRetry;
    this.pendingRetry = null;
    retry?.cancel();
  }

  private handleEvent(payload: unknown): void {
    if (!isProductionEvent(payload)) {
      logSafely(this.logger, LogLevel.Warning, 'Ignored a malformed production event.');
      return;
    }
    if (!this.current || this.inFlight || this.processing) {
      this.bufferEvent(payload);
      return;
    }
    if (this.applyLiveEvent(payload) === 'gap') {
      this.bufferEvent(payload);
      this.requestSubscribe(false);
    }
  }

  private bufferEvent(event: ProductionEvent): void {
    if (this.buffer.length >= MAX_BUFFERED_EVENTS) {
      logSafely(
        this.logger,
        LogLevel.Warning,
        'Too many events while subscribing; requesting a snapshot.',
      );
      this.buffer = [];
      this.requestSubscribe(true);
    }
    this.buffer.push(event);
  }

  /**
   * Applies buffered events in revision order after a subscribe answer, dropping covered ones. Returns false when a
   * gap remains (the newer events stay buffered for the next answer).
   */
  private drainBuffer(): boolean {
    const pending = [...this.buffer].sort((a, b) => a.revision - b.revision);
    this.buffer = [];
    for (let index = 0; index < pending.length; index += 1) {
      if (!this.running) {
        return true;
      }
      if (this.applyLiveEvent(pending[index]) === 'gap') {
        const revision = this.current?.revision ?? Number.NEGATIVE_INFINITY;
        this.buffer = pending.slice(index).filter((event) => event.revision > revision);
        return false;
      }
    }
    return true;
  }

  private applyLiveEvent(event: ProductionEvent): EventResult {
    if (!this.current) {
      return 'gap';
    }
    const { state, result } = applyEvent(this.current, event);
    if (result === 'applied') {
      this.current = state;
      this.emitChange({ kind: 'event', event });
    }
    return result;
  }

  private handleTelemetry(payload: unknown): void {
    if (!isTelemetryMessage(payload)) {
      logSafely(this.logger, LogLevel.Warning, 'Ignored a malformed telemetry message.');
      return;
    }
    if (!this.current) {
      return;
    }
    const next = applyTelemetry(this.current, payload);
    if (next !== this.current) {
      this.current = next;
      this.emitChange({ kind: 'telemetry', deviceId: payload.deviceId });
    }
  }

  private handlePresence(payload: unknown): void {
    if (typeof payload !== 'number' || !this.current) {
      return;
    }
    const next = applyPresence(this.current, payload);
    if (next !== this.current) {
      this.current = next;
      this.emitChange({ kind: 'presence' });
    }
  }

  private computeStatus(): SyncStatus {
    const hubState = this.options.hub.state;
    if (hubState === 'unauthorized') {
      return 'unauthorized';
    }
    if (!this.running) {
      return 'offline';
    }
    if (hubState !== 'connected') {
      return this.current ? 'offline' : 'connecting';
    }
    const upToDate =
      this.subscribed &&
      this.current !== null &&
      !this.inFlight &&
      !this.processing &&
      !this.again &&
      this.pendingRetry === null;
    return upToDate ? 'live' : 'syncing';
  }

  private updateStatus(): void {
    const next = this.computeStatus();
    if (next === this.syncStatus) {
      return;
    }
    this.syncStatus = next;
    for (const listener of [...this.statusListeners]) {
      if (this.syncStatus !== next) {
        break;
      }
      this.guard('status listener', () => listener(next));
    }
  }

  private emitChange(cause: SyncCause): void {
    const state = this.current;
    if (!state) {
      return;
    }
    for (const listener of [...this.changeListeners]) {
      this.guard('change listener', () => listener(state, cause));
    }
  }

  private guard(context: string, callback: () => void): void {
    try {
      callback();
    } catch (error) {
      this.logUnexpected(context, error);
    }
  }

  private logUnexpected(context: string, error: unknown): void {
    logSafely(
      this.logger,
      LogLevel.Error,
      `Unexpected error in ${context}: ${describeError(error)}`,
    );
  }
}
