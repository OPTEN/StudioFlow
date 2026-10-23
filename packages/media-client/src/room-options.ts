/**
 * `Room` options per client role (spec section 7, “Subscribing” and “Verified livekit-client 2.23.0 behaviour”).
 */
import { backoffDelay } from '@studioflow/realtime-client';
import {
  VideoPresets,
  type ReconnectContext,
  type ReconnectPolicy,
  type RoomOptions,
} from 'livekit-client';
import { SCREEN_SHARE_ENCODING } from './publish-options';

/** Which StudioFlow client owns a media session. */
export type MediaRole = 'studio' | 'output' | 'sender';

/**
 * SDK reconnect policy that never gives up (livekit's `DefaultReconnectPolicy` returns null after ~40 s). Delays follow
 * the shared {@link backoffDelay}: 0, 300, 600 … capped at 5 s plus jitter. The SDK still gives up on unrecoverable
 * errors (401/403, deleted room); {@link MediaSession} handles that by rejoining with a fresh token.
 */
export class EndlessReconnectPolicy implements ReconnectPolicy {
  constructor(private readonly random: () => number = Math.random) {}

  /** Always returns a delay, never null. */
  nextRetryDelayInMs(context: ReconnectContext): number {
    return backoffDelay(context.retryCount, this.random);
  }
}

/**
 * Sender publish defaults; every publish passes explicit options as well (see `publish-options.ts`), these only cover
 * SDK-internal publishes such as a republish after a full reconnect.
 */
const SENDER_DEFAULTS: RoomOptions = {
  videoCaptureDefaults: { resolution: VideoPresets.h720.resolution },
  publishDefaults: {
    videoCodec: 'h264',
    backupCodec: false,
    simulcast: true,
    videoSimulcastLayers: [VideoPresets.h180, VideoPresets.h360],
    screenShareEncoding: SCREEN_SHARE_ENCODING,
  },
};

/**
 * Builds the room options of a role; `overrides` are merged on top (one level deep for `publishDefaults`).
 *
 * - `adaptiveStream` is off for every role. livekit's adaptive stream only measures elements attached with
 *   `track.attach()` and disables tracks without such elements; the provider deliberately never calls `attach()`
 *   (hold frame, see spec section 7) and sets the layer explicitly from the renderers' desired sizes instead.
 * - `dynacast` only matters for publishers: on for the sender.
 * - `stopLocalTrackOnUnpublish: false`: local tracks belong to the {@link Publisher}; a give-up of the SDK must not
 *   stop a screen share (it could not be restarted without a new user gesture).
 * - `disconnectOnPageLeave: true` and the endless reconnect policy for everyone.
 */
export function roomOptionsFor(
  role: MediaRole,
  overrides: RoomOptions = {},
  random: () => number = Math.random,
): RoomOptions {
  const base: RoomOptions = {
    adaptiveStream: false,
    dynacast: role === 'sender',
    disconnectOnPageLeave: true,
    stopLocalTrackOnUnpublish: false,
    reconnectPolicy: new EndlessReconnectPolicy(random),
    ...(role === 'sender' ? SENDER_DEFAULTS : {}),
  };
  const publishDefaults =
    base.publishDefaults || overrides.publishDefaults
      ? { ...base.publishDefaults, ...overrides.publishDefaults }
      : undefined;
  return { ...base, ...overrides, ...(publishDefaults ? { publishDefaults } : {}) };
}
