/**
 * The narrow slice of livekit-client this package depends on, as structural interfaces ("ports").
 *
 * Production code receives real `Room` objects (see {@link createLiveKitRoom}, which proves at compile time that `Room`
 * satisfies {@link MediaRoom}); tests pass small fakes that emit the same `RoomEvent` names. Keeping the surface this
 * small also documents exactly which SDK behaviour the media client relies on.
 */
import {
  Room,
  RoomEvent,
  type ConnectionState,
  type DisconnectReason,
  type LocalTrack,
  type RoomConnectOptions,
  type RoomOptions,
  type TrackPublishOptions,
  type VideoQuality,
} from 'livekit-client';

/** Width and height in pixels. */
export interface VideoDimensions {
  readonly width: number;
  readonly height: number;
}

/** The writable jitter buffer target of an `RTCRtpReceiver` (ms, Chrome 124+, Firefox 115+). */
export interface JitterBufferControl {
  jitterBufferTarget?: number | null;
}

/** A subscribed remote track (`RemoteTrack` / `RemoteVideoTrack`). */
export interface MediaRemoteTrack {
  readonly kind: string;
  readonly mediaStreamTrack: MediaStreamTrack;
  /** Receive bitrate in bits per second, refreshed by the SDK every 2 s (0 until two samples exist). */
  readonly currentBitrate: number;
  readonly receiver?: JitterBufferControl;
  setPlayoutDelay?(delayInSeconds: number): void;
  /** `RTCRtpReceiver.getStats()` of this track (inbound-rtp, codec, transport, candidate pair). */
  getRTCStatsReport(): Promise<RTCStatsReport | undefined>;
}

/** A remote track publication (`RemoteTrackPublication`). */
export interface MediaRemotePublication {
  readonly kind: string;
  readonly trackName: string;
  readonly isMuted: boolean;
  readonly isSubscribed: boolean;
  readonly track?: MediaRemoteTrack;
  setVideoQuality(quality: VideoQuality): void;
  setVideoDimensions(dimensions: VideoDimensions): void;
  setEnabled(enabled: boolean): void;
}

/** A remote participant (`RemoteParticipant`); the identity is the device id for senders. */
export interface MediaRemoteParticipant {
  readonly identity: string;
  readonly trackPublications: ReadonlyMap<string, MediaRemotePublication>;
}

/** Identifies the publication of a mute event (local or remote). */
export interface MediaPublicationRef {
  readonly trackName: string;
  readonly kind: string;
}

/** Identifies the participant of a mute event (local or remote). */
export interface MediaParticipantRef {
  readonly identity: string;
}

/** The local participant (`LocalParticipant`): publishing only. */
export interface MediaLocalParticipant {
  publishTrack(track: LocalTrack, options?: TrackPublishOptions): Promise<unknown>;
  unpublishTrack(track: LocalTrack, stopOnUnpublish?: boolean): Promise<unknown>;
}

/** The room (`Room`). Events are attached through {@link listenTo}, which types the payloads. */
export interface MediaRoom {
  readonly state: ConnectionState;
  readonly localParticipant: MediaLocalParticipant;
  readonly remoteParticipants: ReadonlyMap<string, MediaRemoteParticipant>;
  connect(url: string, token: string, options?: RoomConnectOptions): Promise<void>;
  disconnect(stopTracks?: boolean): Promise<void>;
  on(event: string, listener: (...args: never[]) => void): unknown;
  off(event: string, listener: (...args: never[]) => void): unknown;
}

/** Room events used by this package with the payloads livekit-client 2.23.0 emits. */
export interface MediaRoomEvents {
  [RoomEvent.Reconnecting]: () => void;
  [RoomEvent.SignalReconnecting]: () => void;
  [RoomEvent.Reconnected]: () => void;
  [RoomEvent.Disconnected]: (reason?: DisconnectReason) => void;
  [RoomEvent.ParticipantDisconnected]: (participant: MediaRemoteParticipant) => void;
  [RoomEvent.TrackSubscribed]: (
    track: MediaRemoteTrack,
    publication: MediaRemotePublication,
    participant: MediaRemoteParticipant,
  ) => void;
  [RoomEvent.TrackUnsubscribed]: (
    track: MediaRemoteTrack,
    publication: MediaRemotePublication,
    participant: MediaRemoteParticipant,
  ) => void;
  [RoomEvent.TrackUnpublished]: (
    publication: MediaRemotePublication,
    participant: MediaRemoteParticipant,
  ) => void;
  [RoomEvent.TrackMuted]: (
    publication: MediaPublicationRef,
    participant: MediaParticipantRef,
  ) => void;
  [RoomEvent.TrackUnmuted]: (
    publication: MediaPublicationRef,
    participant: MediaParticipantRef,
  ) => void;
  [RoomEvent.MediaDevicesError]: (error: Error, kind?: MediaDeviceKind) => void;
}

/** Creates the room for one connect attempt. Injected in tests. */
export type RoomFactory = (options: RoomOptions) => MediaRoom;

/** Production room factory. Its type annotation is the compile-time proof that `Room` satisfies {@link MediaRoom}. */
export const createLiveKitRoom: RoomFactory = (options) => new Room(options);

/** Typed, error-isolated event subscriptions on one room, removable in one call. */
export interface RoomListenerGroup {
  /** Adds a handler; exceptions thrown by it are passed to the group's error callback, never into the SDK. */
  on<E extends keyof MediaRoomEvents>(event: E, handler: MediaRoomEvents[E]): RoomListenerGroup;
  /** Removes every handler added through this group. */
  dispose(): void;
}

/** Starts a {@link RoomListenerGroup} on `room`. */
export function listenTo(room: MediaRoom, onError: (error: unknown) => void): RoomListenerGroup {
  const removals: (() => void)[] = [];
  const group: RoomListenerGroup = {
    on: (event, handler) => {
      const guarded = guard(handler, onError);
      room.on(event, guarded);
      removals.push(() => room.off(event, guarded));
      return group;
    },
    dispose: () => {
      for (const remove of removals.splice(0)) {
        remove();
      }
    },
  };
  return group;
}

function guard(
  handler: (...args: never[]) => void,
  onError: (error: unknown) => void,
): (...args: never[]) => void {
  return (...args) => {
    try {
      handler(...args);
    } catch (error) {
      onError(error);
    }
  };
}
