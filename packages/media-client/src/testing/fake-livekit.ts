/**
 * Test doubles for the livekit-client surface used by the media client (see `livekit-port.ts`). They emit the real
 * `RoomEvent` / `TrackEvent` names and record calls with `vi.fn`, so specs can drive SDK behaviour without WebRTC.
 * Test-only module: not exported from the package entry point.
 */
import {
  ConnectionState,
  DisconnectReason,
  RoomEvent,
  TrackEvent,
  type LocalTrack,
  type LocalVideoTrack,
  type RoomConnectOptions,
  type TrackPublishOptions,
  type VideoCaptureOptions,
  type VideoSenderStats,
} from 'livekit-client';
import type { LiveKitTokenDto } from '@studioflow/scene-model';
import type {
  JitterBufferControl,
  MediaLocalParticipant,
  MediaRemoteParticipant,
  MediaRemotePublication,
  MediaRemoteTrack,
  MediaRoom,
  VideoDimensions,
} from '../livekit-port';
import type { PageLifecycle } from '../page-lifecycle';

type Handler = (...args: never[]) => void;

/** Minimal event emitter with the `on`/`off` shape of livekit's emitters. */
export class FakeEmitter {
  readonly #handlers = new Map<string, Set<Handler>>();

  on(event: string, listener: Handler): this {
    let set = this.#handlers.get(event);
    if (set === undefined) {
      set = new Set();
      this.#handlers.set(event, set);
    }
    set.add(listener);
    return this;
  }

  off(event: string, listener: Handler): this {
    this.#handlers.get(event)?.delete(listener);
    return this;
  }

  emit(event: string, ...args: unknown[]): void {
    for (const listener of [...(this.#handlers.get(event) ?? [])]) {
      (listener as (...values: unknown[]) => void)(...args);
    }
  }

  listenerCount(event?: string): number {
    if (event !== undefined) {
      return this.#handlers.get(event)?.size ?? 0;
    }
    return [...this.#handlers.values()].reduce((sum, set) => sum + set.size, 0);
  }
}

let nextId = 1;

/** Stand-in for a `MediaStreamTrack` with the members the media client reads. */
export class FakeMediaStreamTrack {
  readonly id = `mst-${nextId++}`;
  readonly kind = 'video';
  readyState: MediaStreamTrackState = 'live';
  contentHint = '';
  settings: MediaTrackSettings = { width: 1280, height: 720, frameRate: 30 };
  /** What `getCapabilities()` reports (a desktop webcam: no image controls). */
  capabilities: MediaTrackCapabilities = { width: { min: 1, max: 1920 } };
  /** Set to make `applyConstraints` reject (e.g. an `OverconstrainedError`). */
  constraintError: Error | null = null;
  /** Controls the camera silently ignores (applyConstraints resolves, the setting stays). */
  ignored = new Set<string>();
  readonly stop = vi.fn(() => {
    this.readyState = 'ended';
  });
  /** Applies the first advanced constraint set to the settings, like a camera that supports it. */
  readonly applyConstraints = vi.fn(async (constraints?: MediaTrackConstraints): Promise<void> => {
    if (this.constraintError !== null) {
      throw this.constraintError;
    }
    const set = Object.entries(constraints?.advanced?.[0] ?? {}).filter(
      ([key]) => !this.ignored.has(key),
    );
    this.settings = { ...this.settings, ...Object.fromEntries(set) };
  });

  getSettings(): MediaTrackSettings {
    return this.settings;
  }

  getCapabilities(): MediaTrackCapabilities {
    return this.capabilities;
  }

  /** Typed view for APIs that expect the DOM type. */
  get asTrack(): MediaStreamTrack {
    return this as unknown as MediaStreamTrack;
  }
}

/**
 * Stand-in for a `MediaStream`: happy-dom only ships a stub class, but its `srcObject` setter insists on an instance of
 * it, so the fake extends the global class and remembers the wrapped track.
 */
export class FakeMediaStream extends MediaStream {
  constructor(readonly track: MediaStreamTrack) {
    super();
  }
}

/** `createStream` option for providers and publishers in tests. */
export function fakeCreateStream(track: MediaStreamTrack): MediaStream {
  return new FakeMediaStream(track) as unknown as MediaStream;
}

/** Remote video track. */
export class FakeRemoteTrack implements MediaRemoteTrack {
  readonly kind: string;
  readonly mediaStreamTrack: MediaStreamTrack = new FakeMediaStreamTrack().asTrack;
  currentBitrate = 0;
  receiver: JitterBufferControl | undefined = { jitterBufferTarget: null };
  stats: Map<string, unknown> | undefined = new Map();
  readonly setPlayoutDelay = vi.fn<(delayInSeconds: number) => void>();
  readonly getRTCStatsReport = vi.fn(
    async (): Promise<RTCStatsReport | undefined> => this.stats as RTCStatsReport | undefined,
  );

  constructor(kind = 'video') {
    this.kind = kind;
  }
}

/** Remote track publication. */
export class FakeRemotePublication implements MediaRemotePublication {
  readonly kind: string;
  isMuted = false;
  isSubscribed = false;
  track: MediaRemoteTrack | undefined;
  readonly setVideoQuality = vi.fn<(quality: number) => void>();
  readonly setVideoDimensions = vi.fn<(dimensions: VideoDimensions) => void>();
  readonly setEnabled = vi.fn<(enabled: boolean) => void>();

  constructor(
    readonly trackName: string,
    kind = 'video',
  ) {
    this.kind = kind;
  }
}

/** Remote participant. */
export class FakeRemoteParticipant implements MediaRemoteParticipant {
  readonly trackPublications = new Map<string, FakeRemotePublication>();

  constructor(readonly identity: string) {}
}

/** Local participant recording publish calls. */
export class FakeLocalParticipant implements MediaLocalParticipant {
  readonly published = new Map<string, LocalTrack>();
  /** Set to make the next publish calls reject. */
  publishError: Error | null = null;
  readonly publishTrack = vi.fn(
    async (track: LocalTrack, options?: TrackPublishOptions): Promise<unknown> => {
      if (this.publishError !== null) {
        throw this.publishError;
      }
      this.published.set(options?.name ?? 'unnamed', track);
      return {};
    },
  );
  readonly unpublishTrack = vi.fn(async (track: LocalTrack): Promise<unknown> => {
    for (const [name, published] of this.published) {
      if (published === track) {
        this.published.delete(name);
      }
    }
    return undefined;
  });
}

/** Room whose connect outcome the test decides (`resolveConnect` / `rejectConnect`) unless `autoConnect` is on. */
export class FakeRoom extends FakeEmitter implements MediaRoom {
  state: ConnectionState = ConnectionState.Disconnected;
  readonly localParticipant = new FakeLocalParticipant();
  readonly remoteParticipants = new Map<string, FakeRemoteParticipant>();
  readonly connectCalls: { url: string; token: string; options: RoomConnectOptions | undefined }[] =
    [];
  readonly disconnectCalls: (boolean | undefined)[] = [];
  #pending: { resolve: () => void; reject: (error: Error) => void } | null = null;

  constructor(private readonly autoConnect = false) {
    super();
  }

  connect(url: string, token: string, options?: RoomConnectOptions): Promise<void> {
    this.connectCalls.push({ url, token, options });
    this.state = ConnectionState.Connecting;
    return new Promise<void>((resolve, reject) => {
      this.#pending = { resolve, reject };
      if (this.autoConnect) {
        queueMicrotask(() => this.resolveConnect());
      }
    });
  }

  resolveConnect(): void {
    if (this.#pending === null) {
      return;
    }
    this.state = ConnectionState.Connected;
    this.emit(RoomEvent.Connected);
    this.#pending.resolve();
    this.#pending = null;
  }

  /** Fails the pending connect the way the SDK does: Disconnected event first, then the rejection. */
  rejectConnect(error: Error = new Error('could not establish signal connection')): void {
    if (this.#pending === null) {
      return;
    }
    this.state = ConnectionState.Disconnected;
    this.emit(RoomEvent.Disconnected, DisconnectReason.JOIN_FAILURE);
    this.#pending.reject(error);
    this.#pending = null;
  }

  disconnect(stopTracks?: boolean): Promise<void> {
    this.disconnectCalls.push(stopTracks);
    if (this.state !== ConnectionState.Disconnected) {
      this.state = ConnectionState.Disconnected;
      this.emit(RoomEvent.Disconnected, DisconnectReason.CLIENT_INITIATED);
    }
    this.#pending?.reject(new Error('Client initiated disconnect'));
    this.#pending = null;
    return Promise.resolve();
  }

  /** Simulates a disconnect not requested by the client (`undefined` = the SDK gave up). */
  serverDisconnect(reason?: DisconnectReason): void {
    this.state = ConnectionState.Disconnected;
    this.emit(RoomEvent.Disconnected, reason);
  }

  setState(state: ConnectionState, event?: RoomEvent): void {
    this.state = state;
    if (event !== undefined) {
      this.emit(event);
    }
  }

  /** Adds (or reuses) a participant and a subscribed video publication and emits TrackSubscribed. */
  subscribe(
    identity: string,
    trackName: string,
    options: { track?: FakeRemoteTrack; muted?: boolean; emit?: boolean } = {},
  ): {
    participant: FakeRemoteParticipant;
    publication: FakeRemotePublication;
    track: FakeRemoteTrack;
  } {
    let participant = this.remoteParticipants.get(identity);
    if (participant === undefined) {
      participant = new FakeRemoteParticipant(identity);
      this.remoteParticipants.set(identity, participant);
    }
    const publication =
      participant.trackPublications.get(trackName) ?? new FakeRemotePublication(trackName);
    participant.trackPublications.set(trackName, publication);
    const track = options.track ?? new FakeRemoteTrack();
    publication.track = track;
    publication.isSubscribed = true;
    publication.isMuted = options.muted ?? false;
    if (options.emit !== false) {
      this.emit(RoomEvent.TrackSubscribed, track, publication, participant);
    }
    return { participant, publication, track };
  }

  /** Emits TrackUnsubscribed + TrackUnpublished for a publication, like the SDK on unpublish or full reconnect. */
  unsubscribe(identity: string, trackName: string): void {
    const participant = this.remoteParticipants.get(identity);
    const publication = participant?.trackPublications.get(trackName);
    if (participant === undefined || publication === undefined) {
      return;
    }
    const track = publication.track;
    publication.track = undefined;
    publication.isSubscribed = false;
    if (track !== undefined) {
      this.emit(RoomEvent.TrackUnsubscribed, track, publication, participant);
    }
    participant.trackPublications.delete(trackName);
    this.emit(RoomEvent.TrackUnpublished, publication, participant);
  }
}

/** Local camera / screen track. Cast with {@link asLocalVideoTrack} where the SDK type is expected. */
export class FakeLocalVideoTrack extends FakeEmitter {
  mediaStreamTrack: MediaStreamTrack = new FakeMediaStreamTrack().asTrack;
  isMuted = false;
  codec: string | undefined = 'h264';
  currentBitrate = 0;
  senderStats: VideoSenderStats[] = [];
  /** Set to make restartTrack / unmute reject (device gone). */
  restartError: Error | null = null;
  readonly restartTrack = vi.fn(async (options?: VideoCaptureOptions): Promise<void> => {
    if (this.restartError !== null) {
      throw this.restartError;
    }
    this.replaceMediaTrack(options);
  });
  readonly unmute = vi.fn(async (): Promise<this> => {
    if (this.restartError !== null) {
      throw this.restartError;
    }
    this.isMuted = false;
    this.replaceMediaTrack();
    this.emit(TrackEvent.Unmuted);
    return this;
  });
  readonly stop = vi.fn(() => {
    (this.mediaStreamTrack as unknown as FakeMediaStreamTrack).readyState = 'ended';
  });
  readonly getSenderStats = vi.fn(async (): Promise<VideoSenderStats[]> => this.senderStats);

  get fakeMediaTrack(): FakeMediaStreamTrack {
    return this.mediaStreamTrack as unknown as FakeMediaStreamTrack;
  }

  /** The device stopped delivering (unplugged, revoked): readyState ended + TrackEvent.Ended. */
  endFromDevice(): void {
    this.fakeMediaTrack.readyState = 'ended';
    this.emit(TrackEvent.Ended, this);
  }

  /** What the SDK does after a failed automatic restart. */
  muteBySdk(): void {
    this.isMuted = true;
    this.emit(TrackEvent.Muted, this);
  }

  /** Creates the capture after a restart (tests give it the capabilities of another lens). */
  createMediaTrack: (options?: VideoCaptureOptions) => FakeMediaStreamTrack = () =>
    new FakeMediaStreamTrack();

  private replaceMediaTrack(options?: VideoCaptureOptions): void {
    this.mediaStreamTrack = this.createMediaTrack(options).asTrack;
    this.emit(TrackEvent.Restarted, this);
  }
}

/** The SDK type of a fake local track (test-only cast: the fake implements the members the publisher uses). */
export function asLocalVideoTrack(track: FakeLocalVideoTrack): LocalVideoTrack {
  return track as unknown as LocalVideoTrack;
}

/** Page lifecycle the test controls. */
export class FakeLifecycle implements PageLifecycle {
  suspended = false;
  disposed = false;
  readonly #listeners = new Set<() => void>();

  onWake(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  wake(): void {
    this.suspended = false;
    for (const listener of [...this.#listeners]) {
      listener();
    }
  }

  dispose(): void {
    this.disposed = true;
    this.#listeners.clear();
  }
}

/** A token as the API returns it. */
export function fakeToken(n = 1): LiveKitTokenDto {
  return {
    url: 'wss://studio.example.test',
    token: `token-${n}`,
    identity: 'dev_aaaaaaaaaaaaaaaa',
    room: 'prd_bbbbbbbbbbbbbbbb',
    expiresAt: '2026-10-22T12:00:00Z',
  };
}

/** Lets pending promise continuations run (several microtask hops). */
export async function flushMicrotasks(rounds = 10): Promise<void> {
  for (let round = 0; round < rounds; round++) {
    await Promise.resolve();
  }
}
