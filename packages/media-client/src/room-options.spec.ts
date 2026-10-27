import { Track, VideoPresets } from 'livekit-client';
import {
  SCREEN_CAPTURE_OPTIONS,
  cameraCaptureOptions,
  cameraPublishOptions,
  isCameraSettings,
  isScreenFrameRate,
  screenCaptureOptions,
  screenPublishOptions,
  screenShareEncoding,
} from './publish-options';
import { EndlessReconnectPolicy, roomOptionsFor } from './room-options';

describe('roomOptionsFor', () => {
  it.each(['studio', 'output'] as const)('configures %s as a pure subscriber', (role) => {
    const options = roomOptionsFor(role);
    expect(options).toMatchObject({
      adaptiveStream: false,
      dynacast: false,
      disconnectOnPageLeave: true,
      stopLocalTrackOnUnpublish: false,
    });
    expect(options.reconnectPolicy).toBeInstanceOf(EndlessReconnectPolicy);
    expect(options.publishDefaults).toBeUndefined();
  });

  it('configures the sender with dynacast and H.264 simulcast defaults', () => {
    const options = roomOptionsFor('sender');
    expect(options).toMatchObject({
      adaptiveStream: false,
      dynacast: true,
      stopLocalTrackOnUnpublish: false,
    });
    expect(options.publishDefaults).toMatchObject({
      videoCodec: 'h264',
      backupCodec: false,
      simulcast: true,
      videoSimulcastLayers: [VideoPresets.h180, VideoPresets.h360],
      screenShareEncoding: { maxBitrate: 3_000_000, maxFramerate: 15 },
    });
  });

  it('merges overrides, publishDefaults one level deep', () => {
    const options = roomOptionsFor('sender', {
      adaptiveStream: true,
      publishDefaults: { videoCodec: 'vp8' },
    });
    expect(options.adaptiveStream).toBe(true);
    expect(options.publishDefaults).toMatchObject({
      videoCodec: 'vp8',
      simulcast: true,
      backupCodec: false,
    });
  });
});

describe('EndlessReconnectPolicy', () => {
  it('never gives up and stays within 0 … 5.25 s', () => {
    const policy = new EndlessReconnectPolicy();
    for (let retryCount = 0; retryCount < 1000; retryCount++) {
      const delay = policy.nextRetryDelayInMs({ retryCount, elapsedMs: retryCount * 5000 });
      expect(delay).not.toBeNull();
      expect(delay).toBeGreaterThanOrEqual(0);
      expect(delay).toBeLessThanOrEqual(5250);
    }
  });

  it('follows the shared backoff (immediate first retry, then 300 ms doubling, capped)', () => {
    const policy = new EndlessReconnectPolicy(() => 0);
    const delays = [0, 1, 2, 3, 4, 5, 6, 50].map((retryCount) =>
      policy.nextRetryDelayInMs({ retryCount, elapsedMs: 0 }),
    );
    expect(delays).toEqual([0, 300, 600, 1200, 2400, 4800, 5000, 5000]);
  });
});

describe('publish options', () => {
  it('publishes a 720p camera with 720/360/180 layers and a 1080p camera with 1080/540/270', () => {
    expect(cameraPublishOptions('camera', 720)).toEqual({
      name: 'camera',
      source: Track.Source.Camera,
      simulcast: true,
      videoCodec: 'h264',
      backupCodec: false,
      videoSimulcastLayers: [VideoPresets.h180, VideoPresets.h360],
      degradationPreference: 'maintain-framerate',
    });
    const layers = cameraPublishOptions('camera', 1080).videoSimulcastLayers ?? [];
    expect(layers.map((preset) => [preset.width, preset.height])).toEqual([
      [480, 270],
      [960, 540],
    ]);
  });

  it('captures the camera with facing mode and preset resolution', () => {
    expect(cameraCaptureOptions({ facingMode: 'environment', resolution: 1080 })).toEqual({
      facingMode: 'environment',
      resolution: VideoPresets.h1080.resolution,
    });
    expect(cameraCaptureOptions({ facingMode: 'user', resolution: 720 }).resolution).toEqual(
      VideoPresets.h720.resolution,
    );
  });

  it('publishes screens as H.264 without a backup codec, no simulcast, 3 Mbit/s at 15 fps by default', () => {
    expect(screenPublishOptions('screen-2')).toEqual({
      name: 'screen-2',
      source: Track.Source.ScreenShare,
      videoCodec: 'h264',
      backupCodec: false,
      simulcast: false,
      degradationPreference: 'maintain-resolution',
      screenShareEncoding: { maxBitrate: 3_000_000, maxFramerate: 15 },
    });
  });

  it('publishes a screen as VP9 with a VP8 backup when asked to (power-efficient encoder)', () => {
    expect(screenPublishOptions('screen-1', 'vp9')).toMatchObject({
      videoCodec: 'vp9',
      backupCodec: { codec: 'vp8' },
      screenShareEncoding: { maxBitrate: 3_000_000, maxFramerate: 15 },
    });
  });

  it('publishes "Video in screen" at 30 fps with more bits and a balanced degradation', () => {
    expect(screenPublishOptions('screen-1', 'h264', 30)).toMatchObject({
      degradationPreference: 'balanced',
      screenShareEncoding: { maxBitrate: 4_500_000, maxFramerate: 30 },
    });
    expect(screenShareEncoding(15)).toEqual({ maxBitrate: 3_000_000, maxFramerate: 15 });
  });

  it('captures screens without audio, with detail hint, excluding the own tab, at 15 fps', () => {
    expect(SCREEN_CAPTURE_OPTIONS).toMatchObject({
      audio: false,
      contentHint: 'detail',
      selfBrowserSurface: 'exclude',
      surfaceSwitching: 'include',
      resolution: { width: 2560, height: 1440, frameRate: 15 },
    });
  });

  it('captures "Video in screen" at 30 fps with the motion hint', () => {
    expect(screenCaptureOptions(30)).toMatchObject({
      contentHint: 'motion',
      resolution: { width: 2560, height: 1440, frameRate: 30 },
    });
  });

  it.each([
    [15, true],
    [30, true],
    [24, false],
    ['15', false],
    [null, false],
  ])('accepts the screen frame rate %j → %s', (value, valid) => {
    expect(isScreenFrameRate(value)).toBe(valid);
  });

  it.each([
    [{ facingMode: 'user', resolution: 720 }, true],
    [{ facingMode: 'environment', resolution: 1080 }, true],
    [{ facingMode: 'left', resolution: 720 }, false],
    [{ facingMode: 'user', resolution: 480 }, false],
    [{ facingMode: 'user' }, false],
    [null, false],
    ['user', false],
  ])('validates camera settings %j → %s', (value, valid) => {
    expect(isCameraSettings(value)).toBe(valid);
  });
});
