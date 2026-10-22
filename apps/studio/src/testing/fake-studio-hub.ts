/**
 * Scriptable stand-in for the Regie hub (`ResilientHub` on /hubs/studio). Test-only.
 */
import type { HubHandler, HubState } from '@flowstudio/realtime-client';
import { HUB, type ProductionChangesDto } from '@flowstudio/scene-model';
import type { StudioHub } from '../app/core/state/studio-hub';

/** Records a hub invocation. */
export interface Invocation {
  readonly method: string;
  readonly args: readonly unknown[];
}

/**
 * Fake hub: the test decides when it connects ({@link connect}), what `Subscribe` answers ({@link subscribe}) and
 * pushes server messages with {@link emit}.
 */
export class FakeStudioHub implements StudioHub {
  state: HubState = 'idle';
  startCalls = 0;
  stopCalls = 0;
  readonly invocations: Invocation[] = [];
  /** Answers `Subscribe(productionId, since)`. */
  subscribe: (productionId: string, since: number | null) => Promise<ProductionChangesDto> = () =>
    Promise.reject(new Error('no subscribe answer configured'));

  private readonly handlers = new Map<string, Set<HubHandler>>();
  private readonly stateListeners = new Set<(state: HubState) => void>();
  private readonly connectedListeners = new Set<() => void>();

  start(): void {
    this.startCalls += 1;
    if (this.state === 'idle') {
      this.setState('connecting');
    }
  }

  restart(): void {
    this.setState('connecting');
  }

  stop(): Promise<void> {
    this.stopCalls += 1;
    this.setState('stopped');
    return Promise.resolve();
  }

  on(method: string, handler: HubHandler): () => void {
    const key = method.toLowerCase();
    const set = this.handlers.get(key) ?? new Set<HubHandler>();
    set.add(handler);
    this.handlers.set(key, set);
    return () => set.delete(handler);
  }

  onConnected(listener: () => void): () => void {
    this.connectedListeners.add(listener);
    return () => this.connectedListeners.delete(listener);
  }

  onStateChange(listener: (state: HubState) => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  invoke<T>(method: string, ...args: unknown[]): Promise<T> {
    this.invocations.push({ method, args });
    if (method === HUB.subscribe) {
      return this.subscribe(args[0] as string, (args[1] as number | null) ?? null) as Promise<T>;
    }
    return Promise.resolve(undefined as T);
  }

  /** Simulates a (re)connect: state `connected` and the connected listeners (the sync subscribes). */
  connect(): void {
    this.setState('connected');
    for (const listener of [...this.connectedListeners]) {
      listener();
    }
  }

  /** Simulates a lost connection. */
  drop(): void {
    this.setState('reconnecting');
  }

  /** Simulates a server → client message. */
  emit(method: string, ...args: unknown[]): void {
    for (const handler of [...(this.handlers.get(method.toLowerCase()) ?? [])]) {
      handler(...args);
    }
  }

  /** Subscribe calls so far (production id and since). */
  get subscribeCalls(): { productionId: string; since: number | null }[] {
    return this.invocations
      .filter((invocation) => invocation.method === HUB.subscribe)
      .map((invocation) => ({
        productionId: invocation.args[0] as string,
        since: (invocation.args[1] as number | null) ?? null,
      }));
  }

  setState(state: HubState): void {
    if (this.state === state) {
      return;
    }
    this.state = state;
    for (const listener of [...this.stateListeners]) {
      listener(state);
    }
  }
}

/** Lets pending promise callbacks run. */
export async function flushMicrotasks(rounds = 10): Promise<void> {
  for (let index = 0; index < rounds; index += 1) {
    await Promise.resolve();
  }
}
