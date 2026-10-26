/**
 * @studioflow/media-client: livekit-client wrapper (sessions with endless reconnect, source provider, publisher, stats)
 * plus the sender's device helpers (technical check, wake lock, device info).
 *
 * Importing this entry point loads livekit-client (~150 KB gzip, not tree-shakable): the Regie imports it lazily.
 * The device helpers alone are available without livekit-client from `@studioflow/media-client/device`.
 */
export { AudioPublisher, type AudioPublisherOptions } from './audio-publisher';
export { systemClock, type Clock, type TimerHandle } from './clock';
export * from './device';
export {
  disconnectOutcome,
  isAuthorizationError,
  type DisconnectOutcome,
} from './disconnect-reason';
export {
  createLiveKitRoom,
  type MediaLocalParticipant,
  type MediaRemoteParticipant,
  type MediaRemotePublication,
  type MediaRemoteTrack,
  type MediaRoom,
  type RoomFactory,
  type VideoDimensions,
} from './livekit-port';
export { consoleLogger, silentLogger, type MediaLogger } from './logger';
export {
  connectFailureStage,
  createMediaTestRoom,
  runMediaRoundTrip,
  type MediaTestInput,
  type MediaTestResult,
  type MediaTestRoom,
  type MediaTestRoomFactory,
  type MediaTestStage,
} from './media-test';
export {
  MediaSession,
  isTerminalState,
  toRtcState,
  type MediaSessionOptions,
  type MediaSessionState,
  type RoomSource,
  type SessionStateSource,
} from './media-session';
export {
  watchPageLifecycle,
  type PageLifecycle,
  type PageLifecycleTargets,
} from './page-lifecycle';
export {
  Publisher,
  type LocalSlotState,
  type PublisherOptions,
  type SlotStateListener,
} from './publisher';
export {
  SCREEN_FRAME_RATE_DEFAULT,
  SCREEN_FRAME_RATE_VIDEO,
  type CameraResolution,
  type CameraSettings,
  type FacingMode,
  type MicProfile,
  type MicSettings,
  type ScreenFrameRate,
} from './publish-options';
export { EndlessReconnectPolicy, roomOptionsFor, type MediaRole } from './room-options';
export {
  LiveKitSourceProvider,
  type AudioSourceStats,
  type DecoderSummary,
  type LiveKitSourceProviderOptions,
  type SourceStats,
  type StreamDecoder,
} from './source-provider';
