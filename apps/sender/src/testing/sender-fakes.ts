/**
 * Test doubles for the sender's unit tests (happy-dom has no WebRTC and no SignalR server). They implement the narrow
 * port types of `station-ports.ts` and are injected through the DI tokens there – never used by the app itself.
 */
import type { LocalSlotState, MediaSessionState, SlotFailure } from '@studioflow/media-client';
import type { HubHandler, HubState } from '@studioflow/realtime-client';
import type {
  DeviceSelfDto,
  LiveKitTokenDto,
  SlotTelemetryDto,
  TechCheckDto,
} from '@studioflow/scene-model';
import type { SafeStorage } from '../app/core/browser-storage';
import type { DeviceEnvironment } from '../app/core/device-environment';
import type {
  DeviceHub,
  SenderMedia,
  SenderMediaSession,
  SenderPublisher,
  StationWakeLock,
} from '../app/station/station-ports';

/** In-memory {@link SafeStorage}. */
export class MemoryStorage implements SafeStorage {
  readonly values = new Map<string, string>();

  readJson(key: string): unknown {
    const raw = this.values.get(key);
    if (raw === undefined) {
      return null;
    }
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return null;
    }
  }

  writeJson(key: string, value: unknown): boolean {
    this.values.set(key, JSON.stringify(value));
    return true;
  }

  remove(key: string): void {
    this.values.delete(key);
  }

  /** Stores a raw (possibly corrupt) string. */
  setRaw(key: string, raw: string): void {
    this.values.set(key, raw);
  }
}

/** Fake device hub: records calls, lets tests connect, drop and push server messages. */
export class FakeHub implements DeviceHub {
  state: HubState = 'idle';
  readonly calls: string[] = [];
  readonly sent: { method: string; args: unknown[] }[] = [];
  readonly invoked: { method: string; args: unknown[] }[] = [];
  /** Answers `invoke` calls; default resolves undefined. */
  responder: (method: string, args: unknown[]) => Promise<unknown> = () =>
    Promise.resolve(undefined);

  private readonly handlers = new Map<string, Set<HubHandler>>();
  private readonly stateListeners = new Set<(state: HubState) => void>();
  private readonly connectedListeners = new Set<() => void>();

  start(): void {
    this.calls.push('start');
    if (this.state === 'idle') {
      this.setState('connecting');
    }
  }

  restart(): void {
    this.calls.push('restart');
    if (this.state === 'idle' || this.state === 'stopped' || this.state === 'unauthorized') {
      this.setState('connecting');
    }
  }

  stop(): Promise<void> {
    this.calls.push('stop');
    this.setState('stopped');
    return Promise.resolve();
  }

  markTerminal(state: 'stopped' | 'unauthorized'): void {
    this.calls.push(`markTerminal:${state}`);
    this.setState(state);
  }

  on(method: string, handler: HubHandler): () => void {
    const key = method.toLowerCase();
    const set = this.handlers.get(key) ?? new Set<HubHandler>();
    set.add(handler);
    this.handlers.set(key, set);
    return () => set.delete(handler);
  }

  invoke<T>(method: string, ...args: unknown[]): Promise<T> {
    this.invoked.push({ method, args });
    if (this.state !== 'connected') {
      return Promise.reject(new Error(`not connected: ${method}`));
    }
    return this.responder(method, args) as Promise<T>;
  }

  send(method: string, ...args: unknown[]): Promise<void> {
    if (this.state !== 'connected') {
      return Promise.reject(new Error(`not connected: ${method}`));
    }
    this.sent.push({ method, args });
    return Promise.resolve();
  }

  onStateChange(listener: (state: HubState) => void): () => boolean {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  onConnected(listener: () => void): () => boolean {
    this.connectedListeners.add(listener);
    return () => this.connectedListeners.delete(listener);
  }

  /** Simulates a (re)connect. */
  connect(): void {
    this.setState('connected');
    for (const listener of [...this.connectedListeners]) {
      listener();
    }
  }

  /** Simulates a server → client message. */
  emit(method: string, ...args: unknown[]): void {
    for (const handler of [...(this.handlers.get(method.toLowerCase()) ?? [])]) {
      handler(...args);
    }
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

  /** Reports sent so far (`Report` is invoked, so its round trip gives the RTT). */
  reports(): unknown[] {
    return this.invoked.filter((entry) => entry.method === 'Report').map((entry) => entry.args[0]);
  }
}

/** Fake LiveKit session. */
export class FakeMediaSession implements SenderMediaSession {
  state: MediaSessionState = 'idle';
  readonly calls: string[] = [];
  private readonly listeners = new Set<(state: MediaSessionState) => void>();

  onStateChange(listener: (state: MediaSessionState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  start(): void {
    this.calls.push('start');
    if (this.state === 'idle') {
      this.setState('connecting');
    }
  }

  restart(): void {
    this.calls.push('restart');
    this.setState('connecting');
  }

  stop(): void {
    this.calls.push('stop');
    if (!['stopped', 'replaced', 'removed', 'unauthorized'].includes(this.state)) {
      this.setState('stopped');
    }
  }

  setState(state: MediaSessionState): void {
    if (this.state === state) {
      return;
    }
    this.state = state;
    for (const listener of [...this.listeners]) {
      listener(state);
    }
  }
}

/** Fake publisher: records calls and lets tests drive slot states. */
export class FakePublisher implements SenderPublisher {
  readonly calls: string[] = [];
  readonly states = new Map<string, LocalSlotState>();
  telemetry: SlotTelemetryDto[] = [];
  disposed = false;
  private readonly listeners = new Set<
    (slot: string, state: LocalSlotState, message?: string, failure?: SlotFailure) => void
  >();

  publishCamera(slot: string, settings: { facingMode: string; resolution: number }): Promise<void> {
    this.calls.push(`publishCamera:${slot}:${settings.facingMode}:${settings.resolution}`);
    this.emitSlot(slot, 'starting');
    return Promise.resolve();
  }

  switchCamera(): Promise<void> {
    this.calls.push('switchCamera');
    return Promise.resolve();
  }

  setCameraResolution(resolution: 720 | 1080): Promise<void> {
    this.calls.push(`setCameraResolution:${resolution}`);
    return Promise.resolve();
  }

  publishScreen(slot: string): Promise<void> {
    this.calls.push(`publishScreen:${slot}`);
    this.emitSlot(slot, 'starting');
    return Promise.resolve();
  }

  unpublish(slot: string): Promise<void> {
    this.calls.push(`unpublish:${slot}`);
    this.emitSlot(slot, 'idle');
    this.states.delete(slot);
    return Promise.resolve();
  }

  stopAll(): Promise<void> {
    this.calls.push('stopAll');
    return Promise.resolve();
  }

  onSlotState(
    listener: (
      slot: string,
      state: LocalSlotState,
      message?: string,
      failure?: SlotFailure,
    ) => void,
  ): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  slotState(slot: string): LocalSlotState {
    return this.states.get(slot) ?? 'idle';
  }

  getSlotTelemetry(): Promise<SlotTelemetryDto[]> {
    return Promise.resolve(this.telemetry);
  }

  localPreview(): MediaStream | null {
    return null;
  }

  dispose(): void {
    this.disposed = true;
  }

  /** Drives a slot state as the real publisher would. */
  emitSlot(slot: string, state: LocalSlotState, message?: string, failure?: SlotFailure): void {
    this.states.set(slot, state);
    for (const listener of [...this.listeners]) {
      listener(slot, state, message, failure);
    }
  }
}

/** Fake wake lock. */
export class FakeWakeLock implements StationWakeLock {
  active = false;
  disposed = false;

  enable(): Promise<boolean> {
    this.active = true;
    return Promise.resolve(true);
  }

  disable(): Promise<void> {
    this.active = false;
    return Promise.resolve();
  }

  dispose(): void {
    this.disposed = true;
    this.active = false;
  }
}

/** Media pair of fakes. */
export function fakeMedia(): SenderMedia & { session: FakeMediaSession; publisher: FakePublisher } {
  return { session: new FakeMediaSession(), publisher: new FakePublisher() };
}

/** A configurable device environment. */
export function fakeEnvironment(overrides: Partial<DeviceEnvironment> = {}): DeviceEnvironment {
  return {
    userAgent: () =>
      'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 Chrome/150.0 Mobile Safari/537.36',
    platform: () => 'Android · Chrome',
    isPhone: () => true,
    canShareScreen: () => false,
    battery: () => Promise.resolve({ pct: 81, charging: true }),
    networkType: () => 'wifi',
    vibrate: () => undefined,
    ...overrides,
  };
}

/** Self of a phone with camera slot K3. */
export function phoneSelf(overrides: Partial<DeviceSelfDto> = {}): DeviceSelfDto {
  return {
    id: 'dev_phone0001',
    name: 'Handy Bühne',
    kind: 'phone',
    state: 'active',
    productionId: 'prd_webinar01',
    productionName: 'Webinar',
    slots: [{ slot: 'camera', code: 'K3', kind: 'camera' }],
    ...overrides,
  };
}

/** Self of a laptop with screen slot S2. */
export function laptopSelf(overrides: Partial<DeviceSelfDto> = {}): DeviceSelfDto {
  return {
    id: 'dev_laptop001',
    name: 'Laptop Anna',
    kind: 'laptop',
    state: 'active',
    productionId: 'prd_webinar01',
    productionName: 'Webinar',
    slots: [{ slot: 'screen-1', code: 'S2', kind: 'screen' }],
    ...overrides,
  };
}

/** A LiveKit token answer. */
export const LIVEKIT_TOKEN: LiveKitTokenDto = {
  url: 'wss://localhost/rtc',
  token: 'token',
  identity: 'dev_phone0001',
  room: 'prd_webinar01',
  expiresAt: '2026-10-22T12:00:00Z',
};

/** A tech check result. */
export const TECH_CHECK_OK: TechCheckDto = {
  overall: 'ok',
  camera: 'ok',
  network: 'ok',
  bandwidth: 'ok',
  uploadKbps: 8400,
  rttMs: 12,
  at: '2026-10-22T11:00:00Z',
  note: null,
};

/** Settles pending promise chains (with fake timers: also runs due timers of 0 ms). */
export async function settle(rounds = 5): Promise<void> {
  for (let index = 0; index < rounds; index++) {
    await Promise.resolve();
  }
}
