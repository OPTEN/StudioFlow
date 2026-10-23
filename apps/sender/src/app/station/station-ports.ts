import { InjectionToken } from '@angular/core';
import { MediaSession, Publisher } from '@studioflow/media-client';
import {
  ScreenWakeLock,
  runTechCheck,
  type TechCheckOptions,
  type TechCheckResult,
} from '@studioflow/media-client/device';
import { ResilientHub, type ResilientHubOptions } from '@studioflow/realtime-client';
import type { LiveKitTokenDto } from '@studioflow/scene-model';

/**
 * Seams between the station and the shared packages. The real implementations are the package classes; unit tests
 * provide fakes through these tokens (happy-dom has no WebRTC). The `Pick` types are checked against the real classes,
 * so a package API change breaks the build here.
 */

/** The device hub connection (`ResilientHub` from `@studioflow/realtime-client`). */
export type DeviceHub = Pick<
  ResilientHub,
  | 'state'
  | 'start'
  | 'restart'
  | 'stop'
  | 'markTerminal'
  | 'on'
  | 'invoke'
  | 'send'
  | 'onStateChange'
  | 'onConnected'
>;

/** Creates the device hub connection. */
export type DeviceHubFactory = (options: ResilientHubOptions) => DeviceHub;

/** The sender's LiveKit session (`MediaSession` from `@studioflow/media-client`, role `sender`). */
export type SenderMediaSession = Pick<
  MediaSession,
  'state' | 'onStateChange' | 'start' | 'restart' | 'stop'
>;

/** Camera and screen publishing (`Publisher` from `@studioflow/media-client`). */
export type SenderPublisher = Pick<
  Publisher,
  | 'publishCamera'
  | 'switchCamera'
  | 'setCameraResolution'
  | 'publishScreen'
  | 'unpublish'
  | 'stopAll'
  | 'onSlotState'
  | 'slotState'
  | 'getSlotTelemetry'
  | 'localPreview'
  | 'dispose'
>;

/** The media pair of a station. */
export interface SenderMedia {
  readonly session: SenderMediaSession;
  readonly publisher: SenderPublisher;
}

/** Creates the media pair; `tokenProvider` fetches a fresh LiveKit token for every join. */
export type SenderMediaFactory = (tokenProvider: () => Promise<LiveKitTokenDto>) => SenderMedia;

/** Screen wake lock (`ScreenWakeLock` from `@studioflow/media-client`). */
export type StationWakeLock = Pick<ScreenWakeLock, 'enable' | 'disable' | 'dispose' | 'active'>;

/** Runs the technical check (`runTechCheck` from `@studioflow/media-client`). */
export type TechCheckRunner = (options: TechCheckOptions) => Promise<TechCheckResult>;

/** Factory of the device hub. */
export const DEVICE_HUB_FACTORY = new InjectionToken<DeviceHubFactory>(
  'studioflow.deviceHubFactory',
  {
    providedIn: 'root',
    factory: () => (options) => new ResilientHub(options),
  },
);

/** Factory of the LiveKit session and publisher. */
export const SENDER_MEDIA_FACTORY = new InjectionToken<SenderMediaFactory>(
  'studioflow.senderMediaFactory',
  {
    providedIn: 'root',
    factory: () => (tokenProvider) => {
      const session = new MediaSession({ role: 'sender', tokenProvider });
      return { session, publisher: new Publisher(session) };
    },
  },
);

/** Factory of the screen wake lock. */
export const WAKE_LOCK_FACTORY = new InjectionToken<() => StationWakeLock>(
  'studioflow.wakeLockFactory',
  {
    providedIn: 'root',
    factory: () => () => new ScreenWakeLock(),
  },
);

/** The technical check. */
export const TECH_CHECK_RUNNER = new InjectionToken<TechCheckRunner>('studioflow.techCheckRunner', {
  providedIn: 'root',
  factory: () => runTechCheck,
});
