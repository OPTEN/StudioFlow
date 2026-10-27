/**
 * Publishing side of the sender (spec 7 and 8.4): one camera and up to nine screen shares, each with its own slot
 * state machine (`starting → live`, `paused`, `ended`, `failed`, `idle`). Survives rejoins of the {@link MediaSession}
 * by republishing every slot that should be live into the new room.
 */
import { backoffDelay } from '@studioflow/realtime-client';
import {
  slotKind,
  type CameraControlDto,
  type CameraStateDto,
  type SlotState,
  type SlotTelemetryDto,
} from '@studioflow/scene-model';
import {
  RoomEvent,
  TrackEvent,
  type LocalVideoTrack,
  type ScreenShareCaptureOptions,
  type TrackPublishOptions,
  type VideoCaptureOptions,
} from 'livekit-client';
import {
  CAMERA_PROTOCOL_VERSION,
  applyCommand,
  cameraProblemOf,
  imageConstraints,
  listLenses,
  mapCapabilities,
  mapSettings,
  mergeCameraControl,
  settleImage,
  type CameraImageSettings,
  type CameraProblem,
} from './camera-control';
import { captureCamera, captureScreen, setContentHint } from './capture';
import {
  cancellableDelay,
  systemClock,
  type CancellableDelay,
  type Clock,
  type TimerHandle,
} from './clock';
import { EncoderCapability } from './encoder-info';
import { Listeners } from './listeners';
import { listenTo, type MediaRoom, type RoomListenerGroup } from './livekit-port';
import { consoleLogger, errorContext, type MediaLogger } from './logger';
import { isTerminalState, type MediaSessionState, type SessionStateSource } from './media-session';
import { DeltaRatio } from './media-stats';
import {
  SCREEN_FRAME_RATE_DEFAULT,
  cameraCaptureOptions,
  cameraPublishOptions,
  contentHintOf,
  isCameraSettings,
  isScreenFrameRate,
  screenCaptureOptions,
  screenPublishOptions,
  screenShareEncoding,
  type CameraResolution,
  type CameraSettings,
  type FacingMode,
  type ScreenFrameRate,
} from './publish-options';
import {
  browserCapabilities,
  chooseScreenCodec,
  probeScreenCodecs,
  type ScreenCodec,
} from './screen-codec';
import {
  SLOT_PROBLEMS,
  describeCameraFailure,
  describeScreenFailure,
  isPermissionRefusal,
  type SlotFailure,
  type SlotMessageKey,
  type SlotProblem,
} from './slot-failure';
import { slotTelemetry } from './slot-telemetry';

/** Local slot state: the wire `SlotState` plus `idle` (no local state, e.g. after “Stop sharing” or a cancel). */
export type LocalSlotState = SlotState | 'idle';

/**
 * Slot state listener. `messageKey` is the message (a key of the `media.slot.*` catalogue, shown in the language of
 * the reader) for `failed`, cancelled or ended shares; `failure` is the stable cause of a `failed` slot or a cancelled
 * share (`cancelled`), for program logic instead of the text.
 */
export type SlotStateListener = (
  slot: string,
  state: LocalSlotState,
  messageKey?: SlotMessageKey,
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
  /** Lists the media devices for the lens picker (default `navigator.mediaDevices.enumerateDevices`). */
  readonly listDevices?: () => Promise<readonly MediaDeviceInfo[]>;
  /**
   * Codec of screen shares (default: VP9 only when the browser reports a power-efficient VP9 encoder, else H.264, see
   * `screen-codec.ts`). Asked once, when the first screen is shared.
   */
  readonly screenCodec?: () => Promise<ScreenCodec>;
  /** Answers `MediaCapabilities` questions about encoders for the telemetry (injectable in tests). */
  readonly encoderCapability?: EncoderCapability;
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
  messageKey: SlotMessageKey | undefined;
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
  /** Remote camera commands waiting for the slot's queue, merged (the last command wins). */
  pendingControl: CameraControlDto | null;
  /** Why the camera refused the last remote command, null once one works again. */
  cameraProblem: CameraProblem | null;
}

function defaultCreateStream(track: MediaStreamTrack): MediaStream {
  return new MediaStream([track]);
}

function sameCamera(a: CameraSettings | null, b: CameraSettings | null): boolean {
  return (
    a !== null &&
    b !== null &&
    a.facingMode === b.facingMode &&
    a.resolution === b.resolution &&
    a.deviceId === b.deviceId
  );
}

function defaultListDevices(): Promise<readonly MediaDeviceInfo[]> {
  return typeof navigator === 'undefined' || navigator.mediaDevices === undefined
    ? Promise.resolve([])
    : navigator.mediaDevices.enumerateDevices();
}

/** `getCapabilities()` where the browser has it (Firefox has none): unknown means no remote controls. */
function capabilitiesOf(track: MediaStreamTrack): MediaTrackCapabilities {
  try {
    return typeof track.getCapabilities === 'function' ? track.getCapabilities() : {};
  } catch {
    return {};
  }
}

/** The facing mode a camera reports (`user` / `environment`), else null. */
function facingOf(track: MediaStreamTrack): FacingMode | null {
  const facing = track.getSettings().facingMode;
  return facing === 'user' || facing === 'environment' ? facing : null;
}

/** Image settings without the zoom: another lens frames differently, so its zoom starts over. */
function withoutZoom(image: CameraImageSettings | undefined): CameraImageSettings {
  const { zoom: _zoom, ...rest } = image ?? {};
  return rest;
}

/** The codec of screens from what the browser reports (never rejects: unknown means H.264). */
async function defaultScreenCodec(): Promise<ScreenCodec> {
  const capture = screenCaptureOptions().resolution;
  const probe = await probeScreenCodecs(browserCapabilities(), {
    width: capture?.width ?? 2560,
    height: capture?.height ?? 1440,
    framerate: SCREEN_FRAME_RATE_DEFAULT,
    bitrate: screenShareEncoding(SCREEN_FRAME_RATE_DEFAULT).maxBitrate ?? 3_000_000,
  });
  return chooseScreenCodec(probe);
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
 * `MediaSession`). Public methods never reject for runtime problems – those become slot states with a message key –
 * only for invalid arguments (`RangeError`).
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
  readonly #listDevices: () => Promise<readonly MediaDeviceInfo[]>;
  readonly #chooseScreenCodec: () => Promise<ScreenCodec>;
  readonly #encoders: EncoderCapability;
  /** Frame rate per screen slot (the option "Video in screen"); lives on after the share ended. */
  readonly #screenRates = new Map<string, ScreenFrameRate>();
  #screenCodec: Promise<ScreenCodec> | null = null;
  readonly #records = new Map<string, SlotRecord>();
  readonly #cameraListeners: Listeners<[CameraSettings]>;
  readonly #slotListeners: Listeners<
    [string, LocalSlotState, SlotMessageKey | undefined, SlotFailure | undefined]
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
    this.#listDevices = options.listDevices ?? defaultListDevices;
    this.#chooseScreenCodec = options.screenCodec ?? defaultScreenCodec;
    this.#encoders = options.encoderCapability ?? new EncoderCapability();
    this.#slotListeners = new Listeners((error) =>
      this.#logger.warn('slot state listener failed', errorContext(error)),
    );
    this.#cameraListeners = new Listeners((error) =>
      this.#logger.warn('camera settings listener failed', errorContext(error)),
    );
    this.#bindRoom(session.room);
    this.#unsubscribe = [
      session.onRoom((room) => this.#bindRoom(room)),
      session.onStateChange((state) => this.#onSessionState(state)),
    ];
  }

  /** Notifies about slot state changes; also re-notifies (same state) when a slot's local preview track changed. */
  onSlotState(listener: SlotStateListener): () => void {
    return this.#slotListeners.add((slot, state, messageKey, failure) => {
      if (messageKey === undefined) {
        listener(slot, state);
      } else if (failure === undefined) {
        listener(slot, state, messageKey);
      } else {
        listener(slot, state, messageKey, failure);
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

  /**
   * Toggles front/back camera of the running camera (keeps the slot and the publication; rapid taps coalesce). A lens
   * chosen remotely is given up, and so is its zoom.
   */
  switchCamera(): Promise<void> {
    const record = this.#records.get('camera');
    if (record === undefined || record.camera === null) {
      return Promise.resolve();
    }
    const { deviceId: _lens, ...camera } = record.camera;
    record.camera = {
      ...camera,
      facingMode: camera.facingMode === 'user' ? 'environment' : 'user',
      image: withoutZoom(camera.image),
    };
    return this.#enqueue(record, () => this.#applyCameraSettings(record));
  }

  /** Notifies when a remote camera command changed the camera settings (lens, image), so the sender can keep them. */
  onCameraSettings(listener: (settings: CameraSettings) => void): () => void {
    return this.#cameraListeners.add(listener);
  }

  /**
   * Applies a remote camera command (issue #11) to the camera: the lens is switched in place (restartTrack, no
   * republish), zoom, focus, brightness and light with `applyConstraints`, only where the camera supports them.
   * Commands arriving while one is applied merge, so the newest value of each setting wins. Never rejects: a refusal
   * shows up as `problem` in {@link getCameraState}.
   */
  controlCamera(command: CameraControlDto): Promise<void> {
    const record = this.#records.get('camera');
    if (this.#disposed || record === undefined || record.camera === null) {
      return Promise.resolve();
    }
    record.pendingControl =
      record.pendingControl === null ? command : mergeCameraControl(record.pendingControl, command);
    return this.#enqueue(record, () => this.#applyControl(record));
  }

  /**
   * What the running camera can do and does now, for the device report (null without a live camera). Read fresh every
   * time, so a lens switch or a changed capability shows up with the next report.
   */
  async getCameraState(): Promise<CameraStateDto | null> {
    const record = this.#records.get('camera');
    const media = record?.track?.mediaStreamTrack;
    if (record === undefined || media === undefined || media.readyState !== 'live') {
      return null;
    }
    const lenses = await listLenses(this.#listDevices);
    return {
      v: CAMERA_PROTOCOL_VERSION,
      capabilities: mapCapabilities(capabilitiesOf(media), lenses),
      settings: mapSettings(media.getSettings()),
      problem: record.cameraProblem,
    };
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
    const frameRate = this.screenFrameRate(slot);
    const capture = invokeAsync(() => this.#createScreen(screenCaptureOptions(frameRate)));
    capture.catch(() => undefined);
    void this.#codecOfScreens();
    const record = existing ?? this.#createRecord(slot, 'screen');
    const previous = record.state;
    record.epoch += 1;
    const epoch = record.epoch;
    this.#setState(record, 'starting');
    return this.#enqueue(record, () => this.#startScreen(record, epoch, capture, previous));
  }

  /** Frame rate of a screen slot: 15 fps unless the slot has the option "Video in screen" (30 fps). */
  screenFrameRate(slot: string): ScreenFrameRate {
    return this.#screenRates.get(slot) ?? SCREEN_FRAME_RATE_DEFAULT;
  }

  /**
   * Sets the frame rate of a screen slot. It is used by the next share of the slot and, when the slot is sharing now,
   * applied to the running share (capture constraint, content hint and encoder limits), without a new picker.
   */
  setScreenFrameRate(slot: string, frameRate: ScreenFrameRate): Promise<void> {
    if (slotKind(slot) !== 'screen' || !isScreenFrameRate(frameRate)) {
      return Promise.reject(
        new RangeError(`invalid screen frame rate: ${slot} ${String(frameRate)}`),
      );
    }
    this.#screenRates.set(slot, frameRate);
    const record = this.#records.get(slot);
    if (record === undefined || record.track === null || this.#disposed) {
      return Promise.resolve();
    }
    return this.#enqueue(record, () => this.#applyScreenFrameRate(record));
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
    return Promise.all(
      inputs.map((input) => slotTelemetry(input, this.#loss, this.#logger, this.#encoders)),
    );
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
    this.#cameraListeners.clear();
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
      messageKey: undefined,
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
      pendingControl: null,
      cameraProblem: null,
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
    await this.#applyImage(record);
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
        if (settings.deviceId !== undefined && cameraProblemOf(error) === 'overconstrained') {
          // The chosen lens is gone (another browser profile, a reset device): fall back to the facing mode.
          this.#logger.warn('chosen lens not available', errorContext(error));
          const { deviceId: _gone, ...fallback } = settings;
          record.camera = { ...fallback, image: withoutZoom(fallback.image) };
          continue;
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
    setContentHint(track.mediaStreamTrack, contentHintOf(this.screenFrameRate(record.slot)));
    this.#adoptTrack(record, track);
    await this.#publish(record);
  }

  /** The codec of screen shares, asked once. */
  #codecOfScreens(): Promise<ScreenCodec> {
    this.#screenCodec ??= this.#chooseScreenCodec().catch((error: unknown) => {
      this.#logger.warn('screen codec probe failed', errorContext(error));
      return 'h264';
    });
    return this.#screenCodec;
  }

  /** Applies the frame rate of the slot to the running share (best effort: what a browser refuses stays as it was). */
  async #applyScreenFrameRate(record: SlotRecord): Promise<void> {
    const { track, epoch } = record;
    if (track === null || this.#isStale(record, epoch)) {
      return;
    }
    const frameRate = this.screenFrameRate(record.slot);
    setContentHint(track.mediaStreamTrack, contentHintOf(frameRate));
    try {
      await track.mediaStreamTrack.applyConstraints({ frameRate: { ideal: frameRate } });
    } catch (error) {
      this.#logger.warn('screen frame rate constraint refused', errorContext(error));
    }
    const sender = track.sender;
    if (sender === undefined) {
      return;
    }
    try {
      const parameters = sender.getParameters();
      const encoding = screenShareEncoding(frameRate);
      for (const layer of parameters.encodings ?? []) {
        layer.maxFramerate = encoding.maxFramerate;
        layer.maxBitrate = encoding.maxBitrate;
      }
      await sender.setParameters(parameters);
    } catch (error) {
      this.#logger.warn('screen encoder limits refused', errorContext(error));
    }
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
      record.cameraProblem = cameraProblemOf(error);
      if (track.mediaStreamTrack.readyState === 'live') {
        this.#setState(record, record.state, 'media.slot.cameraSwitchFailed');
      } else {
        this.#recoverCamera(record);
      }
      return;
    }
    if (this.#isStale(record, epoch) || record.track !== track) {
      return;
    }
    // A lens chosen by id faces wherever it faces: the front/back toggle continues from there.
    const facing = target.deviceId === undefined ? null : facingOf(track.mediaStreamTrack);
    record.appliedCamera = facing === null ? target : { ...target, facingMode: facing };
    if (record.camera === target) {
      record.camera = record.appliedCamera;
    }
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
      const options = await this.#publishOptions(record);
      if (this.#isStale(record, epoch) || record.track !== track) {
        return;
      }
      await room.localParticipant.publishTrack(track, options);
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

  async #publishOptions(record: SlotRecord): Promise<TrackPublishOptions> {
    return record.kind === 'camera'
      ? cameraPublishOptions(
          record.slot,
          (record.appliedCamera ?? record.camera)?.resolution ?? 720,
        )
      : screenPublishOptions(
          record.slot,
          await this.#codecOfScreens(),
          this.screenFrameRate(record.slot),
        );
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
    // A restarted capture starts with the camera's defaults: bring back zoom, focus, brightness and light.
    void this.#enqueue(record, () => this.#applyImage(record));
  }

  /**
   * Applies one remote command (the merged pending ones): reset, lens switch in place (its zoom starts over unless the
   * command sets one), then the image settings. Tells the listeners what the camera now keeps.
   */
  async #applyControl(record: SlotRecord): Promise<void> {
    const command = record.pendingControl;
    const before = record.camera;
    record.pendingControl = null;
    if (command === null || before === null || this.#isStale(record, record.epoch)) {
      return;
    }
    const currentLens = before.deviceId ?? record.track?.mediaStreamTrack.getSettings().deviceId;
    const lensId = command.lensId ?? undefined;
    const switchLens = lensId !== undefined && lensId !== currentLens;
    const image = applyCommand(before.image ?? {}, command);
    record.camera = {
      ...before,
      ...(switchLens ? { deviceId: lensId } : {}),
      image: switchLens && command.zoom == null ? withoutZoom(image) : image,
    };
    if (switchLens) {
      await this.#applyCameraSettings(record);
    }
    const lensProblem =
      switchLens && record.camera?.deviceId !== lensId ? record.cameraProblem : null;
    await this.#applyImage(record, command.reset === true);
    if (lensProblem !== null) {
      record.cameraProblem = lensProblem;
    }
    if (record.camera !== null) {
      this.#cameraListeners.emit(record.camera);
    }
  }

  /**
   * Applies the requested image settings (`record.camera.image`) to the running camera, clamped to what it can do;
   * with `reset` the others go back to automatic. Afterwards the settings follow what the camera really did, and a
   * refusal (an `OverconstrainedError`, or a value the camera silently ignored) is kept as `cameraProblem`.
   */
  async #applyImage(record: SlotRecord, reset = false): Promise<void> {
    const { track, camera } = record;
    if (track === null || camera === null) {
      return;
    }
    const media = track.mediaStreamTrack;
    const capabilities = capabilitiesOf(media);
    const constraints = imageConstraints(
      camera.image ?? {},
      capabilities,
      media.getSettings(),
      reset,
    );
    if (constraints === null) {
      return;
    }
    let problem: CameraProblem | null = null;
    try {
      await media.applyConstraints({ advanced: [constraints] });
    } catch (error) {
      this.#logger.warn('camera control refused', errorContext(error));
      problem = cameraProblemOf(error);
    }
    if (record.track !== track || record.camera === null) {
      return;
    }
    const settled = settleImage(constraints, media.getSettings(), capabilities);
    record.cameraProblem = problem ?? (settled.refused ? 'overconstrained' : null);
    // After a reset only what the command set stays requested; the automatic values are the camera's own.
    const requested = record.camera.image ?? {};
    const kept = reset
      ? Object.fromEntries(Object.entries(settled.image).filter(([key]) => key in requested))
      : settled.image;
    record.camera = { ...record.camera, image: { ...requested, ...kept } };
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

  /** The user pressed the browser's “Stop sharing” (or the shared window closed): never restarted automatically. */
  #onScreenEnded(record: SlotRecord, track: LocalVideoTrack): void {
    if (record.track === track) {
      void this.#endScreen(record);
    }
  }

  async #endScreen(record: SlotRecord): Promise<void> {
    record.epoch += 1;
    this.#setState(record, 'ended', 'media.slot.shareEnded');
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
        this.#setState(record, 'ended', 'media.slot.shareEnded');
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
    this.#slotListeners.emit(record.slot, record.state, record.messageKey, record.failure);
  }

  /** Sets the state with an optional message key or a problem (message key plus failure code). */
  #setState(
    record: SlotRecord,
    state: LocalSlotState,
    detail?: SlotMessageKey | SlotProblem,
  ): void {
    const messageKey = typeof detail === 'string' ? detail : detail?.messageKey;
    const failure = typeof detail === 'object' ? detail.failure : undefined;
    if (record.state === state && record.messageKey === messageKey && record.failure === failure) {
      return;
    }
    record.state = state;
    record.messageKey = messageKey;
    record.failure = failure;
    this.#slotListeners.emit(record.slot, state, messageKey, failure);
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
