/**
 * Supplies device pictures from LiveKit to the scene renderer (spec 7 and 8.4): maps `{identity}/{trackName}` to remote
 * video tracks, keeps video elements on their last frame across track loss, chooses the simulcast layer from the
 * renderers' desired sizes, pauses what nobody needs and sets the playout delay per role.
 */
import { deviceSourceRef, slotKind } from '@studioflow/scene-model';
import type {
  DesiredSize,
  SourceAvailability,
  SourceMediaProvider,
} from '@studioflow/scene-renderer';
import { RoomEvent } from 'livekit-client';
import { systemClock, type Clock, type TimerHandle } from './clock';
import { DecoderCapability, kindFromStats, type DecoderKind } from './decoder-info';
import { DesiredSizes } from './desired-size';
import { Listeners } from './listeners';
import type {
  MediaPublicationRef,
  MediaRemotePublication,
  MediaRemoteTrack,
  MediaRoom,
  RoomListenerGroup,
} from './livekit-port';
import { listenTo } from './livekit-port';
import { consoleLogger, errorContext, type MediaLogger } from './logger';
import type { RoomSource } from './media-session';
import { ReceiverStatsReader, type ReceiverSnapshot } from './media-stats';

/** Hardware or software decoding of the stream: the stats where the browser tells this page, else its capabilities. */
export type StreamDecoder = DecoderKind;

/** Receive statistics of one source (output debug overlay, Regie monitoring). */
export interface SourceStats extends ReceiverSnapshot {
  /** Receive bitrate over the last ~2 s (all layers the SFU forwards; one at a time). */
  readonly bitrateKbps?: number;
  /** Whether this stream is decoded in hardware or software; absent when the browser cannot tell. */
  readonly decoder?: StreamDecoder;
}

/** What the decoders of all received streams did since the previous {@link LiveKitSourceProvider.decoderSummary} call. */
export interface DecoderSummary {
  /** Streams that decoded frames (a paused stream decodes none). */
  readonly decoding: number;
  /** Of those, the streams decoded in software. */
  readonly software: number;
  /** Frames the receivers dropped and received (the decoder cannot keep up when the share is high). */
  readonly framesDropped: number;
  readonly framesReceived: number;
}

/** Construction options of {@link LiveKitSourceProvider}. */
export interface LiveKitSourceProviderOptions {
  /** Resolves asset ids to URLs (the output page appends its key). */
  readonly assetUrl: (assetId: string) => string | null;
  readonly logger?: MediaLogger;
  readonly clock?: Clock;
  /** Wraps a track for `srcObject`; injectable because test DOMs lack a working `MediaStream`. */
  readonly createStream?: (track: MediaStreamTrack) => MediaStream;
  /**
   * A source that nobody asks a picture for any more is paused (`setEnabled(false)`: the SFU stops forwarding it and the
   * browser stops decoding it) after this time. Default 10 s in the Regie and 5 s on the output; it is resumed at once
   * when somebody needs it again. A source nobody asked for when its track arrives is paused after 1.5 s.
   */
  readonly disableUnusedAfterMs?: number;
  /** Answers `MediaCapabilities` questions about decoders (injectable in tests). */
  readonly decoderCapability?: DecoderCapability;
}

type SubscriberRole = 'studio' | 'output';

/** Playout targets: the Regie wants the lowest possible delay, the output a small cushion against jitter. */
const PLAYOUT: Readonly<
  Record<SubscriberRole, { readonly delaySeconds: number; readonly jitterBufferTargetMs: number }>
> = {
  studio: { delaySeconds: 0, jitterBufferTargetMs: 0 },
  output: { delaySeconds: 0.05, jitterBufferTargetMs: 50 },
};

const PENDING: SourceAvailability = { state: 'pending' };
const LIVE: SourceAvailability = { state: 'live' };
/**
 * A track that nobody asks a picture for when it arrives is paused after this time, not at once: a page that is loading
 * registers its consumers a moment after the tracks arrive, and pausing and resuming would cost it a round trip to the SFU
 * and a wait for a keyframe before the first picture. The short time only runs once a consumer has asked for a picture of
 * any source (the page has rendered); before that the page is still loading, which on a busy computer takes seconds, and the
 * normal grace time holds.
 */
const FRESH_TRACK_GRACE_MS = 1_500;
const DEFAULT_DISABLE_UNUSED_AFTER_MS: Readonly<Record<SubscriberRole, number>> = {
  studio: 10_000,
  output: 5_000,
};

interface Subscription {
  readonly track: MediaRemoteTrack;
  publication: MediaRemotePublication;
  readonly stream: MediaStream;
}

interface SourceEntry {
  readonly elements: Set<HTMLVideoElement>;
  readonly sizes: DesiredSizes;
  subscription: Subscription | null;
  availability: SourceAvailability;
  disableTimer: TimerHandle | null;
  /** The track is paused by us (nobody needs a picture): no frames arrive, the elements show nothing. */
  paused: boolean;
  /** The track arrived before any consumer asked for a picture; its pause timer waits for the page to render (see {@link FRESH_TRACK_GRACE_MS}). */
  waitingForFirstConsumer: boolean;
}

/** Counters of one inbound stream at the previous summary. */
interface DecoderMark {
  readonly framesDecoded: number;
  readonly framesDropped: number;
  readonly framesReceived: number;
}

/** Source id of a remote publication, or null for track names that are not StudioFlow slots (e.g. audio, future). */
function sourceIdOf(identity: string, trackName: string): string | null {
  return slotKind(trackName) === null ? null : deviceSourceRef(identity, trackName);
}

function defaultCreateStream(track: MediaStreamTrack): MediaStream {
  return new MediaStream([track]);
}

/** Configures an element for silent inline autoplay (the renderer creates them that way too; this is defensive). */
function prepareVideo(video: HTMLVideoElement): void {
  video.muted = true;
  video.playsInline = true;
  video.autoplay = true;
}

/** Points the element at the stream and starts playback; autoplay refusals are ignored (the attribute retries). */
function showStream(video: HTMLVideoElement, stream: MediaStream): void {
  if (video.srcObject !== stream) {
    video.srcObject = stream;
  }
  try {
    const playing: Promise<void> | undefined = video.play();
    playing?.catch(() => undefined);
  } catch {
    // Older engines throw synchronously without a source; the autoplay attribute starts playback later.
  }
}

/**
 * {@link SourceMediaProvider} backed by a {@link RoomSource} (normally a `MediaSession` with role studio or output).
 * Rebinds automatically whenever the session switches to a new room; the old room's tracks become “lost”.
 */
export class LiveKitSourceProvider implements SourceMediaProvider {
  readonly #role: SubscriberRole;
  readonly #assetUrl: (assetId: string) => string | null;
  readonly #logger: MediaLogger;
  readonly #clock: Clock;
  readonly #createStream: (track: MediaStreamTrack) => MediaStream;
  readonly #disableUnusedAfterMs: number;
  /** Some consumer has asked for a picture of some source: the page has rendered. */
  #consumersSeen = false;
  readonly #decoders: DecoderCapability;
  readonly #decoderMarks = new WeakMap<MediaRemoteTrack, DecoderMark>();
  readonly #entries = new Map<string, SourceEntry>();
  readonly #changes: Listeners<[string]>;
  readonly #stats = new ReceiverStatsReader();
  readonly #stopRoomWatch: () => void;
  #events: RoomListenerGroup | null = null;
  #boundRoom: MediaRoom | null = null;
  #disposed = false;

  constructor(session: RoomSource, options: LiveKitSourceProviderOptions) {
    this.#role = session.role === 'studio' ? 'studio' : 'output';
    this.#assetUrl = options.assetUrl;
    this.#logger = options.logger ?? consoleLogger;
    this.#clock = options.clock ?? systemClock;
    this.#createStream = options.createStream ?? defaultCreateStream;
    this.#disableUnusedAfterMs =
      options.disableUnusedAfterMs ?? DEFAULT_DISABLE_UNUSED_AFTER_MS[this.#role];
    this.#decoders = options.decoderCapability ?? new DecoderCapability();
    this.#changes = new Listeners((error) =>
      this.#logger.warn('source change listener failed', errorContext(error)),
    );
    this.#bind(session.room);
    this.#stopRoomWatch = session.onRoom((room) => this.#bind(room));
  }

  /** {@inheritDoc SourceMediaProvider.attach} */
  attach(sourceId: string, video: HTMLVideoElement): void {
    if (this.#disposed) {
      return;
    }
    const entry = this.#entry(sourceId);
    entry.elements.add(video);
    prepareVideo(video);
    // A paused source shows nothing until somebody needs it again (then it is resumed and every element gets the stream).
    const stream = entry.subscription?.stream;
    if (stream !== undefined && !entry.paused) {
      this.#show(video, stream);
    }
  }

  /** {@inheritDoc SourceMediaProvider.detach} The element keeps whatever it shows; the renderer owns it. */
  detach(sourceId: string, video: HTMLVideoElement): void {
    const entry = this.#entries.get(sourceId);
    if (entry !== undefined) {
      entry.elements.delete(video);
      this.#prune(sourceId, entry);
    }
  }

  /** {@inheritDoc SourceMediaProvider.availability} */
  availability(sourceId: string): SourceAvailability {
    return this.#entries.get(sourceId)?.availability ?? PENDING;
  }

  /** {@inheritDoc SourceMediaProvider.onChange} */
  onChange(listener: (sourceId: string) => void): () => void {
    return this.#changes.add(listener);
  }

  /**
   * {@inheritDoc SourceMediaProvider.setDesiredSize}
   * The matching layer via `setVideoDimensions`. No consumer for longer than `disableUnusedAfterMs` → the source is
   * paused (no frames are forwarded, none decoded); the next request resumes it at once and the picture is back with the
   * next keyframe. The output keeps the program and the preview scene asked for, so a Take shows its picture immediately
   * and every other scene needs that keyframe (about half a second).
   */
  setDesiredSize(sourceId: string, consumerId: string, size: DesiredSize | null): void {
    if (this.#disposed) {
      return;
    }
    const entry = this.#entry(sourceId);
    entry.sizes.set(consumerId, size);
    if (size !== null && !this.#consumersSeen) {
      this.#consumersSeen = true;
      this.#startFreshTimers();
    }
    this.#applyQuality(entry);
    this.#prune(sourceId, entry);
  }

  /** {@inheritDoc SourceMediaProvider.assetUrl} */
  assetUrl(assetId: string): string | null {
    try {
      return this.#assetUrl(assetId);
    } catch (error) {
      this.#logger.warn('asset URL resolver failed', errorContext(error));
      return null;
    }
  }

  /** Receive statistics of a source with a subscribed track, else null. */
  async getStats(sourceId: string): Promise<SourceStats | null> {
    const track = this.#entries.get(sourceId)?.subscription?.track;
    if (track === undefined) {
      return null;
    }
    const snapshot = await this.#readReceiver(track);
    const decoder = await this.#decoderOf(snapshot);
    return {
      ...snapshot,
      bitrateKbps: Math.round(track.currentBitrate / 1000),
      ...(decoder === null ? {} : { decoder }),
    };
  }

  /**
   * What the decoders did since the previous call: how many streams decode, how many of them in software, and the
   * frames dropped against the frames received (the output reports this; a share above a few percent means the machine
   * cannot keep up). Paused streams decode nothing and do not count. The first call counts since the stream started.
   */
  async decoderSummary(): Promise<DecoderSummary> {
    const tracks = [...this.#entries.values()]
      .filter((entry) => !entry.paused)
      .map((entry) => entry.subscription?.track)
      .filter((track): track is MediaRemoteTrack => track !== undefined);
    const reads = await Promise.all(
      tracks.map(async (track) => ({ track, snapshot: await this.#readReceiver(track) })),
    );
    let decoding = 0;
    let software = 0;
    let framesDropped = 0;
    let framesReceived = 0;
    for (const { track, snapshot } of reads) {
      const mark: DecoderMark = {
        framesDecoded: snapshot.framesDecoded ?? 0,
        framesDropped: snapshot.framesDropped ?? 0,
        framesReceived: snapshot.framesReceived ?? 0,
      };
      const before = this.#decoderMarks.get(track);
      this.#decoderMarks.set(track, mark);
      const decoded = mark.framesDecoded - (before?.framesDecoded ?? 0);
      if (decoded <= 0) {
        continue;
      }
      decoding += 1;
      framesDropped += Math.max(0, mark.framesDropped - (before?.framesDropped ?? 0));
      framesReceived += Math.max(0, mark.framesReceived - (before?.framesReceived ?? 0));
      if ((await this.#decoderOf(snapshot)) === 'software') {
        software += 1;
      }
    }
    return { decoding, software, framesDropped, framesReceived };
  }

  /**
   * Estimated glass-to-glass share caused by the network and the receive buffer, averaged over all live sources:
   * per track RTT/2 of the selected ICE candidate pair (one-way delay, assuming a symmetric path) plus the average
   * jitter-buffer delay of the last interval (`jitterBufferDelay / jitterBufferEmittedCount`). Capture, encode, decode
   * and render time (typically another 30–80 ms) are not included. Null when no live source reports either value.
   */
  async estimateLatencyMs(): Promise<number | null> {
    const tracks = [...this.#entries.values()]
      .filter((entry) => entry.availability.state === 'live' && !entry.paused)
      .map((entry) => entry.subscription?.track)
      .filter((track): track is MediaRemoteTrack => track !== undefined);
    const estimates = (await Promise.all(tracks.map((track) => this.#readReceiver(track))))
      .map((snapshot) =>
        snapshot.rttMs === undefined && snapshot.jitterBufferDelayMs === undefined
          ? undefined
          : (snapshot.rttMs ?? 0) / 2 + (snapshot.jitterBufferDelayMs ?? 0),
      )
      .filter((estimate): estimate is number => estimate !== undefined);
    return estimates.length === 0
      ? null
      : Math.round(estimates.reduce((sum, value) => sum + value, 0) / estimates.length);
  }

  /** Detaches from the session and the room and forgets every element and listener. */
  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#stopRoomWatch();
    this.#events?.dispose();
    this.#events = null;
    for (const entry of this.#entries.values()) {
      this.#clearDisableTimer(entry);
    }
    this.#entries.clear();
    this.#changes.clear();
  }

  #bind(room: MediaRoom | null): void {
    if (room !== null && room === this.#boundRoom) {
      return;
    }
    this.#boundRoom = room;
    this.#events?.dispose();
    this.#events = null;
    for (const [sourceId, entry] of this.#entries) {
      this.#dropSubscription(sourceId, entry);
    }
    if (room === null || this.#disposed) {
      return;
    }
    this.#events = listenTo(room, (error) =>
      this.#logger.warn('source provider room handler failed', errorContext(error)),
    )
      .on(RoomEvent.TrackSubscribed, (track, publication, participant) =>
        this.#onSubscribed(track, publication, participant.identity),
      )
      .on(RoomEvent.TrackUnsubscribed, (track, publication, participant) =>
        this.#onTrackGone(
          participant.identity,
          publication.trackName,
          (subscription) => subscription.track === track,
        ),
      )
      .on(RoomEvent.TrackUnpublished, (publication, participant) =>
        this.#onTrackGone(
          participant.identity,
          publication.trackName,
          (subscription) => subscription.publication === publication,
        ),
      )
      .on(RoomEvent.TrackMuted, (publication, participant) =>
        this.#onMuteChange(publication, participant.identity, true),
      )
      .on(RoomEvent.TrackUnmuted, (publication, participant) =>
        this.#onMuteChange(publication, participant.identity, false),
      )
      .on(RoomEvent.ParticipantDisconnected, (participant) =>
        this.#onParticipantGone(participant.identity),
      );
    // Tracks that were subscribed before this provider was bound (provider created after the session connected).
    for (const participant of room.remoteParticipants.values()) {
      for (const publication of participant.trackPublications.values()) {
        if (publication.isSubscribed && publication.track !== undefined) {
          this.#onSubscribed(publication.track, publication, participant.identity);
        }
      }
    }
  }

  #onSubscribed(
    track: MediaRemoteTrack,
    publication: MediaRemotePublication,
    identity: string,
  ): void {
    const sourceId = sourceIdOf(identity, publication.trackName);
    if (sourceId === null || track.kind !== 'video') {
      return;
    }
    const entry = this.#entry(sourceId);
    let changed = false;
    let fresh = false;
    if (entry.subscription?.track === track) {
      entry.subscription.publication = publication;
    } else {
      this.#clearDisableTimer(entry);
      const stream = this.#createStream(track.mediaStreamTrack);
      entry.subscription = { track, publication, stream };
      // A new subscription is enabled; whether it stays so depends on the consumers.
      entry.paused = false;
      for (const video of entry.elements) {
        this.#show(video, stream);
      }
      changed = true;
      fresh = true;
    }
    this.#applyPlayout(track);
    this.#applyQuality(entry, fresh);
    changed = (publication.isMuted ? this.#markLost(entry) : this.#markLive(entry)) || changed;
    if (changed) {
      this.#changes.emit(sourceId);
    }
  }

  #onTrackGone(
    identity: string,
    trackName: string,
    matches: (subscription: Subscription) => boolean,
  ): void {
    const sourceId = sourceIdOf(identity, trackName);
    const entry = sourceId === null ? undefined : this.#entries.get(sourceId);
    if (sourceId !== null && entry?.subscription && matches(entry.subscription)) {
      this.#dropSubscription(sourceId, entry);
    }
  }

  #onMuteChange(publication: MediaPublicationRef, identity: string, muted: boolean): void {
    const sourceId = sourceIdOf(identity, publication.trackName);
    const entry = sourceId === null ? undefined : this.#entries.get(sourceId);
    if (sourceId === null || entry?.subscription?.publication !== publication) {
      return;
    }
    if (muted ? this.#markLost(entry) : this.#markLive(entry)) {
      this.#changes.emit(sourceId);
    }
  }

  #onParticipantGone(identity: string): void {
    const prefix = `${identity}/`;
    for (const [sourceId, entry] of this.#entries) {
      if (sourceId.startsWith(prefix)) {
        this.#dropSubscription(sourceId, entry);
      }
    }
  }

  /** Forgets the track but leaves `srcObject` untouched, so the element keeps its last frame (hold frame). */
  #dropSubscription(sourceId: string, entry: SourceEntry): void {
    if (entry.subscription === null) {
      return;
    }
    entry.subscription = null;
    entry.paused = false;
    this.#clearDisableTimer(entry);
    if (this.#markLost(entry)) {
      this.#changes.emit(sourceId);
    }
  }

  #markLive(entry: SourceEntry): boolean {
    if (entry.availability.state === 'live') {
      return false;
    }
    entry.availability = LIVE;
    return true;
  }

  /** Live → lost with the current time; an already lost source keeps its original `since`, pending stays pending. */
  #markLost(entry: SourceEntry): boolean {
    if (entry.availability.state !== 'live') {
      return false;
    }
    entry.availability = { state: 'lost', since: this.#clock.now() };
    return true;
  }

  /** One misbehaving element must not keep the others (or the availability update) from happening. */
  #show(video: HTMLVideoElement, stream: MediaStream): void {
    this.#guard('show stream', () => showStream(video, stream));
  }

  #applyPlayout(track: MediaRemoteTrack): void {
    const playout = PLAYOUT[this.#role];
    this.#guard('setPlayoutDelay', () => track.setPlayoutDelay?.(playout.delaySeconds));
    const receiver = track.receiver;
    if (receiver !== undefined && 'jitterBufferTarget' in receiver) {
      this.#guard('jitterBufferTarget', () => {
        receiver.jitterBufferTarget = playout.jitterBufferTargetMs;
      });
    }
  }

  /**
   * Applies the aggregated desired size to the current publication (re-run after every new subscription): the matching
   * layer, or a pause when nobody needs the source. `fresh` is a subscription that just arrived: if nobody asked for it, it
   * is paused after the short {@link FRESH_TRACK_GRACE_MS} instead of the grace time.
   */
  #applyQuality(entry: SourceEntry, fresh = false): void {
    const publication = entry.subscription?.publication;
    if (publication === undefined) {
      return;
    }
    const size = entry.sizes.effective();
    if (size !== null) {
      this.#clearDisableTimer(entry);
      this.#guard('video dimensions', () => {
        publication.setEnabled(true);
        publication.setVideoDimensions(size);
      });
      this.#resume(entry);
    } else if (entry.disableTimer === null && !entry.paused) {
      entry.waitingForFirstConsumer = fresh && !this.#consumersSeen;
      this.#scheduleDisable(
        entry,
        fresh && this.#consumersSeen
          ? Math.min(FRESH_TRACK_GRACE_MS, this.#disableUnusedAfterMs)
          : this.#disableUnusedAfterMs,
      );
    }
  }

  #scheduleDisable(entry: SourceEntry, graceMs: number): void {
    entry.disableTimer = this.#clock.setTimeout(() => {
      entry.disableTimer = null;
      entry.waitingForFirstConsumer = false;
      if (entry.sizes.isEmpty) {
        this.#pause(entry);
      }
    }, graceMs);
  }

  /**
   * The first picture was asked for, so the page has rendered: the tracks that arrived before and that nobody asked for
   * are paused after the short grace time from now.
   */
  #startFreshTimers(): void {
    for (const entry of this.#entries.values()) {
      if (entry.waitingForFirstConsumer && entry.sizes.isEmpty && !entry.paused) {
        this.#clearDisableTimer(entry);
        this.#scheduleDisable(entry, Math.min(FRESH_TRACK_GRACE_MS, this.#disableUnusedAfterMs));
      }
    }
  }

  /**
   * Stops the SFU forwarding the track and empties the elements: a frame from before the pause must never be shown when
   * the source is needed again (the speaker may have moved on), so the element is blank until the first new frame.
   */
  #pause(entry: SourceEntry): void {
    const publication = entry.subscription?.publication;
    if (publication === undefined || entry.paused) {
      return;
    }
    entry.paused = true;
    this.#guard('disable unused source', () => publication.setEnabled(false));
    for (const video of entry.elements) {
      this.#guard('clear paused element', () => {
        video.srcObject = null;
      });
    }
  }

  /** Gives the elements their stream again after a pause. */
  #resume(entry: SourceEntry): void {
    const stream = entry.subscription?.stream;
    if (!entry.paused || stream === undefined) {
      return;
    }
    entry.paused = false;
    for (const video of entry.elements) {
      this.#show(video, stream);
    }
  }

  /** Hardware or software decoding of a stream: from the stats if the browser tells, else from its capabilities. */
  async #decoderOf(snapshot: ReceiverSnapshot): Promise<DecoderKind | null> {
    return (
      kindFromStats({
        implementation: snapshot.decoderImplementation,
        powerEfficient: snapshot.powerEfficientDecoder,
      }) ?? (await this.#decoders.kindOf(snapshot.codec, snapshot.width ?? 0, snapshot.height ?? 0))
    );
  }

  #clearDisableTimer(entry: SourceEntry): void {
    entry.waitingForFirstConsumer = false;
    if (entry.disableTimer !== null) {
      this.#clock.clearTimeout(entry.disableTimer);
      entry.disableTimer = null;
    }
  }

  async #readReceiver(track: MediaRemoteTrack): Promise<ReceiverSnapshot> {
    try {
      const report = await track.getRTCStatsReport();
      return report === undefined ? {} : this.#stats.read(track, report);
    } catch (error) {
      this.#logger.warn('receiver stats unavailable', errorContext(error));
      return {};
    }
  }

  #entry(sourceId: string): SourceEntry {
    let entry = this.#entries.get(sourceId);
    if (entry === undefined) {
      entry = {
        elements: new Set(),
        sizes: new DesiredSizes(),
        subscription: null,
        availability: PENDING,
        disableTimer: null,
        paused: false,
        waitingForFirstConsumer: false,
      };
      this.#entries.set(sourceId, entry);
    }
    return entry;
  }

  /** Drops entries that carry no information (keeps lost entries for their `since`). */
  #prune(sourceId: string, entry: SourceEntry): void {
    if (
      entry.elements.size === 0 &&
      entry.sizes.isEmpty &&
      entry.subscription === null &&
      entry.availability.state === 'pending'
    ) {
      this.#entries.delete(sourceId);
    }
  }

  #guard(action: string, operation: () => void): void {
    try {
      operation();
    } catch (error) {
      this.#logger.warn(`${action} failed`, errorContext(error));
    }
  }
}
