/**
 * Test doubles for the realtime-client specs. Test-only: not exported from the package index.
 */
import { HubConnectionState, LogLevel, type ILogger } from '@microsoft/signalr';
import type { HubConnectionLike, HubHandler, HubState } from '../resilient-hub';
import type { SyncHub } from '../production-sync';

/** A promise with its resolve and reject functions. */
export interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

/** Creates a {@link Deferred}. */
export function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Lets pending promise callbacks run (works with fake timers, which do not fake microtasks). */
export async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 10; index += 1) {
    await Promise.resolve();
  }
}

/** The error text SignalR produces when negotiate answers 401. */
export const UNAUTHORIZED_ERROR = new Error(
  "Failed to complete negotiation with the server: Error: Unauthorized: Status code '401'",
);

/** Logger that records every line. */
export class RecordingLogger implements ILogger {
  readonly lines: { level: LogLevel; message: string }[] = [];

  log(level: LogLevel, message: string): void {
    this.lines.push({ level, message });
  }

  /** Messages at or above `level`. */
  messages(level: LogLevel = LogLevel.Trace): string[] {
    return this.lines.filter((line) => line.level >= level).map((line) => line.message);
  }
}

/**
 * Scriptable stand-in for SignalR's HubConnection: the test decides when `start()` settles and fires the reconnect
 * and close callbacks itself.
 */
export class FakeConnection implements HubConnectionLike {
  state: HubConnectionState = HubConnectionState.Disconnected;
  startCalls = 0;
  stopCalls = 0;
  readonly invocations: { method: string; args: unknown[] }[] = [];
  readonly sent: { method: string; args: unknown[] }[] = [];
  invokeResult: (method: string, args: unknown[]) => Promise<unknown> = () =>
    Promise.resolve(undefined);
  private readonly handlers = new Map<string, HubHandler[]>();
  private readonly reconnectingCallbacks: ((error?: Error) => void)[] = [];
  private readonly reconnectedCallbacks: ((connectionId?: string) => void)[] = [];
  private readonly closeCallbacks: ((error?: Error) => void)[] = [];
  private pendingStart: Deferred<void> | null = null;

  start(): Promise<void> {
    this.startCalls += 1;
    this.state = HubConnectionState.Connecting;
    this.pendingStart = deferred<void>();
    return this.pendingStart.promise;
  }

  stop(): Promise<void> {
    this.stopCalls += 1;
    const wasOpen =
      this.state === HubConnectionState.Connected || this.state === HubConnectionState.Reconnecting;
    this.state = HubConnectionState.Disconnected;
    if (this.pendingStart) {
      this.pendingStart.reject(new Error('The connection was stopped during negotiation.'));
      this.pendingStart = null;
    }
    if (wasOpen) {
      this.fireClose(undefined);
    }
    return Promise.resolve();
  }

  on(method: string, handler: HubHandler): void {
    const key = method.toLowerCase();
    const list = this.handlers.get(key) ?? [];
    if (!list.includes(handler)) {
      list.push(handler);
    }
    this.handlers.set(key, list);
  }

  off(method: string, handler: HubHandler): void {
    const key = method.toLowerCase();
    this.handlers.set(
      key,
      (this.handlers.get(key) ?? []).filter((entry) => entry !== handler),
    );
  }

  invoke<T>(method: string, ...args: unknown[]): Promise<T> {
    this.invocations.push({ method, args });
    return this.invokeResult(method, args) as Promise<T>;
  }

  send(method: string, ...args: unknown[]): Promise<void> {
    this.sent.push({ method, args });
    return Promise.resolve();
  }

  onreconnecting(callback: (error?: Error) => void): void {
    this.reconnectingCallbacks.push(callback);
  }

  onreconnected(callback: (connectionId?: string) => void): void {
    this.reconnectedCallbacks.push(callback);
  }

  onclose(callback: (error?: Error) => void): void {
    this.closeCallbacks.push(callback);
  }

  /** Number of handlers registered for a method. */
  handlerCount(method: string): number {
    return this.handlers.get(method.toLowerCase())?.length ?? 0;
  }

  /** Lets the pending `start()` resolve. */
  succeed(): void {
    this.state = HubConnectionState.Connected;
    this.pendingStart?.resolve();
    this.pendingStart = null;
  }

  /** Lets the pending `start()` reject. */
  fail(error: unknown): void {
    this.state = HubConnectionState.Disconnected;
    this.pendingStart?.reject(error);
    this.pendingStart = null;
  }

  /** Server → client invocation. */
  receive(method: string, ...args: unknown[]): void {
    for (const handler of [...(this.handlers.get(method.toLowerCase()) ?? [])]) {
      handler(...args);
    }
  }

  /** SignalR noticed a connection loss and starts its automatic reconnect. */
  loseConnection(error: Error = new Error('WebSocket closed with status code: 1006')): void {
    this.state = HubConnectionState.Reconnecting;
    for (const callback of this.reconnectingCallbacks) {
      callback(error);
    }
  }

  /** SignalR's automatic reconnect succeeded. */
  reconnect(): void {
    this.state = HubConnectionState.Connected;
    for (const callback of this.reconnectedCallbacks) {
      callback('connection-id');
    }
  }

  /** The connection closed for good (server close, policy gave up). */
  close(error?: Error): void {
    this.state = HubConnectionState.Disconnected;
    this.fireClose(error);
  }

  private fireClose(error: Error | undefined): void {
    for (const callback of this.closeCallbacks) {
      callback(error);
    }
  }
}

/** Hub double for the sync specs: the test sets the state and delivers messages. */
export class FakeSyncHub implements SyncHub {
  state: HubState = 'idle';
  private readonly handlers = new Map<string, Set<HubHandler>>();
  private readonly connectedListeners = new Set<() => void>();
  private readonly stateListeners = new Set<(state: HubState) => void>();

  on(method: string, handler: HubHandler): () => void {
    const set = this.handlers.get(method) ?? new Set<HubHandler>();
    set.add(handler);
    this.handlers.set(method, set);
    return () => {
      set.delete(handler);
    };
  }

  onConnected(listener: () => void): () => void {
    this.connectedListeners.add(listener);
    return () => this.connectedListeners.delete(listener);
  }

  onStateChange(listener: (state: HubState) => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  /** Total number of registered handlers and listeners (0 after the sync stopped). */
  listenerCount(): number {
    let count = this.connectedListeners.size + this.stateListeners.size;
    for (const set of this.handlers.values()) {
      count += set.size;
    }
    return count;
  }

  setState(state: HubState): void {
    this.state = state;
    for (const listener of [...this.stateListeners]) {
      listener(state);
    }
  }

  /** Connects (or reconnects) and notifies the connected listeners. */
  connect(): void {
    this.setState('connected');
    for (const listener of [...this.connectedListeners]) {
      listener();
    }
  }

  receive(method: string, ...args: unknown[]): void {
    for (const handler of [...(this.handlers.get(method) ?? [])]) {
      handler(...args);
    }
  }
}
