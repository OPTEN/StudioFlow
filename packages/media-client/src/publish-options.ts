/**
 * Capture and publish settings of the sender (spec section 7, «Publishing» and «Verified livekit-client 2.23.0
 * behaviour»). Pure data, shared by the sender room defaults and the {@link Publisher}.
 */
import {
  Track,
  VideoPreset,
  VideoPresets,
  type ScreenShareCaptureOptions,
  type TrackPublishOptions,
  type VideoCaptureOptions,
  type VideoEncoding,
} from 'livekit-client';

/** Camera picture height the sender can choose. */
export type CameraResolution = 720 | 1080;

/** Front (`user`) or back (`environment`) camera. */
export type FacingMode = 'user' | 'environment';

/** Camera settings chosen on the phone. */
export interface CameraSettings {
  readonly facingMode: FacingMode;
  readonly resolution: CameraResolution;
}

/** True for a structurally valid {@link CameraSettings} value (guards public API input). */
export function isCameraSettings(value: unknown): value is CameraSettings {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const { facingMode, resolution } = value as Record<string, unknown>;
  return (
    (facingMode === 'user' || facingMode === 'environment') &&
    (resolution === 720 || resolution === 1080)
  );
}

/** 480 × 270 layer so a 1080p camera publishes 1080p/540p/270p (livekit has no 270p preset). */
const H270 = new VideoPreset(480, 270, 300_000, 20);

const CAMERA_LAYERS: Readonly<Record<CameraResolution, readonly VideoPreset[]>> = {
  720: [VideoPresets.h180, VideoPresets.h360],
  1080: [H270, VideoPresets.h540],
};

/** getUserMedia constraints for the camera. */
export function cameraCaptureOptions(settings: CameraSettings): VideoCaptureOptions {
  const preset = settings.resolution === 1080 ? VideoPresets.h1080 : VideoPresets.h720;
  return { facingMode: settings.facingMode, resolution: preset.resolution };
}

/** Publish options of the camera: H.264 simulcast with three layers, no backup codec. */
export function cameraPublishOptions(
  slot: string,
  resolution: CameraResolution,
): TrackPublishOptions {
  return {
    name: slot,
    source: Track.Source.Camera,
    simulcast: true,
    videoCodec: 'h264',
    backupCodec: false,
    videoSimulcastLayers: [...CAMERA_LAYERS[resolution]],
    degradationPreference: 'maintain-framerate',
  };
}

/** Encoding cap of a screen share (3 Mbit/s, 30 fps). */
export const SCREEN_SHARE_ENCODING: VideoEncoding = { maxBitrate: 3_000_000, maxFramerate: 30 };

/**
 * getDisplayMedia options of a screen share: no audio, at most 1440p (ideal constraint, smaller screens stay native),
 * hide the sender tab itself, allow switching the shared surface.
 */
export const SCREEN_CAPTURE_OPTIONS: ScreenShareCaptureOptions = {
  audio: false,
  contentHint: 'detail',
  selfBrowserSurface: 'exclude',
  surfaceSwitching: 'include',
  resolution: { width: 2560, height: 1440, frameRate: 30 },
};

/** Publish options of a screen share: VP9 (VP8 backup), no simulcast, resolution before frame rate. */
export function screenPublishOptions(slot: string): TrackPublishOptions {
  return {
    name: slot,
    source: Track.Source.ScreenShare,
    videoCodec: 'vp9',
    backupCodec: { codec: 'vp8' },
    simulcast: false,
    degradationPreference: 'maintain-resolution',
    screenShareEncoding: SCREEN_SHARE_ENCODING,
  };
}
