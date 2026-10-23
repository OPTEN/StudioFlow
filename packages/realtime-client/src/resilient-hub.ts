import { HubConnectionState, LogLevel, type ILogger } from '@microsoft/signalr';
import { defaultSchedule, isPromiseLike, promiseFrom, type Schedule } from './async';
import { backoffDelay } from './backoff';
import {
  createHubConnection,
  isUnauthorizedError,
  type HubConnectionOptions,
} from './hub-connection';
import { consoleLogger, describeError, logSafely } from './logging';
import { browserWakeSignals, type WakeSignals } from './wake-signals';

/**
 * State of a {@link ResilientHub}:
 * - `idle`: created, `start()` not called yet;
 * - `connecting`: no connection yet, attempts are running (also between attempts);
 * - `connected`: connected, `invoke`/`send` work;
 * - `reconnecting`: a connection existed and was lost; attempts are running;
 * - `unauthorized`: the server refused the credentials (401/403); no more attempts until `restart()`;
 * - `stopped`: stopped on purpose (`stop()` or `markTerminal('stopped')`); no more attempts until `restart()`.
 */
export type HubState =
  'idle' | 'connecting' | 'connected' | 'reconnecting' | 'unauthorized' | 'stopped';

/** States in which the hub makes no further connection attempts. */
export type TerminalHubState = Extract<HubState, 'stopped' | 'unauthorized'>;

/** Handler for a server → client hub method; arguments are unchecked wire data. */
export type HubHandler = (...args: unknown[]) => void;

/**
 * The part of SignalR's `HubConnection` the hub uses. `@microsoft/signalr`'s `HubConnection` satisfies it; tests pass
 * fakes through {@link ResilientHubOptions.connectionFactory}.
 */
export interface HubConnectionLike {
  readonly state: HubConnectionState;
  start(): Promise<void>;
  stop(): Promise<void>;
  on(method: string, handler: HubHandler): void;
  off(method: string, handler: HubHandler): void;
  invoke<T>(method: string, ...args: unknown[]): Promise<T>;
  send(method: string, ...args: unknown[]): Promise<void>;
  onreconnecting(callback: (error?: Error) => void): void;
  onreconnected(callback: (connectionId?: string) => void): void;
  onclose(callback: (error?: Error) => void): void;
}

/** Options of a {@link ResilientHub}. */
export interface ResilientHubOptions extends HubConnectionOptions {
  /** Creates a connection; default {@link createHubConnection}. Called again for every fresh connection. */
  readonly connectionFactory?: (options: HubConnectionOptions) => HubConnectionLike;
  /** Clock for the connection stability check; default `Date.now`. */
  readonly now?: () => number;
  /** Timer for the retry delays; default `setTimeout`. */
  readonly schedule?: Schedule;
  /** Events that cut a retry wait short; default {@link browserWakeSignals}. */
  readonly wakeSignals?: WakeSignals;
  /** Random source for the backoff jitter; default `Math.random`. */
  readonly random?: () => number;
}

/** Rejection of {@link ResilientHub.invoke} and {@link ResilientHub.send} while the hub is not connected. */
export class HubNotConnectedError extends Error {
  override readonly name = 'HubNotConnectedError';
  /** The hub method that could not be called. */
  readonly method: string;
  /** The hub state at the time of the call. */
  readonly state: HubState;

  constructor(method: string, state: HubState) {
    super(`Hub method ${method} needs a connection, but the hub is ${state}.`);
    this.method = method;
    this.state = state;
  }
}

/**
 * A connection must stay up this long before the backoff starts from the beginning again; protects against a server
 * that accepts and immediately closes connections (no tight reconnect loop).
 */
const STABLE_CONNECTION_MS = 10_000;

interface HandlerEntry {
  readonly handler: HubHandler;
}

interface PendingRetry {
  cancel: () => void;
}

/**
 * SignalR connection that never gives up (spec 6, 8.2). SignalR's automatic reconnect (endless policy) handles short
 * outages on the same connection; when SignalR closes the connection anyway (server close, policy stop, failed first
 * start) the hub starts fresh connections with the shared backoff until it is connected again. `online` and
 * `visibilitychange` cut every wait short. A 401/403 ends all attempts in state `unauthorized`.
 *
 * Handlers registered with {@link on} survive reconnects and connection replacements and may be registered before
 * {@link start}. Handlers of one method run in registration order; a throwing handler is logged and does not affect
 * the others.
 */
export class ResilientHub {
  private hubState: HubState = 'idle';
  private connection: HubConnectionLike | null = null;
  /** Incremented whenever the current connection is replaced or dropped; callbacks of older connections are ignored. */
  private generation = 0;
  /** True from the moment the current connection's `start()` resolved until it closes. */
  private open = false;
  private failures = 0;
  private connectedAt: number | null = null;
  private pendingRetry: PendingRetry | null = null;
  private disposeWakeSignals: (() => void) | null = null;
  private readonly handlers = new Map<string, Set<HandlerEntry>>();
  /** Dispatchers registered on the current connection, per lower-cased method name. */
  private attached = new Map<string, HubHandler>();
  private readonly stateListeners = new Set<(state: HubState) => void>();
  private readonly connectedListeners = new Set<() => void>();
  private readonly logger: ILogger;
  private readonly now: () => number;
  private readonly schedule: Schedule;

  constructor(private readonly options: ResilientHubOptions) {
    this.logger = options.logger ?? consoleLogger(LogLevel.Warning);
    this.now = options.now ?? (() => Date.now());
    this.schedule = options.schedule ?? defaultSchedule;
  }

  /** Current state; see {@link HubState}. */
  get state(): HubState {
    return this.hubState;
  }

  /** Starts the endless connect loop. Only acts in state `idle`; calling it again is a no-op. */
  start(): void {
    if (this.hubState === 'idle') {
      this.begin();
    }
  }

  /**
   * Starts connecting again after `unauthorized` or `stopped` (e.g. after the device was unblocked or “Hier
   * weitermachen”); acts like {@link start} in `idle` and is a no-op while connecting or connected.
   */
  restart(): void {
    if (
      this.hubState === 'idle' ||
      this.hubState === 'stopped' ||
      this.hubState === 'unauthorized'
    ) {
      this.begin();
    }
  }

  /** Stops on purpose: closes the connection, cancels pending attempts and removes the wake listeners. */
  stop(): Promise<void> {
    return this.terminate('stopped');
  }

  /**
   * Ends all connection attempts because the caller learned that reconnecting is pointless: `stopped` for a session
   * replaced by another tab, `unauthorized` for a blocked device. Closes the current connection like {@link stop}.
   */
  markTerminal(state: TerminalHubState): void {
    void this.terminate(state);
  }

  /** Registers a handler for a server → client method; returns the function that removes it again. */
  on(method: string, handler: HubHandler): () => void {
    const key = method.toLowerCase();
    let entries = this.handlers.get(key);
    if (!entries) {
      entries = new Set();
      this.handlers.set(key, entries);
      if (this.connection) {
        this.attach(this.connection, this.generation, key);
      }
    }
    const registered = entries;
    const entry: HandlerEntry = { handler };
    registered.add(entry);
    return () => {
      if (
        !registered.delete(entry) ||
        registered.size > 0 ||
        this.handlers.get(key) !== registered
      ) {
        return;
      }
      this.handlers.delete(key);
      const dispatcher = this.attached.get(key);
      this.attached.delete(key);
      if (dispatcher && this.connection) {
        this.connection.off(key, dispatcher);
      }
    };
  }

  /** Invokes a hub method and waits for its result; rejects with {@link HubNotConnectedError} while not connected. */
  invoke<T>(method: string, ...args: unknown[]): Promise<T> {
    return this.withConnection(method, (connection) => connection.invoke<T>(method, ...args));
  }

  /** Sends a hub method without waiting for a result; rejects with {@link HubNotConnectedError} while not connected. */
  send(method: string, ...args: unknown[]): Promise<void> {
    return this.withConnection(method, (connection) => connection.send(method, ...args));
  }

  /** Notifies about every state change; returns the unsubscribe function. */
  onStateChange(listener: (state: HubState) => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  /**
   * Notifies after the first connect and after every reconnect (SignalR reconnect or fresh connection): the server
   * forgets subscriptions with the connection, so this is where callers (re)subscribe or say `Hello`.
   */
  onConnected(listener: () => void): () => void {
    this.connectedListeners.add(listener);
    return () => this.connectedListeners.delete(listener);
  }

  private begin(): void {
    this.failures = 0;
    this.connectedAt = null;
    this.disposeWakeSignals?.();
    this.disposeWakeSignals = (this.options.wakeSignals ?? browserWakeSignals)(() =>
      this.guard('wake signal', () => this.wake()),
    );
    this.setState('connecting');
    if (this.hubState === 'connecting') {
      this.connect();
    }
  }

  private connect(): void {
    const generation = ++this.generation;
    this.open = false;
    let connection: HubConnectionLike;
    try {
      connection = this.createConnection(generation);
    } catch (error) {
      this.handleStartFailure(generation, error);
      return;
    }
    this.connection = connection;
    promiseFrom(() => connection.start())
      .then(
        () => this.handleStarted(generation, connection),
        (error: unknown) => this.handleStartFailure(generation, error),
      )
      .catch((error: unknown) => this.logUnexpected('connection start', error));
  }

  private createConnection(generation: number): HubConnectionLike {
    const factory = this.options.connectionFactory ?? createHubConnection;
    const connection = factory({
      url: this.options.url,
      accessTokenFactory: this.options.accessTokenFactory,
      logger: this.options.logger,
    });
    const isCurrent = (): boolean => generation === this.generation;
    connection.onreconnecting((error) => {
      if (isCurrent()) {
        this.handleReconnecting(error);
      }
    });
    connection.onreconnected(() => {
      if (isCurrent()) {
        this.handleConnected();
      }
    });
    connection.onclose((error) => {
      if (isCurrent()) {
        this.handleClose(error);
      }
    });
    this.attached = new Map();
    for (const key of this.handlers.keys()) {
      this.attach(connection, generation, key);
    }
    return connection;
  }

  /** Registers the dispatcher of one method on a connection; it only dispatches while that connection is current. */
  private attach(connection: HubConnectionLike, generation: number, key: string): void {
    const dispatcher: HubHandler = (...args) => {
      if (generation === this.generation) {
        this.dispatch(key, args);
      }
    };
    this.attached.set(key, dispatcher);
    connection.on(key, dispatcher);
  }

  private dispatch(key: string, args: unknown[]): void {
    const entries = this.handlers.get(key);
    if (!entries) {
      return;
    }
    for (const { handler } of [...entries]) {
      try {
        const result: unknown = handler(...args);
        if (isPromiseLike(result)) {
          result.then(undefined, (error: unknown) =>
            this.logUnexpected(`handler for ${key}`, error),
          );
        }
      } catch (error) {
        this.logUnexpected(`handler for ${key}`, error);
      }
    }
  }

  private handleStarted(generation: number, connection: HubConnectionLike): void {
    if (generation !== this.generation) {
      // Superseded while starting (stop, wake): this connection must not stay open.
      void this.stopQuietly(connection);
      return;
    }
    this.open = true;
    // The connection may already have dropped between start() resolving and this callback (one microtask).
    switch (connection.state) {
      case HubConnectionState.Connected:
        this.handleConnected();
        return;
      case HubConnectionState.Reconnecting:
        // SignalR already reconnects and reports the outcome through onreconnected / onclose.
        this.setState('reconnecting');
        return;
      default:
        this.handleClose(new Error('The connection closed right after it was established.'));
    }
  }

  private handleConnected(): void {
    this.connectedAt = this.now();
    this.setState('connected');
    for (const listener of [...this.connectedListeners]) {
      if (this.hubState !== 'connected') {
        break;
      }
      this.guard('connected listener', listener);
    }
  }

  private handleReconnecting(error: Error | undefined): void {
    logSafely(
      this.logger,
      LogLevel.Information,
      `Hub connection lost, SignalR reconnects: ${describeError(error)}`,
    );
    this.noteConnectionLost();
    this.setState('reconnecting');
  }

  private handleClose(error: Error | undefined): void {
    if (!this.open) {
      // start() has not resolved yet: its rejection drives the retry.
      return;
    }
    this.open = false;
    this.connection = null;
    if (isUnauthorizedError(error)) {
      logSafely(this.logger, LogLevel.Warning, 'Hub refused the credentials; no further attempts.');
      void this.terminate('unauthorized');
      return;
    }
    logSafely(
      this.logger,
      LogLevel.Information,
      `Hub connection closed: ${describeError(error)}; connecting again.`,
    );
    this.noteConnectionLost();
    this.setState('reconnecting');
    if (this.hubState === 'reconnecting') {
      this.scheduleRetry();
    }
  }

  private handleStartFailure(generation: number, error: unknown): void {
    if (generation !== this.generation) {
      return;
    }
    this.connection = null;
    if (isUnauthorizedError(error)) {
      logSafely(this.logger, LogLevel.Warning, 'Hub refused the credentials; no further attempts.');
      void this.terminate('unauthorized');
      return;
    }
    logSafely(
      this.logger,
      LogLevel.Information,
      `Hub connection attempt failed: ${describeError(error)}`,
    );
    this.scheduleRetry();
  }

  /** Resets the backoff when the connection that was just lost had been stable. */
  private noteConnectionLost(): void {
    if (this.connectedAt !== null && this.now() - this.connectedAt >= STABLE_CONNECTION_MS) {
      this.failures = 0;
    }
    this.connectedAt = null;
  }

  private scheduleRetry(): void {
    this.failures += 1;
    const delay = backoffDelay(this.failures, this.options.random);
    const retry: PendingRetry = { cancel: () => undefined };
    this.pendingRetry = retry;
    retry.cancel = this.schedule(() => {
      if (this.pendingRetry === retry) {
        this.pendingRetry = null;
        this.connect();
      }
    }, delay);
  }

  /** Cancels a pending retry; true if one was pending. */
  private clearRetry(): boolean {
    const retry = this.pendingRetry;
    this.pendingRetry = null;
    retry?.cancel();
    return retry !== null;
  }

  /** `online` / visible again: try right now instead of waiting for the next retry. */
  private wake(): void {
    if (this.clearRetry()) {
      this.connect();
      return;
    }
    if (
      this.hubState === 'reconnecting' &&
      this.open &&
      this.connection?.state === HubConnectionState.Reconnecting
    ) {
      // SignalR waits for its own retry timer; a fresh connection tries immediately.
      void this.abandonConnection();
      this.connect();
    }
  }

  /** Drops the current connection (its callbacks are ignored from now on) and closes it. */
  private abandonConnection(): Promise<void> {
    const connection = this.connection;
    this.generation += 1;
    this.connection = null;
    this.open = false;
    return connection ? this.stopQuietly(connection) : Promise.resolve();
  }

  private terminate(state: TerminalHubState): Promise<void> {
    this.clearRetry();
    this.disposeWakeSignals?.();
    this.disposeWakeSignals = null;
    this.connectedAt = null;
    const stopped = this.abandonConnection();
    this.setState(state);
    return stopped;
  }

  private async stopQuietly(connection: HubConnectionLike): Promise<void> {
    try {
      await promiseFrom(() => connection.stop());
    } catch (error) {
      logSafely(
        this.logger,
        LogLevel.Warning,
        `Closing a hub connection failed: ${describeError(error)}`,
      );
    }
  }

  private withConnection<T>(
    method: string,
    call: (connection: HubConnectionLike) => Promise<T>,
  ): Promise<T> {
    const connection = this.connection;
    if (this.hubState !== 'connected' || !connection) {
      return Promise.reject(new HubNotConnectedError(method, this.hubState));
    }
    return promiseFrom(() => call(connection));
  }

  private setState(next: HubState): void {
    if (this.hubState === next) {
      return;
    }
    this.hubState = next;
    for (const listener of [...this.stateListeners]) {
      if (this.hubState !== next) {
        // A listener changed the state again; the listeners already got (or will get) the newer state.
        break;
      }
      this.guard('state listener', () => listener(next));
    }
  }

  /** Runs a callback that must never throw into foreign code (DOM events, SignalR callbacks). */
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
