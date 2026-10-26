/**
 * Publishing side of a microphone (issue #7): the `mic` slot of a device, either a person's microphone on a phone or a
 * laptop (`voice`) or the feed of a mixing desk on the audio station (`station`). One slot with the state machine of
 * the {@link Publisher} (`starting → live`, `paused`, `ended`, `failed`, `idle`); it survives rejoins of the
 * {@link MediaSession} by republishing into the new room, and it takes the microphone back when the device returns
 * after it was unplugged: an audio interface that loses its cable must not stay silent until someone notices.
 */
import { backoffDelay } from '@studioflow/realtime-client';
import { MIC_SLOT, type SlotTelemetryDto } from '@studioflow/scene-model';
import {
  RoomEvent,
  TrackEvent,
  type AudioCaptureOptions,
  type LocalAudioTrack,
} from 'livekit-client';
import { captureMic } from './capture';
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
  isMicSettings,
  micCaptureOptions,
  micPublishOptions,
  type MicSettings,
} from './publish-options';
import {
  MIC_ENDED_MESSAGE,
  MIC_PROBLEMS,
  describeMicFailure,
  type SlotFailure,
  type SlotMessageKey,
  type SlotProblem,
} from './slot-failure';
import { audioSlotTelemetry } from './slot-telemetry';
import type { LocalSlotState, SlotStateListener } from './publisher';

/** Construction options of {@link AudioPublisher}. */
export interface AudioPublisherOptions {
  /** Microphone capture (default livekit `createLocalAudioTrack`). */
  readonly createMicTrack?: (options: AudioCaptureOptions) => Promise<LocalAudioTrack>;
  /** Wraps the track for the level meter; injectable because test DOMs lack a working `MediaStream`. */
  readonly createStream?: (track: MediaStreamTrack) => MediaStream;
  readonly logger?: MediaLogger;
  readonly clock?: Clock;
  readonly random?: () => number;
  /** Time the SDK gets to restart an ended microphone by itself before the slot is `ended` (default 2 s). */
  readonly restartGraceMs?: number;
  /** How often a lost microphone is looked for, besides a changed device list (default 3 s). */
  readonly retryIntervalMs?: number;
  /** Lists the media devices for the input picker (default `navigator.mediaDevices.enumerateDevices`). */
  readonly listDevices?: () => Promise<readonly MediaDeviceInfo[]>;
  /** Tells when devices are plugged in or removed (default the `devicechange` event of `navigator.mediaDevices`). */
  readonly onDeviceChange?: (listener: () => void) => () => void;
}

/** Capture and publish attempts before the slot is `failed`. */
const MAX_RETRIES = 3;
const DEFAULT_RESTART_GRACE_MS = 2000;
const DEFAULT_RETRY_INTERVAL_MS = 3000;

interface MicRecord {
  state: LocalSlotState;
  messageKey: SlotMessageKey | undefined;
  failure: SlotFailure | undefined;
  track: LocalAudioTrack | null;
  /** What the sender wants (input, profile). */
  settings: MicSettings;
  /** What the current track was captured with. */
  applied: MicSettings | null;
  publishedTo: MediaRoom | null;
  publishFailures: number;
  /** Bumped whenever the track lifecycle is cancelled (unpublish, failure, session end, restart with a new profile). */
  epoch: number;
  /** True while a lost microphone is being looked for. */
  searching: boolean;
  queue: Promise<void>;
  detachTrack: (() => void) | null;
  graceTimer: TimerHandle | null;
  retryTimer: TimerHandle | null;
  stream: { readonly source: MediaStreamTrack; readonly stream: MediaStream } | null;
}

function defaultCreateStream(track: MediaStreamTrack): MediaStream {
  return new MediaStream([track]);
}

function defaultListDevices(): Promise<readonly MediaDeviceInfo[]> {
  return typeof navigator === 'undefined' || navigator.mediaDevices === undefined
    ? Promise.resolve([])
    : navigator.mediaDevices.enumerateDevices();
}

function defaultOnDeviceChange(listener: () => void): () => void {
  if (typeof navigator === 'undefined' || navigator.mediaDevices === undefined) {
    return () => undefined;
  }
  const devices = navigator.mediaDevices;
  devices.addEventListener('devicechange', listener);
  return () => devices.removeEventListener('devicechange', listener);
}

function sameSettings(a: MicSettings | null, b: MicSettings): boolean {
  return a !== null && a.profile === b.profile && a.deviceId === b.deviceId;
}

/** True for states in which the microphone should be (re)published when the session (re)connects. */
function wantsLive(record: MicRecord): boolean {
  return (
    record.state === 'starting' ||
    record.state === 'live' ||
    record.state === 'paused' ||
    record.state === 'ended'
  );
}

/**
 * Publishes the sender's microphone into the room of a {@link SessionStateSource}. Public methods never reject for
 * runtime problems – those become slot states with a message key – only for invalid arguments (`RangeError`).
 */
export class AudioPublisher {
  readonly #session: SessionStateSource;
  readonly #createMic: (options: AudioCaptureOptions) => Promise<LocalAudioTrack>;
  readonly #createStream: (track: MediaStreamTrack) => MediaStream;
  readonly #logger: MediaLogger;
  readonly #clock: Clock;
  readonly #random: () => number;
  readonly #graceMs: number;
  readonly #retryMs: number;
  readonly #listDevices: () => Promise<readonly MediaDeviceInfo[]>;
  readonly #listeners: Listeners<
    [string, LocalSlotState, SlotMessageKey | undefined, SlotFailure | undefined]
  >;
  readonly #delays = new Set<CancellableDelay>();
  readonly #loss = new DeltaRatio();
  readonly #unsubscribe: readonly (() => void)[];
  #record: MicRecord | null = null;
  #roomEvents: RoomListenerGroup | null = null;
  #disposed = false;

  constructor(session: SessionStateSource, options: AudioPublisherOptions = {}) {
    this.#session = session;
    this.#createMic = options.createMicTrack ?? captureMic;
    this.#createStream = options.createStream ?? defaultCreateStream;
    this.#logger = options.logger ?? consoleLogger;
    this.#clock = options.clock ?? systemClock;
    this.#random = options.random ?? Math.random;
    this.#graceMs = options.restartGraceMs ?? DEFAULT_RESTART_GRACE_MS;
    this.#retryMs = options.retryIntervalMs ?? DEFAULT_RETRY_INTERVAL_MS;
    this.#listDevices = options.listDevices ?? defaultListDevices;
    this.#listeners = new Listeners((error) =>
      this.#logger.warn('microphone state listener failed', errorContext(error)),
    );
    this.#bindRoom(session.room);
    this.#unsubscribe = [
      session.onRoom((room) => this.#bindRoom(room)),
      session.onStateChange((state) => this.#onSessionState(state)),
      (options.onDeviceChange ?? defaultOnDeviceChange)(() => this.#onDevicesChanged()),
    ];
  }

  /** Notifies about state changes of the microphone slot; re-notifies (same state) when its track was replaced. */
  onSlotState(listener: SlotStateListener): () => void {
    return this.#listeners.add((slot, state, messageKey, failure) => {
      if (messageKey === undefined) {
        listener(slot, state);
      } else if (failure === undefined) {
        listener(slot, state, messageKey);
      } else {
        listener(slot, state, messageKey, failure);
      }
    });
  }

  /** Current state of the microphone slot (`idle` if it was never started). */
  slotState(): LocalSlotState {
    return this.#record?.state ?? 'idle';
  }

  /** What the microphone is asked to do, null while off. */
  settings(): MicSettings | null {
    return this.#record === null ? null : { ...this.#record.settings };
  }

  /**
   * Starts the microphone, or applies new settings to a running one: another input is switched in place (no republish,
   * no gap in the room), another profile starts the capture over. Publishes as soon as the session is connected.
   */
  publishMic(settings: MicSettings): Promise<void> {
    if (!isMicSettings(settings)) {
      return Promise.reject(new RangeError('invalid microphone settings'));
    }
    if (this.#disposed) {
      return Promise.resolve();
    }
    const existing = this.#record;
    if (existing !== null && wantsLive(existing)) {
      const profileChanged = existing.settings.profile !== settings.profile;
      existing.settings = { ...settings };
      if (profileChanged) {
        existing.epoch += 1;
        const epoch = existing.epoch;
        this.#setState(existing, 'starting');
        return this.#enqueue(existing, async () => {
          await this.#releaseTrack(existing);
          await this.#start(existing, epoch);
        });
      }
      return this.#enqueue(existing, () => this.#applySettings(existing));
    }
    const record = existing ?? this.#createRecord(settings);
    record.settings = { ...settings };
    record.epoch += 1;
    const epoch = record.epoch;
    this.#setState(record, 'starting');
    return this.#enqueue(record, () => this.#start(record, epoch));
  }

  /** Stops and unpublishes the microphone; its state becomes `idle`. */
  async unpublish(): Promise<void> {
    const record = this.#record;
    if (record === null) {
      return;
    }
    this.#record = null;
    record.epoch += 1;
    this.#clearTimers(record);
    await this.#releaseTrack(record);
    this.#setState(record, 'idle');
  }

  /** The audio inputs of this device, for the picker (labels appear once the microphone was allowed). */
  async listInputs(): Promise<readonly { readonly id: string; readonly label: string }[]> {
    try {
      const devices = await this.#listDevices();
      return devices
        .filter((device) => device.kind === 'audioinput' && device.deviceId !== '')
        .map((device) => ({ id: device.deviceId, label: device.label }));
    } catch (error) {
      this.#logger.warn('audio inputs could not be listed', errorContext(error));
      return [];
    }
  }

  /** Stream of the running microphone for the level meter (same object while the track is), else null. */
  localStream(): MediaStream | null {
    const record = this.#record;
    const source = record?.track?.mediaStreamTrack;
    if (record === null || source === undefined || source.readyState !== 'live') {
      return null;
    }
    if (record.stream?.source !== source) {
      record.stream = { source, stream: this.#createStream(source) };
    }
    return record.stream.stream;
  }

  /** Telemetry of the microphone slot for the device report, null while it is off. */
  async getSlotTelemetry(): Promise<SlotTelemetryDto | null> {
    const record = this.#record;
    if (record === null || record.state === 'idle') {
      return null;
    }
    return audioSlotTelemetry(
      {
        slot: MIC_SLOT,
        state: record.state,
        track: record.track,
        published: this.#isPublishedNow(record),
      },
      this.#loss,
      this.#logger,
    );
  }

  /** Releases the device and every listener without emitting further states. */
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
    this.#listeners.clear();
    const record = this.#record;
    this.#record = null;
    if (record !== null) {
      record.epoch += 1;
      this.#clearTimers(record);
      void this.#releaseTrack(record);
    }
  }

  #createRecord(settings: MicSettings): MicRecord {
    const record: MicRecord = {
      state: 'idle',
      messageKey: undefined,
      failure: undefined,
      track: null,
      settings: { ...settings },
      applied: null,
      publishedTo: null,
      publishFailures: 0,
      epoch: 0,
      searching: false,
      queue: Promise.resolve(),
      detachTrack: null,
      graceTimer: null,
      retryTimer: null,
      stream: null,
    };
    this.#record = record;
    return record;
  }

  #isStale(record: MicRecord, epoch: number): boolean {
    return this.#disposed || record.epoch !== epoch || this.#record !== record;
  }

  /** True while the track is published in the session's current room. */
  #isPublishedNow(record: MicRecord): boolean {
    return record.publishedTo !== null && record.publishedTo === this.#session.room;
  }

  #enqueue(record: MicRecord, operation: () => Promise<void>): Promise<void> {
    const next = record.queue
      .then(operation)
      .catch((error: unknown) =>
        this.#logger.warn('microphone operation failed', errorContext(error)),
      );
    record.queue = next;
    return next;
  }

  async #start(record: MicRecord, epoch: number): Promise<void> {
    const acquired = await this.#acquire(record, epoch);
    if (acquired === null) {
      return;
    }
    this.#adoptTrack(record, acquired.track);
    record.applied = acquired.settings;
    await this.#publish(record);
  }

  /** getUserMedia with up to three retries for transient errors; null (slot failed or stale) on failure. */
  async #acquire(
    record: MicRecord,
    epoch: number,
  ): Promise<{ readonly track: LocalAudioTrack; readonly settings: MicSettings } | null> {
    for (let attempt = 0; ; attempt++) {
      const settings = { ...record.settings };
      if (this.#isStale(record, epoch)) {
        return null;
      }
      try {
        const track = await this.#createMic(micCaptureOptions(settings));
        if (this.#isStale(record, epoch)) {
          track.stop();
          return null;
        }
        return { track, settings };
      } catch (error) {
        if (this.#isStale(record, epoch)) {
          return null;
        }
        const failure = describeMicFailure(error);
        this.#logger.warn('microphone acquisition failed', { attempt, ...errorContext(error) });
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

  /** Switches the running microphone to the chosen input in place. */
  async #applySettings(record: MicRecord): Promise<void> {
    const { track, epoch } = record;
    const target = { ...record.settings };
    if (track === null || sameSettings(record.applied, target)) {
      return;
    }
    try {
      await track.restartTrack(micCaptureOptions(target));
    } catch (error) {
      if (this.#isStale(record, epoch) || record.track !== track) {
        return;
      }
      this.#logger.warn('microphone restart with new settings failed', errorContext(error));
      record.settings = record.applied ?? target;
      if (track.mediaStreamTrack.readyState !== 'live') {
        this.#lost(record);
      } else {
        this.#fail(record, describeMicFailure(error));
      }
      return;
    }
    if (this.#isStale(record, epoch) || record.track !== track) {
      return;
    }
    record.applied = target;
    this.#notify(record);
  }

  /** Publishes the track into the session's room if connected and not yet published there. */
  async #publish(record: MicRecord): Promise<void> {
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
      await room.localParticipant.publishTrack(
        track,
        micPublishOptions(MIC_SLOT, (record.applied ?? record.settings).profile),
      );
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
    if (!record.searching && record.state !== 'paused') {
      this.#setState(record, 'live');
    }
  }

  /** Retries a failed publish while the room is still connected; a lost room is handled by the next `connected`. */
  async #onPublishFailed(
    record: MicRecord,
    epoch: number,
    track: LocalAudioTrack,
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
    this.#logger.warn('microphone publish failed', {
      attempt: record.publishFailures,
      ...errorContext(error),
    });
    if (record.publishFailures > MAX_RETRIES) {
      this.#fail(record, MIC_PROBLEMS.publishFailed);
      return;
    }
    if (
      (await this.#sleep(backoffDelay(record.publishFailures, this.#random))) &&
      !this.#isStale(record, epoch)
    ) {
      await this.#publish(record);
    }
  }

  /** After a rejoin: republish a live microphone; take a lost one back. */
  async #republish(record: MicRecord): Promise<void> {
    if (this.#isStale(record, record.epoch) || !wantsLive(record)) {
      return;
    }
    const alive = record.track !== null && record.track.mediaStreamTrack.readyState === 'live';
    if (!alive) {
      if (record.track === null) {
        // Released while the session was gone: capture again.
        record.epoch += 1;
        this.#setState(record, 'starting');
        await this.#start(record, record.epoch);
      } else {
        this.#lost(record);
      }
      return;
    }
    await this.#publish(record);
  }

  #adoptTrack(record: MicRecord, track: LocalAudioTrack): void {
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
          this.#logger.warn('microphone event handler failed', errorContext(error));
        }
      };
    const handlers = [
      [TrackEvent.Ended, guarded(() => this.#onEnded(record, track))],
      [TrackEvent.Muted, guarded(() => this.#onSdkMuted(record, track))],
      [TrackEvent.Restarted, guarded(() => this.#onRestarted(record, track))],
      [TrackEvent.UpstreamPaused, guarded(() => this.#onUpstream(record, track, true))],
      [TrackEvent.UpstreamResumed, guarded(() => this.#onUpstream(record, track, false))],
    ] as const;
    for (const [event, handler] of handlers) {
      track.on(event, handler);
    }
    record.detachTrack = () => {
      for (const [event, handler] of handlers) {
        track.off(event, handler);
      }
    };
    this.#notify(record);
  }

  /** The device stopped delivering (unplugged, taken by another app). The SDK may restart it itself; we give it a moment. */
  #onEnded(record: MicRecord, track: LocalAudioTrack): void {
    if (record.track !== track || record.searching || record.graceTimer !== null) {
      return;
    }
    record.graceTimer = this.#clock.setTimeout(() => {
      record.graceTimer = null;
      if (record.track === track && track.mediaStreamTrack.readyState !== 'live') {
        this.#lost(record);
      }
    }, this.#graceMs);
  }

  /** The SDK mutes a track whose automatic restart failed (the publisher never mutes itself). */
  #onSdkMuted(record: MicRecord, track: LocalAudioTrack): void {
    if (record.track === track && track.isMuted) {
      this.#lost(record);
    }
  }

  #onRestarted(record: MicRecord, track: LocalAudioTrack): void {
    if (record.track !== track) {
      return;
    }
    this.#clearGrace(record);
    if (record.searching && track.mediaStreamTrack.readyState === 'live') {
      this.#recovered(record);
    }
    this.#notify(record);
  }

  /** Phone in background or microphone interrupted by the OS: the SDK pauses the upstream until sound returns. */
  #onUpstream(record: MicRecord, track: LocalAudioTrack, paused: boolean): void {
    if (record.track !== track) {
      return;
    }
    if (paused && record.state === 'live') {
      this.#setState(record, 'paused');
    } else if (!paused && record.state === 'paused') {
      this.#setState(record, this.#isPublishedNow(record) ? 'live' : 'starting');
    }
  }

  /**
   * The microphone is gone: the slot is `ended` (the Regie raises the incident when the channel is audible) and the
   * device is looked for until it returns – on every change of the device list and every few seconds.
   */
  #lost(record: MicRecord): void {
    if (record.searching || this.#record !== record) {
      return;
    }
    record.searching = true;
    this.#clearGrace(record);
    this.#setState(record, 'ended', MIC_ENDED_MESSAGE);
    this.#scheduleSearch(record);
  }

  #scheduleSearch(record: MicRecord): void {
    if (!record.searching || record.retryTimer !== null) {
      return;
    }
    record.retryTimer = this.#clock.setTimeout(() => {
      record.retryTimer = null;
      void this.#search(record);
    }, this.#retryMs);
  }

  #onDevicesChanged(): void {
    const record = this.#record;
    if (record === null || !record.searching) {
      return;
    }
    if (record.retryTimer !== null) {
      this.#clock.clearTimeout(record.retryTimer);
      record.retryTimer = null;
    }
    void this.#search(record);
  }

  /** One attempt to take the lost microphone back; the next one is scheduled unless it worked. */
  #search(record: MicRecord): Promise<void> {
    const epoch = record.epoch;
    return this.#enqueue(record, async () => {
      const track = record.track;
      if (this.#isStale(record, epoch) || !record.searching || track === null) {
        return;
      }
      const settings = record.applied ?? record.settings;
      try {
        if (track.isMuted) {
          await track.unmute();
        } else {
          await track.restartTrack(micCaptureOptions(settings));
        }
      } catch (error) {
        this.#logger.debug('microphone not back yet', errorContext(error));
      }
      if (this.#isStale(record, epoch) || record.track !== track || !record.searching) {
        return;
      }
      if (track.mediaStreamTrack.readyState === 'live') {
        this.#recovered(record);
        await this.#publish(record);
      } else {
        this.#scheduleSearch(record);
      }
    });
  }

  #recovered(record: MicRecord): void {
    record.searching = false;
    record.publishFailures = 0;
    this.#clearTimers(record);
    this.#setState(record, this.#isPublishedNow(record) ? 'live' : 'starting');
  }

  #fail(record: MicRecord, problem: SlotProblem): void {
    record.epoch += 1;
    this.#clearTimers(record);
    record.searching = false;
    this.#setState(record, 'failed', problem);
    void this.#releaseTrack(record);
  }

  /** Stops the track (releasing the device at once) and unpublishes it from the room it was published in. */
  async #releaseTrack(record: MicRecord): Promise<void> {
    const { track, publishedTo } = record;
    record.detachTrack?.();
    record.detachTrack = null;
    record.track = null;
    record.applied = null;
    record.publishedTo = null;
    record.stream = null;
    if (track === null) {
      return;
    }
    const unpublishing =
      publishedTo === null ? Promise.resolve() : this.#unpublishFrom(publishedTo, track);
    try {
      track.stop();
    } catch (error) {
      this.#logger.warn('microphone stop failed', errorContext(error));
    }
    await unpublishing;
  }

  async #unpublishFrom(room: MediaRoom, track: LocalAudioTrack): Promise<void> {
    try {
      await room.localParticipant.unpublishTrack(track, false);
    } catch (error) {
      this.#logger.warn('microphone unpublish failed', errorContext(error));
    }
  }

  #onSessionState(state: MediaSessionState): void {
    const record = this.#record;
    if (record === null) {
      return;
    }
    if (state === 'connected') {
      if (!this.#isPublishedNow(record) && wantsLive(record)) {
        void this.#enqueue(record, () => this.#republish(record));
      }
    } else if (isTerminalState(state) && wantsLive(record)) {
      // Replaced, removed or stopped: free the device (another tab may need it). The microphone stays wanted and is
      // captured again when the session connects.
      record.epoch += 1;
      record.searching = false;
      this.#clearTimers(record);
      void this.#releaseTrack(record);
      this.#setState(record, 'paused');
    }
  }

  #bindRoom(room: MediaRoom | null): void {
    this.#roomEvents?.dispose();
    this.#roomEvents = null;
    if (room === null || this.#disposed) {
      return;
    }
    this.#roomEvents = listenTo(room, (error) =>
      this.#logger.warn('microphone room handler failed', errorContext(error)),
    ).on(RoomEvent.MediaDevicesError, (error, kind) => {
      const record = this.#record;
      if (
        (kind === undefined || kind === 'audioinput') &&
        record !== null &&
        record.track !== null &&
        wantsLive(record)
      ) {
        this.#logger.warn('media devices error', errorContext(error));
        this.#lost(record);
      }
    });
  }

  #notify(record: MicRecord): void {
    this.#listeners.emit(MIC_SLOT, record.state, record.messageKey, record.failure);
  }

  /** Sets the state with an optional message key or a problem (message key plus failure code). */
  #setState(record: MicRecord, state: LocalSlotState, detail?: SlotMessageKey | SlotProblem): void {
    const messageKey = typeof detail === 'string' ? detail : detail?.messageKey;
    const failure = typeof detail === 'object' ? detail.failure : undefined;
    if (record.state === state && record.messageKey === messageKey && record.failure === failure) {
      return;
    }
    record.state = state;
    record.messageKey = messageKey;
    record.failure = failure;
    this.#listeners.emit(MIC_SLOT, state, messageKey, failure);
  }

  #clearGrace(record: MicRecord): void {
    if (record.graceTimer !== null) {
      this.#clock.clearTimeout(record.graceTimer);
      record.graceTimer = null;
    }
  }

  #clearTimers(record: MicRecord): void {
    this.#clearGrace(record);
    if (record.retryTimer !== null) {
      this.#clock.clearTimeout(record.retryTimer);
      record.retryTimer = null;
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
