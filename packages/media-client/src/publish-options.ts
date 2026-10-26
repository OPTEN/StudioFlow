/**
 * Capture and publish settings of the sender (spec section 7, “Publishing” and “Verified livekit-client 2.23.0
 * behaviour”). Pure data, shared by the sender room defaults and the {@link Publisher}.
 */
import { screenAudioTrackName } from '@studioflow/scene-model';
import {
  AudioPresets,
  Track,
  VideoPreset,
  VideoPresets,
  type AudioCaptureOptions,
  type ScreenShareCaptureOptions,
  type TrackPublishOptions,
  type VideoCaptureOptions,
  type VideoEncoding,
} from 'livekit-client';
import type { CameraImageSettings } from './camera-control';
import type { ScreenCodec } from './screen-codec';

/** Camera picture height the sender can choose. */
export type CameraResolution = 720 | 1080;

/** Front (`user`) or back (`environment`) camera. */
export type FacingMode = 'user' | 'environment';

/** Camera settings chosen on the phone or by the Regie. */
export interface CameraSettings {
  readonly facingMode: FacingMode;
  readonly resolution: CameraResolution;
  /** A specific lens (browser device id, issue #11); wins over `facingMode`. */
  readonly deviceId?: string;
  /** Zoom, focus, brightness and light requested remotely; restored after every camera restart. */
  readonly image?: CameraImageSettings;
}

/** True for a structurally valid {@link CameraSettings} value (guards public API input). */
export function isCameraSettings(value: unknown): value is CameraSettings {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const { facingMode, resolution, deviceId, image } = value as Record<string, unknown>;
  return (
    (facingMode === 'user' || facingMode === 'environment') &&
    (resolution === 720 || resolution === 1080) &&
    (deviceId === undefined || (typeof deviceId === 'string' && deviceId !== '')) &&
    (image === undefined || (typeof image === 'object' && image !== null))
  );
}

/** 480 × 270 layer so a 1080p camera publishes 1080p/540p/270p (livekit has no 270p preset). */
const H270 = new VideoPreset(480, 270, 300_000, 20);

const CAMERA_LAYERS: Readonly<Record<CameraResolution, readonly VideoPreset[]>> = {
  720: [VideoPresets.h180, VideoPresets.h360],
  1080: [H270, VideoPresets.h540],
};

/** getUserMedia constraints for the camera: a chosen lens by its device id, otherwise by facing mode. */
export function cameraCaptureOptions(settings: CameraSettings): VideoCaptureOptions {
  const preset = settings.resolution === 1080 ? VideoPresets.h1080 : VideoPresets.h720;
  return settings.deviceId === undefined
    ? { facingMode: settings.facingMode, resolution: preset.resolution }
    : { deviceId: { exact: settings.deviceId }, resolution: preset.resolution };
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

/** Frame rate of a screen share: 15 fps is enough for slides, 30 fps is the option "Video in screen". */
export type ScreenFrameRate = 15 | 30;

/** Slides do not need 30 fps: half the frames halve the encoding on the laptop and the decoding in the Regie and the output. */
export const SCREEN_FRAME_RATE_DEFAULT: ScreenFrameRate = 15;

/** The option "Video in screen" of a slot. */
export const SCREEN_FRAME_RATE_VIDEO: ScreenFrameRate = 30;

/** True for a frame rate a screen slot can have. */
export function isScreenFrameRate(value: unknown): value is ScreenFrameRate {
  return value === SCREEN_FRAME_RATE_DEFAULT || value === SCREEN_FRAME_RATE_VIDEO;
}

/** Encoding cap of a screen share: 3 Mbit/s at 15 fps, 4.5 Mbit/s at 30 fps (video needs more bits per second). */
export function screenShareEncoding(frameRate: ScreenFrameRate): VideoEncoding {
  return {
    maxBitrate: frameRate === SCREEN_FRAME_RATE_VIDEO ? 4_500_000 : 3_000_000,
    maxFramerate: frameRate,
  };
}

/** Encoding cap of a screen share at the default frame rate (also the room default for SDK-internal publishes). */
export const SCREEN_SHARE_ENCODING: VideoEncoding = screenShareEncoding(SCREEN_FRAME_RATE_DEFAULT);

/**
 * getDisplayMedia options of a screen share: at most 1440p (ideal constraint, smaller screens stay native) at the frame
 * rate of the slot, hide the sender tab itself, allow switching the shared surface. With `withAudio` the share also asks
 * for sound: the browser decides what it can deliver (Chromium on Windows the whole system's sound, on macOS, Linux and
 * for a window only the sound of a tab, Firefox and Safari none). The processing is off, so the sound arrives as it plays.
 */
export function screenCaptureOptions(
  frameRate: ScreenFrameRate = SCREEN_FRAME_RATE_DEFAULT,
  withAudio = false,
): ScreenShareCaptureOptions {
  return {
    audio: withAudio
      ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
      : false,
    ...(withAudio ? { systemAudio: 'include' as const } : {}),
    contentHint: contentHintOf(frameRate),
    selfBrowserSurface: 'exclude',
    surfaceSwitching: 'include',
    resolution: { width: 2560, height: 1440, frameRate },
  };
}

/** Screen share options at the default frame rate. */
export const SCREEN_CAPTURE_OPTIONS: ScreenShareCaptureOptions = screenCaptureOptions();

/** Slides are sharp text (`detail`: resolution before frame rate), "Video in screen" is motion. */
export function contentHintOf(frameRate: ScreenFrameRate): 'detail' | 'motion' {
  return frameRate === SCREEN_FRAME_RATE_VIDEO ? 'motion' : 'detail';
}

/**
 * Publish options of a screen share, no simulcast. VP9 (with a VP8 backup for subscribers that cannot decode it) only when
 * the sender's encoder for it is power efficient, else H.264 (see `screen-codec.ts`); resolution before frame rate for
 * slides, a balance of both for video.
 */
export function screenPublishOptions(
  slot: string,
  codec: ScreenCodec = 'h264',
  frameRate: ScreenFrameRate = SCREEN_FRAME_RATE_DEFAULT,
): TrackPublishOptions {
  return {
    name: slot,
    source: Track.Source.ScreenShare,
    videoCodec: codec,
    backupCodec: codec === 'vp9' ? { codec: 'vp8' } : false,
    simulcast: false,
    degradationPreference:
      frameRate === SCREEN_FRAME_RATE_VIDEO ? 'balanced' : 'maintain-resolution',
    screenShareEncoding: screenShareEncoding(frameRate),
  };
}

/** Screen share options with sound at the default frame rate. */
export const SCREEN_CAPTURE_WITH_AUDIO_OPTIONS: ScreenShareCaptureOptions = screenCaptureOptions(
  SCREEN_FRAME_RATE_DEFAULT,
  true,
);

/** Publish options of the sound of a screen share (`screen-n-audio`): Opus stereo with a high bitrate, DTX off, RED on. */
export function screenAudioPublishOptions(slot: string): TrackPublishOptions {
  return {
    name: screenAudioTrackName(slot),
    source: Track.Source.ScreenShareAudio,
    audioPreset: AudioPresets.musicHighQualityStereo,
    dtx: false,
    red: true,
    forceStereo: true,
  };
}

/**
 * Microphone profile:
 * - `voice`: a person's microphone (phone, laptop) with the browser's echo cancellation, noise suppression and automatic
 *   gain, mono;
 * - `station`: the feed of a mixing desk (the audio station): nothing touches the signal, stereo, high bitrate.
 */
export type MicProfile = 'voice' | 'station';

/** What the sender chooses for the microphone. */
export interface MicSettings {
  readonly profile: MicProfile;
  /** A specific input (browser device id); the default input otherwise. */
  readonly deviceId?: string;
}

/** True for a structurally valid {@link MicSettings} value (guards public API input). */
export function isMicSettings(value: unknown): value is MicSettings {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const { profile, deviceId } = value as Record<string, unknown>;
  return (
    (profile === 'voice' || profile === 'station') &&
    (deviceId === undefined || (typeof deviceId === 'string' && deviceId !== ''))
  );
}

/** getUserMedia constraints of the microphone. A chosen input is requested exactly, so a missing one is an error. */
export function micCaptureOptions(settings: MicSettings): AudioCaptureOptions {
  const processing = settings.profile === 'voice';
  return {
    echoCancellation: processing,
    noiseSuppression: processing,
    autoGainControl: processing,
    channelCount: processing ? 1 : 2,
    ...(settings.deviceId === undefined ? {} : { deviceId: { exact: settings.deviceId } }),
  };
}

/** Publish options of the microphone: Opus with RED and DTX off; the station sends stereo with a high bitrate. */
export function micPublishOptions(slot: string, profile: MicProfile): TrackPublishOptions {
  return {
    name: slot,
    source: Track.Source.Microphone,
    audioPreset: profile === 'station' ? AudioPresets.musicHighQualityStereo : AudioPresets.music,
    dtx: false,
    red: true,
    forceStereo: profile === 'station',
  };
}
