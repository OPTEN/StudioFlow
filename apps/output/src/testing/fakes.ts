/**
 * Fakes for the output page specs: hub, renderer, media session and provider, REST API. Test-only.
 */
import { vi } from 'vitest';
import type {
  CanvasSize,
  LiveKitTokenDto,
  OutputReport,
  SceneDto,
  SlateDto,
  TransitionDto,
} from '@studioflow/scene-model';
import type { HubHandler, HubState } from '@studioflow/realtime-client';
import type {
  CanvasRect,
  DesiredSize,
  RendererStats,
  SceneRenderer,
  SourceAvailability,
} from '@studioflow/scene-renderer';
import type { MediaSessionState, SourceStats } from '@studioflow/media-client';
import type { OutputApi } from '../api';
import type { OutputHub } from '../output-app';
import type { OutputMedia, OutputMediaProvider, OutputMediaSession } from '../media';

/** Recorded renderer call. */
export type RendererCall =
  | { readonly method: 'show'; readonly scene: SceneDto | null }
  | { readonly method: 'update'; readonly scene: SceneDto }
  | {
      readonly method: 'transitionTo';
      readonly scene: SceneDto | null;
      readonly transition: TransitionDto;
    }
  | {
      readonly method: 'showSlate';
      readonly slate: SlateDto | null;
      readonly assetUrl?: string | null;
    }
  | { readonly method: 'setPreloadScenes'; readonly scenes: readonly SceneDto[] };

/** Renderer that records the calls of the view. */
export class FakeRenderer implements SceneRenderer {
  readonly element: HTMLElement;
  readonly calls: RendererCall[] = [];
  fps = 0;
  destroyed = false;

  constructor(
    readonly container: HTMLElement,
    readonly options: unknown = undefined,
  ) {
    this.element = container.ownerDocument.createElement('div');
    container.append(this.element);
  }

  show(scene: SceneDto | null): void {
    this.calls.push({ method: 'show', scene });
  }
  update(scene: SceneDto): void {
    this.calls.push({ method: 'update', scene });
  }
  transitionTo(scene: SceneDto | null, transition: TransitionDto): Promise<void> {
    this.calls.push({ method: 'transitionTo', scene, transition });
    return Promise.resolve();
  }
  showSlate(slate: SlateDto | null, assetUrl?: string | null): void {
    this.calls.push(
      assetUrl === undefined
        ? { method: 'showSlate', slate }
        : { method: 'showSlate', slate, assetUrl },
    );
  }
  setPreloadScenes(scenes: readonly SceneDto[]): void {
    this.calls.push({ method: 'setPreloadScenes', scenes: [...scenes] });
  }
  /** The canvases the page set, in order (not part of {@link summary}). */
  readonly canvases: CanvasSize[] = [];
  setCanvas(canvas: CanvasSize): void {
    this.canvases.push(canvas);
  }
  /** Number of `refresh` calls (not part of {@link summary}). */
  refreshes = 0;
  refresh(): void {
    this.refreshes += 1;
  }
  effectiveRects(): ReadonlyMap<string, CanvasRect> {
    return new Map<string, CanvasRect>();
  }
  stats(): RendererStats {
    return { fps: this.fps, items: 0, videos: 0 };
  }
  resize(): void {}
  destroy(): void {
    this.destroyed = true;
    this.element.remove();
  }

  /** Calls since the last {@link reset}, as compact strings: `show scn_a`, `slate No access`, `preload scn_b,scn_c`. */
  summary(): string[] {
    return this.calls.map((call) => {
      switch (call.method) {
        case 'show':
        case 'update':
          return `${call.method} ${call.scene?.id ?? 'null'}`;
        case 'transitionTo':
          return `transition ${call.scene?.id ?? 'null'} ${call.transition.kind} ${call.transition.durationMs}`;
        case 'showSlate':
          return `slate ${call.slate?.title ?? 'null'}`;
        case 'setPreloadScenes':
          return `preload ${call.scenes.map((s) => s.id).join(',')}`;
      }
    });
  }

  /** The slate currently shown according to the recorded calls. */
  currentSlate(): SlateDto | null {
    for (let index = this.calls.length - 1; index >= 0; index -= 1) {
      const call = this.calls[index];
      if (call.method === 'showSlate') {
        return call.slate;
      }
    }
    return null;
  }

  reset(): void {
    this.calls.length = 0;
  }
}

/** Hub whose connection the test drives. */
export class FakeHub implements OutputHub {
  state: HubState = 'idle';
  starts = 0;
  restarts = 0;
  stops = 0;
  readonly sent: { method: string; args: unknown[] }[] = [];
  readonly invoked: { method: string; args: unknown[] }[] = [];
  /** Answer of `invoke` (SubscribeOutput); default: rejects. */
  onInvoke: (method: string, ...args: unknown[]) => Promise<unknown> = () =>
    Promise.reject(new Error('no answer configured'));
  /** Result of `send`; default resolves. */
  onSend: (method: string, ...args: unknown[]) => Promise<void> = () => Promise.resolve();
  readonly #handlers = new Map<string, Set<HubHandler>>();
  readonly #stateListeners = new Set<(state: HubState) => void>();
  readonly #connectedListeners = new Set<() => void>();
  /** What `start()` / `restart()` do: default only switches to `connecting`. */
  onStart: () => void = () => undefined;

  start(): void {
    if (this.state === 'idle') {
      this.starts += 1;
      this.setState('connecting');
      this.onStart();
    }
  }
  restart(): void {
    if (this.state === 'idle' || this.state === 'stopped' || this.state === 'unauthorized') {
      this.restarts += 1;
      this.setState('connecting');
      this.onStart();
    }
  }
  stop(): Promise<void> {
    this.stops += 1;
    this.setState('stopped');
    return Promise.resolve();
  }
  on(method: string, handler: HubHandler): () => void {
    const key = method.toLowerCase();
    const set = this.#handlers.get(key) ?? new Set();
    set.add(handler);
    this.#handlers.set(key, set);
    return () => set.delete(handler);
  }
  invoke<T>(method: string, ...args: unknown[]): Promise<T> {
    this.invoked.push({ method, args });
    return this.onInvoke(method, ...args) as Promise<T>;
  }
  send(method: string, ...args: unknown[]): Promise<void> {
    if (this.state !== 'connected') {
      return Promise.reject(new Error('not connected'));
    }
    this.sent.push({ method, args });
    return this.onSend(method, ...args);
  }
  onStateChange(listener: (state: HubState) => void): () => void {
    this.#stateListeners.add(listener);
    return () => this.#stateListeners.delete(listener);
  }
  onConnected(listener: () => void): () => void {
    this.#connectedListeners.add(listener);
    return () => this.#connectedListeners.delete(listener);
  }

  /** Simulates a (re)connect: state `connected`, then the connected listeners (subscribe). */
  connect(): void {
    this.setState('connected');
    for (const listener of [...this.#connectedListeners]) {
      listener();
    }
  }
  /** Simulates a lost connection. */
  drop(): void {
    this.setState('reconnecting');
  }
  /** Simulates a 401/403 from negotiate. */
  refuse(): void {
    this.setState('unauthorized');
  }
  /** Pushes a server → client message. */
  emit(method: string, ...args: unknown[]): void {
    for (const handler of [...(this.#handlers.get(method.toLowerCase()) ?? [])]) {
      handler(...args);
    }
  }
  setState(state: HubState): void {
    if (this.state === state) {
      return;
    }
    this.state = state;
    for (const listener of [...this.#stateListeners]) {
      listener(state);
    }
  }
}

/** Media session whose state the test drives. */
export class FakeMediaSession implements OutputMediaSession {
  state: MediaSessionState = 'idle';
  starts = 0;
  restarts = 0;
  stops = 0;
  readonly #listeners = new Set<(state: MediaSessionState) => void>();

  start(): void {
    if (this.state === 'idle') {
      this.starts += 1;
      this.setState('connecting');
    }
  }
  restart(): void {
    this.restarts += 1;
    this.setState('connecting');
  }
  stop(): void {
    this.stops += 1;
    if (!['stopped', 'replaced', 'removed', 'unauthorized'].includes(this.state)) {
      this.setState('stopped');
    }
  }
  onStateChange(listener: (state: MediaSessionState) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
  setState(state: MediaSessionState): void {
    if (this.state !== state) {
      this.state = state;
      for (const listener of [...this.#listeners]) {
        listener(state);
      }
    }
  }
}

/** LiveKit provider stand-in with configurable stats. */
export class FakeMediaProvider implements OutputMediaProvider {
  readonly attached: [string, HTMLVideoElement][] = [];
  readonly sizes: [string, string, DesiredSize | null][] = [];
  readonly available = new Map<string, SourceAvailability>();
  readonly stats = new Map<string, SourceStats>();
  latency: number | null = 62;
  disposed = false;
  readonly #listeners = new Set<(sourceId: string) => void>();

  attach(sourceId: string, video: HTMLVideoElement): void {
    this.attached.push([sourceId, video]);
  }
  detach(sourceId: string, video: HTMLVideoElement): void {
    const index = this.attached.findIndex(([id, v]) => id === sourceId && v === video);
    if (index >= 0) {
      this.attached.splice(index, 1);
    }
  }
  availability(sourceId: string): SourceAvailability {
    return this.available.get(sourceId) ?? { state: 'pending' };
  }
  onChange(listener: (sourceId: string) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
  setDesiredSize(sourceId: string, consumerId: string, size: DesiredSize | null): void {
    this.sizes.push([sourceId, consumerId, size]);
  }
  assetUrl(): string | null {
    return null;
  }
  getStats(sourceId: string): Promise<SourceStats | null> {
    return Promise.resolve(this.stats.get(sourceId) ?? null);
  }
  estimateLatencyMs(): Promise<number | null> {
    return Promise.resolve(this.latency);
  }
  dispose(): void {
    this.disposed = true;
  }
  emit(sourceId: string): void {
    for (const listener of [...this.#listeners]) {
      listener(sourceId);
    }
  }
}

/** A loaded media side made of fakes. */
export function fakeMedia(): OutputMedia & {
  session: FakeMediaSession;
  provider: FakeMediaProvider;
} {
  return { session: new FakeMediaSession(), provider: new FakeMediaProvider() };
}

/** REST API fake. */
export function fakeApi(): OutputApi & {
  liveKitToken: ReturnType<typeof vi.fn<() => Promise<LiveKitTokenDto>>>;
  report: ReturnType<typeof vi.fn<(report: OutputReport) => Promise<void>>>;
} {
  return {
    liveKitToken: vi.fn<() => Promise<LiveKitTokenDto>>(() =>
      Promise.resolve({
        url: 'wss://studioflow.test',
        token: 'jwt',
        identity: 'output_webinar_x',
        room: 'prd_aaaaaaaaaaaaaaaa',
        expiresAt: '2026-10-22T10:10:00.000Z',
      }),
    ),
    report: vi.fn<(report: OutputReport) => Promise<void>>(() => Promise.resolve()),
  };
}
