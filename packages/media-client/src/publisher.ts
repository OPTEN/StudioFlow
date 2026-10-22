/**
 * Publishing side of the sender (spec 7 and 8.4): one camera and up to nine screen shares, each with its own slot
 * state machine (`starting → live`, `paused`, `ended`, `failed`, `idle`). Survives rejoins of the {@link MediaSession}
 * by republishing every slot that should be live into the new room.
 */
import { backoffDelay } from '@flowstudio/realtime-client';
import { slotKind, type SlotState, type SlotTelemetryDto } from '@flowstudio/scene-model';
import {
  RoomEvent,
  TrackEvent,
  type LocalVideoTrack,
  type ScreenShareCaptureOptions,
  type TrackPublishOptions,
  type VideoCaptureOptions,
} from 'livekit-client';
import { captureCamera, captureScreen, setContentHint } from './capture';
import {
  cancellableDelay,
  systemClock,
  type CancellableDelay,
  type Clock,
  type TimerHandle,
} from './clock';
import { Listeners } from './listeners';
import { listenTo, type MediaRoom, type RoomListenerGroup } from './livekit-port';
import { consoleLogger, errorContext, type MediaLogger } from './logger';
import { isTerminalState, type MediaSessionState, type SessionStateSource } from './media-session';
import { DeltaRatio } from './media-stats';
import {
  SCREEN_CAPTURE_OPTIONS,
  cameraCaptureOptions,
  cameraPublishOptions,
  isCameraSettings,
  screenPublishOptions,
  type CameraResolution,
  type CameraSettings,
} from './publish-options';
import {
  SLOT_MESSAGES,
  SLOT_PROBLEMS,
  describeCameraFailure,
  describeScreenFailure,
  isPermissionRefusal,
  type SlotFailure,
  type SlotProblem,
} from './slot-failure';
import { slotTelemetry } from './slot-telemetry';

/** Local slot state: the wire `SlotState` plus `idle` (no local state, e.g. after «Teilen beenden» or a cancel). */
export type LocalSlotState = SlotState | 'idle';

/**
 * Slot state listener. `message` is a German explanation for `failed`, cancelled or ended shares; `failure` is the
 * stable cause of a `failed` slot or a cancelled share (`cancelled`), for program logic instead of the text.
 */
export type SlotStateListener = (
  slot: string,
  state: LocalSlotState,
  message?: string,
  failure?: SlotFailure,
) => void;

/** Construction options of {@link Publisher}. */
export interface PublisherOptions {
  /** Camera capture (default livekit `createLocalVideoTrack`). */
  readonly createCameraTrack?: (options: VideoCaptureOptions) => Promise<LocalVideoTrack>;
  /** Screen capture (default livekit `createLocalScreenTracks`); must call getDisplayMedia synchronously. */
  readonly createScreenTrack?: (options: ScreenShareCaptureOptions) => Promise<LocalVideoTrack>;
  /** Wraps a track for the preview `srcObject`; injectable because test DOMs lack a working `MediaStream`. */
  readonly createStream?: (track: MediaStreamTrack) => MediaStream;
  readonly logger?: MediaLogger;
  readonly clock?: Clock;
  readonly random?: () => number;
  /** Time the SDK gets to restart an ended camera by itself before the publisher re-acquires it (default 3 s). */
  readonly cameraRestartGraceMs?: number;
}

/** Local track events the publisher reacts to. */
type ObservedTrackEvent =
  | TrackEvent.Ended
  | TrackEvent.Restarted
  | TrackEvent.Muted
  | TrackEvent.UpstreamPaused
  | TrackEvent.UpstreamResumed;

/** Re-acquire / publish attempts before a slot is `failed`. */
const MAX_RETRIES = 3;
const DEFAULT_CAMERA_RESTART_GRACE_MS = 3000;

interface SlotRecord {
  readonly slot: string;
  readonly kind: 'camera' | 'screen';
  state: LocalSlotState;
  message: string | undefined;
  failure: SlotFailure | undefined;
  track: LocalVideoTrack | null;
  /** Camera settings requested by the user. */
  camera: CameraSettings | null;
  /** Camera settings the current track was captured with. */
  appliedCamera: CameraSettings | null;
  /** Room the current track is published in (compared with the session's room to detect a rejoin). */
  publishedTo: MediaRoom | null;
  publishFailures: number;
  /** Bumped whenever the slot's track lifecycle is cancelled (unpublish, end, failure, session end). */
  epoch: number;
  /** Epoch of a running camera recovery, else null. */
  recovering: number | null;
  /** Serializes all operations of the slot (start, switch, recovery, republish). */
  queue: Promise<void>;
  detachTrack: (() => void) | null;
  graceTimer: TimerHandle | null;
  preview: { readonly source: MediaStreamTrack; readonly stream: MediaStream } | null;
}

function defaultCreateStream(track: MediaStreamTrack): MediaStream {
  return new MediaStream([track]);
}

function sameCamera(a: CameraSettings | null, b: CameraSettings | null): boolean {
  return a !== null && b !== null && a.facingMode === b.facingMode && a.resolution === b.resolution;
}

/** Camera first, then screens by number. */
function slotOrder(slot: string): number {
  return slot === 'camera' ? 0 : Number(slot.slice('screen-'.length));
}

/** True for states in which the slot should be (re)published when the session (re)connects. */
function wantsLive(record: SlotRecord): boolean {
  return record.state === 'starting' || record.state === 'live' || record.state === 'paused';
}

/** Turns a synchronous throw of `operation` into a rejected promise. */
function invokeAsync<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return operation();
  } catch (error) {
    return Promise.reject(error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * Publishes the sender's camera and screens into the room of a {@link SessionStateSource} (normally a sender
 * `MediaSession`). Public methods never reject for runtime problems – those become slot states with a German
 * message – only for invalid arguments (`RangeError`).
 */
export class Publisher {
  readonly #session: SessionStateSource;
  readonly #createCamera: (options: VideoCaptureOptions) => Promise<LocalVideoTrack>;
  readonly #createScreen: (options: ScreenShareCaptureOptions) => Promise<LocalVideoTrack>;
  readonly #createStream: (track: MediaStreamTrack) => MediaStream;
  readonly #logger: MediaLogger;
  readonly #clock: Clock;
  readonly #random: () => number;
  readonly #graceMs: number;
  readonly #records = new Map<string, SlotRecord>();
  readonly #slotListeners: Listeners<
    [string, LocalSlotState, string | undefined, SlotFailure | undefined]
  >;
  readonly #delays = new Set<CancellableDelay>();
  readonly #loss = new DeltaRatio();
  readonly #unsubscribe: readonly (() => void)[];
  #roomEvents: RoomListenerGroup | null = null;
  #disposed = false;

  constructor(session: SessionStateSource, options: PublisherOptions = {}) {
    this.#session = session;
    this.#createCamera = options.createCameraTrack ?? captureCamera;
    this.#createScreen = options.createScreenTrack ?? captureScreen;
    this.#createStream = options.createStream ?? defaultCreateStream;
    this.#logger = options.logger ?? consoleLogger;
    this.#clock = options.clock ?? systemClock;
    this.#random = options.random ?? Math.random;
    this.#graceMs = options.cameraRestartGraceMs ?? DEFAULT_CAMERA_RESTART_GRACE_MS;
    this.#slotListeners = new Listeners((error) =>
      this.#logger.warn('slot state listener failed', errorContext(error)),
    );
    this.#bindRoom(session.room);
    this.#unsubscribe = [
      session.onRoom((room) => this.#bindRoom(room)),
      session.onStateChange((state) => this.#onSessionState(state)),
    ];
  }

  /** Notifies about slot state changes; also re-notifies (same state) when a slot's local preview track changed. */
  onSlotState(listener: SlotStateListener): () => void {
    return this.#slotListeners.add((slot, state, message, failure) => {
      if (message === undefined) {
        listener(slot, state);
      } else if (failure === undefined) {
        listener(slot, state, message);
      } else {
        listener(slot, state, message, failure);
      }
    });
  }

  /** Current state of a slot (`idle` if unknown). */
  slotState(slot: string): LocalSlotState {
    return this.#records.get(slot)?.state ?? 'idle';
  }

  /**
   * Starts the camera (or applies new settings to a running one). Publishes as soon as the session is connected;
   * until then the slot is `starting` and the preview already works.
   */
  publishCamera(slot: string, settings: CameraSettings): Promise<void> {
    if (slotKind(slot) !== 'camera') {
      return Promise.reject(new RangeError(`not a camera slot: ${slot}`));
    }
    if (!isCameraSettings(settings)) {
      return Promise.reject(new RangeError('invalid camera settings'));
    }
    if (this.#disposed) {
      return Promise.resolve();
    }
    const existing = this.#records.get(slot);
    if (existing !== undefined && (existing.track !== null || existing.state === 'starting')) {
      existing.camera = { ...settings };
      return this.#enqueue(existing, () => this.#applyCameraSettings(existing));
    }
    const record = existing ?? this.#createRecord(slot, 'camera');
    record.camera = { ...settings };
    record.epoch += 1;
    const epoch = record.epoch;
    this.#setState(record, 'starting');
    return this.#enqueue(record, () => this.#startCamera(record, epoch));
  }

  /** Toggles front/back camera of the running camera (keeps the slot and the publication; rapid taps coalesce). */
  switchCamera(): Promise<void> {
    const record = this.#records.get('camera');
    if (record === undefined || record.camera === null) {
      return Promise.resolve();
    }
    record.camera = {
      ...record.camera,
      facingMode: record.camera.facingMode === 'user' ? 'environment' : 'user',
    };
    return this.#enqueue(record, () => this.#applyCameraSettings(record));
  }

  /** Changes the camera resolution in place (restartTrack, no republish, no gap for the Regie). */
  setCameraResolution(resolution: CameraResolution): Promise<void> {
    if (resolution !== 720 && resolution !== 1080) {
      return Promise.reject(new RangeError(`invalid camera resolution: ${String(resolution)}`));
    }
    const record = this.#records.get('camera');
    if (record === undefined || record.camera === null) {
      return Promise.resolve();
    }
    record.camera = { ...record.camera, resolution };
    return this.#enqueue(record, () => this.#applyCameraSettings(record));
  }

  /**
   * Shares a screen. MUST be called synchronously from a user gesture: getDisplayMedia is invoked before anything is
   * awaited. A running share of the slot is kept (end it with {@link unpublish} first to pick another surface).
   */
  publishScreen(slot: string): Promise<void> {
    if (slotKind(slot) !== 'screen') {
      return Promise.reject(new RangeError(`not a screen slot: ${slot}`));
    }
    if (this.#disposed) {
      return Promise.resolve();
    }
    const existing = this.#records.get(slot);
    if (existing !== undefined && wantsLive(existing)) {
      return existing.queue;
    }
    const capture = invokeAsync(() => this.#createScreen(SCREEN_CAPTURE_OPTIONS));
    capture.catch(() => undefined);
    const record = existing ?? this.#createRecord(slot, 'screen');
    const previous = record.state;
    record.epoch += 1;
    const epoch = record.epoch;
    this.#setState(record, 'starting');
    return this.#enqueue(record, () => this.#startScreen(record, epoch, capture, previous));
  }

  /** Stops and unpublishes a slot; its state becomes `idle`. */
  async unpublish(slot: string): Promise<void> {
    const record = this.#records.get(slot);
    if (record === undefined) {
      return;
    }
    this.#records.delete(slot);
    record.epoch += 1;
    await this.#releaseTrack(record);
    this.#setState(record, 'idle');
  }

  /** Stops and unpublishes every slot. */
  async stopAll(): Promise<void> {
    await Promise.all([...this.#records.keys()].map((slot) => this.unpublish(slot)));
  }

  /** Telemetry of every slot for the device report (camera first). */
  async getSlotTelemetry(): Promise<SlotTelemetryDto[]> {
    const records = [...this.#records.values()].sort(
      (a, b) => slotOrder(a.slot) - slotOrder(b.slot),
    );
    const inputs = records.flatMap((record) =>
      record.state === 'idle'
        ? []
        : [
            {
              slot: record.slot,
              state: record.state,
              track: record.track,
              published: this.#isPublishedNow(record),
            },
          ],
    );
    return Promise.all(inputs.map((input) => slotTelemetry(input, this.#loss, this.#logger)));
  }

  /** Stream of the slot's local track for the sender's own preview `<video>` (same object while the track is). */
  localPreview(slot: string): MediaStream | null {
    const record = this.#records.get(slot);
    const source = record?.track?.mediaStreamTrack;
    if (record === undefined || source === undefined) {
      return null;
    }
    if (record.preview?.source !== source) {
      record.preview = { source, stream: this.#createStream(source) };
    }
    return record.preview.stream;
  }

  /** Releases every device and listener without emitting further slot states. */
  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    for (const unsubscribe of this.#unsubscribe) {
      unsubscribe();
    }
    this.#roomEvents?.dispose();
    this.#roomEvents = null;
    for (const delay of this.#delays) {
      delay.cancel();
    }
    this.#delays.clear();
    this.#slotListeners.clear();
    for (const record of this.#records.values()) {
      record.epoch += 1;
      void this.#releaseTrack(record);
    }
    this.#records.clear();
  }

  #createRecord(slot: string, kind: SlotRecord['kind']): SlotRecord {
    const record: SlotRecord = {
      slot,
      kind,
      state: 'idle',
      message: undefined,
      failure: undefined,
      track: null,
      camera: null,
      appliedCamera: null,
      publishedTo: null,
      publishFailures: 0,
      epoch: 0,
      recovering: null,
      queue: Promise.resolve(),
      detachTrack: null,
      graceTimer: null,
      preview: null,
    };
    this.#records.set(slot, record);
    return record;
  }

  #isStale(record: SlotRecord, epoch: number): boolean {
    return this.#disposed || record.epoch !== epoch || this.#records.get(record.slot) !== record;
  }

  /** True while the slot's track is published in the session's current room. */
  #isPublishedNow(record: SlotRecord): boolean {
    return record.publishedTo !== null && record.publishedTo === this.#session.room;
  }

  #enqueue(record: SlotRecord, operation: () => Promise<void>): Promise<void> {
    const next = record.queue
      .then(operation)
      .catch((error: unknown) =>
        this.#logger.warn('slot operation failed', { slot: record.slot, ...errorContext(error) }),
      );
    record.queue = next;
    return next;
  }

  async #startCamera(record: SlotRecord, epoch: number): Promise<void> {
    const acquired = await this.#acquireCamera(record, epoch);
    if (acquired === null) {
      return;
    }
    this.#adoptTrack(record, acquired.track);
    record.appliedCamera = acquired.settings;
    await this.#publish(record);
  }

  /** getUserMedia with up to three retries for transient errors; null (slot failed or stale) on failure. */
  async #acquireCamera(
    record: SlotRecord,
    epoch: number,
  ): Promise<{ readonly track: LocalVideoTrack; readonly settings: CameraSettings } | null> {
    for (let attempt = 0; ; attempt++) {
      const settings = record.camera;
      if (settings === null || this.#isStale(record, epoch)) {
        return null;
      }
      try {
        const track = await this.#createCamera(cameraCaptureOptions(settings));
        if (this.#isStale(record, epoch)) {
          track.stop();
          return null;
        }
        setContentHint(track.mediaStreamTrack, 'motion');
        return { track, settings };
      } catch (error) {
        if (this.#isStale(record, epoch)) {
          return null;
        }
        const failure = describeCameraFailure(error);
        this.#logger.warn('camera acquisition failed', { attempt, ...errorContext(error) });
        if (!failure.transient || attempt >= MAX_RETRIES) {
          this.#fail(record, failure);
          return null;
        }
        if (!(await this.#sleep(backoffDelay(attempt + 1, this.#random)))) {
          return null;
        }
      }
    }
  }

  async #startScreen(
    record: SlotRecord,
    epoch: number,
    capture: Promise<LocalVideoTrack>,
    previous: LocalSlotState,
  ): Promise<void> {
    let track: LocalVideoTrack;
    try {
      track = await capture;
    } catch (error) {
      if (!this.#isStale(record, epoch)) {
        this.#onScreenCaptureFailed(record, previous, error);
      }
      return;
    }
    if (this.#isStale(record, epoch)) {
      track.stop();
      return;
    }
    setContentHint(track.mediaStreamTrack, 'detail');
    this.#adoptTrack(record, track);
    await this.#publish(record);
  }

  /** A cancelled picker returns to where the slot was (`ended` stays `ended`, else `idle`); other errors fail. */
  #onScreenCaptureFailed(record: SlotRecord, previous: LocalSlotState, error: unknown): void {
    if (!isPermissionRefusal(error)) {
      this.#logger.warn('screen capture failed', errorContext(error));
      this.#fail(record, describeScreenFailure(error));
      return;
    }
    const next = previous === 'ended' ? 'ended' : 'idle';
    if (next === 'idle') {
      this.#records.delete(record.slot);
    }
    this.#setState(record, next, SLOT_PROBLEMS.shareCancelled);
  }

  /** Applies `record.camera` to the running track via restartTrack (facing mode or resolution change). */
  async #applyCameraSettings(record: SlotRecord): Promise<void> {
    const { track, camera: target, epoch } = record;
    if (track === null || target === null || sameCamera(record.appliedCamera, target)) {
      return;
    }
    try {
      await track.restartTrack(cameraCaptureOptions(target));
    } catch (error) {
      if (this.#isStale(record, epoch) || record.track !== track) {
        return;
      }
      this.#logger.warn('camera restart with new settings failed', errorContext(error));
      record.camera = record.appliedCamera;
      if (track.mediaStreamTrack.readyState === 'live') {
        this.#setState(record, record.state, SLOT_MESSAGES.cameraSwitchFailed);
      } else {
        this.#recoverCamera(record);
      }
      return;
    }
    if (this.#isStale(record, epoch) || record.track !== track) {
      return;
    }
    record.appliedCamera = target;
    setContentHint(track.mediaStreamTrack, 'motion');
    this.#notifyPreview(record);
  }

  /** Re-acquires a camera that stopped delivering frames: up to three attempts with backoff, then `failed`. */
  #recoverCamera(record: SlotRecord): void {
    const track = record.track;
    if (track === null || record.recovering === record.epoch) {
      return;
    }
    const epoch = record.epoch;
    record.recovering = epoch;
    this.#clearGrace(record);
    this.#setState(record, 'starting');
    void this.#enqueue(record, async () => {
      try {
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
          if (
            !(await this.#sleep(backoffDelay(attempt, this.#random))) ||
            this.#isStale(record, epoch)
          ) {
            return;
          }
          if (await this.#tryRestart(record, track)) {
            if (this.#isStale(record, epoch)) {
              return;
            }
            record.recovering = null;
            setContentHint(track.mediaStreamTrack, 'motion');
            this.#setState(record, this.#isPublishedNow(record) ? 'live' : 'starting');
            await this.#publish(record);
            return;
          }
        }
        if (!this.#isStale(record, epoch)) {
          this.#fail(record, SLOT_PROBLEMS.cameraLost);
        }
      } finally {
        if (record.recovering === epoch) {
          record.recovering = null;
        }
      }
    });
  }

  async #tryRestart(record: SlotRecord, track: LocalVideoTrack): Promise<boolean> {
    const settings = record.appliedCamera ?? record.camera;
    try {
      if (track.isMuted) {
        await track.unmute();
      } else {
        await track.restartTrack(settings === null ? undefined : cameraCaptureOptions(settings));
      }
    } catch (error) {
      this.#logger.warn('camera re-acquire failed', errorContext(error));
      return false;
    }
    return track.mediaStreamTrack.readyState === 'live';
  }

  /** Publishes the slot's track into the session's room if connected and not yet published there. */
  async #publish(record: SlotRecord): Promise<void> {
    const room = this.#session.room;
    const { track, epoch } = record;
    if (
      track === null ||
      room === null ||
      this.#session.state !== 'connected' ||
      record.publishedTo === room
    ) {
      return;
    }
    try {
      await room.localParticipant.publishTrack(track, this.#publishOptions(record));
    } catch (error) {
      await this.#onPublishFailed(record, epoch, track, room, error);
      return;
    }
    if (this.#isStale(record, epoch) || record.track !== track) {
      void this.#unpublishFrom(room, track);
      return;
    }
    if (this.#session.room !== room) {
      // Rejoined meanwhile: the `connected` handler of the new room republishes.
      return;
    }
    record.publishedTo = room;
    record.publishFailures = 0;
    if (record.recovering === null && record.state !== 'paused') {
      this.#setState(record, 'live');
    }
  }

  /** Retries a failed publish while the room is still connected; a lost room is handled by the next `connected`. */
  async #onPublishFailed(
    record: SlotRecord,
    epoch: number,
    track: LocalVideoTrack,
    room: MediaRoom,
    error: unknown,
  ): Promise<void> {
    if (this.#isStale(record, epoch) || record.track !== track) {
      return;
    }
    if (this.#session.room !== room || this.#session.state !== 'connected') {
      return;
    }
    record.publishFailures += 1;
    this.#logger.warn('publish failed', {
      slot: record.slot,
      attempt: record.publishFailures,
      ...errorContext(error),
    });
    if (record.publishFailures > MAX_RETRIES) {
      this.#fail(record, SLOT_PROBLEMS.publishFailed);
      return;
    }
    if (
      (await this.#sleep(backoffDelay(record.publishFailures, this.#random))) &&
      !this.#isStale(record, epoch)
    ) {
      await this.#publish(record);
    }
  }

  #publishOptions(record: SlotRecord): TrackPublishOptions {
    return record.kind === 'camera'
      ? cameraPublishOptions(
          record.slot,
          (record.appliedCamera ?? record.camera)?.resolution ?? 720,
        )
      : screenPublishOptions(record.slot);
  }

  /** After a rejoin: republish a live slot; re-acquire a camera stopped meanwhile; a dead screen share is `ended`. */
  async #republish(record: SlotRecord): Promise<void> {
    if (this.#isStale(record, record.epoch) || !wantsLive(record) || record.recovering !== null) {
      return;
    }
    const trackAlive = record.track !== null && record.track.mediaStreamTrack.readyState === 'live';
    if (record.kind === 'screen' && !trackAlive) {
      await this.#endScreen(record);
      return;
    }
    if (record.kind === 'camera' && !trackAlive) {
      record.epoch += 1;
      await this.#releaseTrack(record);
      this.#setState(record, 'starting');
      await this.#startCamera(record, record.epoch);
      return;
    }
    await this.#publish(record);
  }

  #adoptTrack(record: SlotRecord, track: LocalVideoTrack): void {
    record.detachTrack?.();
    record.track = track;
    record.publishedTo = null;
    record.publishFailures = 0;
    const guarded =
      (handler: () => void): (() => void) =>
      () => {
        try {
          handler();
        } catch (error) {
          this.#logger.warn('track event handler failed', errorContext(error));
        }
      };
    const handlers: readonly (readonly [ObservedTrackEvent, () => void])[] =
      record.kind === 'screen'
        ? [[TrackEvent.Ended, guarded(() => this.#onScreenEnded(record, track))]]
        : [
            [TrackEvent.Ended, guarded(() => this.#onCameraEnded(record, track))],
            [TrackEvent.Restarted, guarded(() => this.#onCameraRestarted(record, track))],
            [TrackEvent.Muted, guarded(() => this.#onCameraMuted(record, track))],
            [TrackEvent.UpstreamPaused, guarded(() => this.#onUpstream(record, track, true))],
            [TrackEvent.UpstreamResumed, guarded(() => this.#onUpstream(record, track, false))],
          ];
    for (const [event, handler] of handlers) {
      track.on(event, handler);
    }
    record.detachTrack = () => {
      for (const [event, handler] of handlers) {
        track.off(event, handler);
      }
    };
    this.#notifyPreview(record);
  }

  /** The SDK restarts an ended camera itself; only if that has not worked after the grace time we step in. */
  #onCameraEnded(record: SlotRecord, track: LocalVideoTrack): void {
    if (record.track !== track || record.recovering !== null || record.graceTimer !== null) {
      return;
    }
    record.graceTimer = this.#clock.setTimeout(() => {
      record.graceTimer = null;
      if (record.track === track && track.mediaStreamTrack.readyState !== 'live') {
        this.#recoverCamera(record);
      }
    }, this.#graceMs);
  }

  #onCameraRestarted(record: SlotRecord, track: LocalVideoTrack): void {
    if (record.track !== track) {
      return;
    }
    this.#clearGrace(record);
    setContentHint(track.mediaStreamTrack, 'motion');
    this.#notifyPreview(record);
  }

  /** The SDK mutes a camera whose automatic restart failed (the publisher never mutes itself). */
  #onCameraMuted(record: SlotRecord, track: LocalVideoTrack): void {
    if (record.track === track && track.isMuted) {
      this.#recoverCamera(record);
    }
  }

  /** Phone in background or camera interrupted by the OS: the SDK pauses the upstream until frames return. */
  #onUpstream(record: SlotRecord, track: LocalVideoTrack, paused: boolean): void {
    if (record.track !== track) {
      return;
    }
    if (paused && record.state === 'live') {
      this.#setState(record, 'paused');
    } else if (!paused && record.state === 'paused') {
      this.#setState(record, this.#isPublishedNow(record) ? 'live' : 'starting');
    }
  }

  /** The user pressed «Freigabe beenden» (or the shared window closed): never restarted automatically. */
  #onScreenEnded(record: SlotRecord, track: LocalVideoTrack): void {
    if (record.track === track) {
      void this.#endScreen(record);
    }
  }

  async #endScreen(record: SlotRecord): Promise<void> {
    record.epoch += 1;
    this.#setState(record, 'ended', SLOT_MESSAGES.shareEnded);
    await this.#releaseTrack(record);
  }

  #fail(record: SlotRecord, problem: SlotProblem): void {
    record.epoch += 1;
    this.#setState(record, 'failed', problem);
    void this.#releaseTrack(record);
  }

  /** Stops the track (releasing the device at once) and unpublishes it from the room it was published in. */
  async #releaseTrack(record: SlotRecord): Promise<void> {
    const { track, publishedTo } = record;
    this.#clearGrace(record);
    record.detachTrack?.();
    record.detachTrack = null;
    record.track = null;
    record.publishedTo = null;
    record.preview = null;
    if (track === null) {
      return;
    }
    const unpublishing =
      publishedTo === null ? Promise.resolve() : this.#unpublishFrom(publishedTo, track);
    try {
      track.stop();
    } catch (error) {
      this.#logger.warn('track stop failed', errorContext(error));
    }
    await unpublishing;
  }

  async #unpublishFrom(room: MediaRoom, track: LocalVideoTrack): Promise<void> {
    try {
      await room.localParticipant.unpublishTrack(track, false);
    } catch (error) {
      this.#logger.warn('unpublish failed', errorContext(error));
    }
  }

  #onSessionState(state: MediaSessionState): void {
    if (state === 'connected') {
      for (const record of this.#records.values()) {
        if (!this.#isPublishedNow(record) && wantsLive(record)) {
          void this.#enqueue(record, () => this.#republish(record));
        }
      }
    } else if (isTerminalState(state)) {
      this.#releaseForTerminalSession();
    }
  }

  /**
   * Replaced, removed, unauthorized or stopped: free the devices (another tab may need the camera). The camera stays
   * wanted (`paused`) and is re-acquired when the session connects again; a screen share cannot come back without a
   * user gesture and becomes `ended`.
   */
  #releaseForTerminalSession(): void {
    for (const record of this.#records.values()) {
      if (!wantsLive(record)) {
        continue;
      }
      record.epoch += 1;
      record.recovering = null;
      void this.#releaseTrack(record);
      if (record.kind === 'camera') {
        this.#setState(record, 'paused');
      } else {
        this.#setState(record, 'ended', SLOT_MESSAGES.shareEnded);
      }
    }
  }

  #bindRoom(room: MediaRoom | null): void {
    this.#roomEvents?.dispose();
    this.#roomEvents = null;
    if (room === null || this.#disposed) {
      return;
    }
    this.#roomEvents = listenTo(room, (error) =>
      this.#logger.warn('publisher room handler failed', errorContext(error)),
    ).on(RoomEvent.MediaDevicesError, (error, kind) => {
      const camera = this.#records.get('camera');
      if (
        (kind === undefined || kind === 'videoinput') &&
        camera !== undefined &&
        camera.track !== null &&
        wantsLive(camera)
      ) {
        this.#logger.warn('media devices error', errorContext(error));
        this.#recoverCamera(camera);
      }
    });
  }

  #notifyPreview(record: SlotRecord): void {
    this.#slotListeners.emit(record.slot, record.state, record.message, record.failure);
  }

  /** Sets the state with an optional German message (a string) or a problem (message plus failure code). */
  #setState(record: SlotRecord, state: LocalSlotState, detail?: string | SlotProblem): void {
    const message = typeof detail === 'string' ? detail : detail?.message;
    const failure = typeof detail === 'object' ? detail.failure : undefined;
    if (record.state === state && record.message === message && record.failure === failure) {
      return;
    }
    record.state = state;
    record.message = message;
    record.failure = failure;
    this.#slotListeners.emit(record.slot, state, message, failure);
  }

  #clearGrace(record: SlotRecord): void {
    if (record.graceTimer !== null) {
      this.#clock.clearTimeout(record.graceTimer);
      record.graceTimer = null;
    }
  }

  /** Cancellable pause; false when the publisher was disposed meanwhile. */
  async #sleep(delayMs: number): Promise<boolean> {
    const delay = cancellableDelay(delayMs, this.#clock);
    this.#delays.add(delay);
    const elapsed = await delay.done;
    this.#delays.delete(delay);
    return elapsed && !this.#disposed;
  }
}
