/**
 * @flowstudio/media-client: livekit-client wrapper (sessions with endless reconnect, source provider, publisher, stats)
 * plus the sender's device helpers (technical check, wake lock, device info).
 *
 * Importing this entry point loads livekit-client (~150 KB gzip, not tree-shakable): the Regie imports it lazily.
 */
export { systemClock, type Clock, type TimerHandle } from './clock';
export { battery, canShareScreen, isLikelyPhone, networkType, platformLabel } from './device-info';
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
export { type CameraResolution, type CameraSettings, type FacingMode } from './publish-options';
export { EndlessReconnectPolicy, roomOptionsFor, type MediaRole } from './room-options';
export {
  LiveKitSourceProvider,
  type LiveKitSourceProviderOptions,
  type SourceStats,
} from './source-provider';
export { TECH_CHECK, runTechCheck, type TechCheckOptions } from './tech-check';
export { ScreenWakeLock, type WakeLockEnvironment } from './wake-lock';
