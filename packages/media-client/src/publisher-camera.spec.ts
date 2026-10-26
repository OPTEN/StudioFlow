import type { CameraControlDto } from '@studioflow/scene-model';
import type { VideoCaptureOptions } from 'livekit-client';
import type { MediaRoom } from './livekit-port';
import { silentLogger } from './logger';
import type { MediaSessionState, SessionStateSource } from './media-session';
import type { CameraSettings } from './publish-options';
import { Publisher } from './publisher';
import {
  FakeLocalVideoTrack,
  FakeMediaStreamTrack,
  FakeRoom,
  asLocalVideoTrack,
  fakeCreateStream,
  flushMicrotasks,
} from './testing/fake-livekit';

/** Remote camera control of the {@link Publisher} (issue #11) with fake tracks that report capabilities. */

class ConnectedSession implements SessionStateSource {
  readonly role = 'sender' as const;
  readonly room: MediaRoom = new FakeRoom();
  readonly state: MediaSessionState = 'connected';

  onRoom(): () => void {
    return () => undefined;
  }

  onStateChange(): () => void {
    return () => undefined;
  }
}

const ANDROID_MAIN: MediaTrackCapabilities = {
  deviceId: 'back-main',
  zoom: { min: 1, max: 8, step: 0.1 },
  focusMode: ['manual', 'continuous'],
  focusDistance: { min: 0.1, max: 2, step: 0.01 },
  exposureCompensation: { min: -2, max: 2, step: 0.5 },
  torch: true,
};

/** The ultra-wide lens of the same phone: no zoom and no light. */
const ANDROID_WIDE: MediaTrackCapabilities = {
  deviceId: 'back-wide',
  focusMode: ['continuous'],
  exposureCompensation: { min: -2, max: 2, step: 0.5 },
};

const DEVICES = [
  { deviceId: 'back-main', label: 'camera2 0, facing back', kind: 'videoinput', groupId: '' },
  { deviceId: 'back-wide', label: 'Back Ultra Wide Camera', kind: 'videoinput', groupId: '' },
  { deviceId: 'front', label: 'camera2 1, facing front', kind: 'videoinput', groupId: '' },
] as unknown as MediaDeviceInfo[];

const PHONE: CameraSettings = { facingMode: 'environment', resolution: 720 };

function lensTrack(
  capabilities: MediaTrackCapabilities,
  facing = 'environment',
): FakeMediaStreamTrack {
  const track = new FakeMediaStreamTrack();
  track.capabilities = capabilities;
  track.settings = {
    ...track.settings,
    deviceId: capabilities.deviceId,
    facingMode: facing,
    ...(capabilities.zoom ? { zoom: 1 } : {}),
    ...(capabilities.focusMode ? { focusMode: 'continuous', focusDistance: 0.8 } : {}),
    ...(capabilities.exposureCompensation ? { exposureCompensation: 0 } : {}),
    ...(capabilities.torch ? { torch: false } : {}),
  };
  return track;
}

/** A restart picks the lens by its device id, like the browser. */
function lensFor(options?: VideoCaptureOptions): FakeMediaStreamTrack {
  const deviceId = options?.deviceId;
  const wanted =
    typeof deviceId === 'object' && !Array.isArray(deviceId) ? deviceId.exact : deviceId;
  if (wanted === 'back-wide') {
    return lensTrack(ANDROID_WIDE);
  }
  if (wanted === 'front' || options?.facingMode === 'user') {
    return lensTrack({ deviceId: 'front' }, 'user');
  }
  return lensTrack(ANDROID_MAIN);
}

function command(fields: Partial<CameraControlDto>): CameraControlDto {
  return {
    v: 1,
    lensId: null,
    zoom: null,
    focusMode: null,
    focusDistance: null,
    exposureCompensation: null,
    torch: null,
    reset: null,
    ...fields,
  };
}

async function setup(capabilities: MediaTrackCapabilities = ANDROID_MAIN, settings = PHONE) {
  const session = new ConnectedSession();
  const cameras: FakeLocalVideoTrack[] = [];
  const createCameraTrack = vi.fn(async (options: VideoCaptureOptions) => {
    const camera = new FakeLocalVideoTrack();
    camera.mediaStreamTrack =
      options.deviceId === undefined ? lensTrack(capabilities).asTrack : lensFor(options).asTrack;
    camera.createMediaTrack = lensFor;
    cameras.push(camera);
    return asLocalVideoTrack(camera);
  });
  const publisher = new Publisher(session, {
    createCameraTrack,
    createStream: fakeCreateStream,
    logger: silentLogger,
    random: () => 0,
    listDevices: async () => DEVICES,
  });
  const kept: CameraSettings[] = [];
  publisher.onCameraSettings((camera) => kept.push(camera));
  await publisher.publishCamera('camera', settings);
  const room = session.room as unknown as FakeRoom;
  const media = () => cameras[cameras.length - 1].fakeMediaTrack;
  return { publisher, cameras, createCameraTrack, kept, room, media };
}

describe('Publisher camera control', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reports nothing without a running camera', async () => {
    const publisher = new Publisher(new ConnectedSession(), { logger: silentLogger });

    await expect(publisher.getCameraState()).resolves.toBeNull();
  });

  it('reports the capabilities, the actual settings and the lenses of an Android phone', async () => {
    const { publisher } = await setup();

    const state = await publisher.getCameraState();

    expect(state).toEqual({
      v: 1,
      capabilities: {
        lenses: [
          { id: 'back-main', label: 'camera2 0, facing back', kind: 'standard' },
          { id: 'back-wide', label: 'Back Ultra Wide Camera', kind: 'ultraWide' },
          { id: 'front', label: 'camera2 1, facing front', kind: 'front' },
        ],
        zoom: { min: 1, max: 8, step: 0.1 },
        focusModes: ['auto', 'manual'],
        focusDistance: { min: 0.1, max: 2, step: 0.01 },
        exposureCompensation: { min: -2, max: 2, step: 0.5 },
        torch: true,
      },
      settings: {
        lensId: 'back-main',
        zoom: 1,
        focusMode: 'auto',
        focusDistance: 0.8,
        exposureCompensation: 0,
        torch: false,
      },
      problem: null,
    });
  });

  it('reports an iPhone without image controls', async () => {
    const { publisher } = await setup({ deviceId: 'front', facingMode: ['user'] });

    const state = await publisher.getCameraState();

    expect(state?.capabilities).toEqual(
      expect.objectContaining({
        zoom: null,
        focusModes: [],
        exposureCompensation: null,
        torch: false,
      }),
    );
  });

  it('applies zoom, brightness and light clamped to the camera and keeps them', async () => {
    const { publisher, media, kept } = await setup();

    await publisher.controlCamera(command({ zoom: 20, exposureCompensation: 0.6, torch: true }));

    expect(media().applyConstraints).toHaveBeenLastCalledWith({
      advanced: [{ zoom: 8, exposureCompensation: 0.5, torch: true }],
    });
    expect((await publisher.getCameraState())?.settings).toEqual(
      expect.objectContaining({ zoom: 8, exposureCompensation: 0.5, torch: true }),
    );
    expect(kept.at(-1)?.image).toEqual({ zoom: 8, exposureCompensation: 0.5, torch: true });
  });

  it('locks the focus at the current distance and goes back to automatic', async () => {
    const { publisher, media, kept } = await setup();

    await publisher.controlCamera(command({ focusMode: 'manual' }));
    expect(media().applyConstraints).toHaveBeenLastCalledWith({
      advanced: [{ focusMode: 'manual', focusDistance: 0.8 }],
    });
    await publisher.controlCamera(command({ focusMode: 'auto' }));

    expect(media().applyConstraints).toHaveBeenLastCalledWith({
      advanced: [{ focusMode: 'continuous' }],
    });
    expect(kept.at(-1)?.image).toEqual({ focusMode: 'auto' });
  });

  it('ignores controls the camera does not have', async () => {
    const { publisher, media } = await setup({ deviceId: 'front', facingMode: ['user'] });

    await publisher.controlCamera(command({ zoom: 2, torch: true }));

    expect(media().applyConstraints).not.toHaveBeenCalled();
    expect((await publisher.getCameraState())?.problem).toBeNull();
  });

  it('merges commands that arrive while one is applied: the newest value wins', async () => {
    const { publisher, media } = await setup();
    let release: () => void = () => undefined;
    media().applyConstraints.mockImplementationOnce(
      () => new Promise<void>((resolve) => (release = resolve)),
    );

    const first = publisher.controlCamera(command({ zoom: 2 }));
    await flushMicrotasks();
    const later = [3, 4, 5].map((zoom) => publisher.controlCamera(command({ zoom })));
    const light = publisher.controlCamera(command({ torch: true }));
    release();
    await Promise.all([first, ...later, light]);

    expect(media().applyConstraints).toHaveBeenCalledTimes(2);
    expect(media().applyConstraints).toHaveBeenLastCalledWith({
      advanced: [{ zoom: 5, torch: true }],
    });
  });

  it('reports an OverconstrainedError and shows what the camera really does', async () => {
    const { publisher, media, kept } = await setup();
    media().constraintError = new DOMException('zoom', 'OverconstrainedError');

    await publisher.controlCamera(command({ zoom: 3 }));

    const state = await publisher.getCameraState();
    expect(state?.problem).toBe('overconstrained');
    expect(state?.settings.zoom).toBe(1);
    expect(kept.at(-1)?.image).toEqual({ zoom: 1 });

    media().constraintError = null;
    await publisher.controlCamera(command({ zoom: 3 }));
    expect((await publisher.getCameraState())?.problem).toBeNull();
  });

  it('reports a value the camera silently ignored', async () => {
    const { publisher, media } = await setup();
    media().ignored.add('zoom');

    await publisher.controlCamera(command({ zoom: 3 }));

    expect((await publisher.getCameraState())?.problem).toBe('overconstrained');
  });

  it('switches the lens in place without republishing, and its zoom starts over', async () => {
    const { publisher, cameras, room, kept } = await setup();
    await publisher.controlCamera(command({ zoom: 4 }));

    await publisher.controlCamera(command({ lensId: 'back-wide', exposureCompensation: 1 }));

    expect(cameras[0].restartTrack).toHaveBeenLastCalledWith(
      expect.objectContaining({ deviceId: { exact: 'back-wide' } }),
    );
    expect(room.localParticipant.publishTrack).toHaveBeenCalledTimes(1);
    const state = await publisher.getCameraState();
    expect(state?.settings.lensId).toBe('back-wide');
    expect(state?.capabilities.zoom).toBeNull();
    expect(state?.settings.exposureCompensation).toBe(1);
    expect(kept.at(-1)).toEqual(
      expect.objectContaining({ deviceId: 'back-wide', image: { exposureCompensation: 1 } }),
    );
  });

  it('takes the facing mode of a lens chosen by id', async () => {
    const { publisher, kept } = await setup();

    await publisher.controlCamera(command({ lensId: 'front' }));

    expect(kept.at(-1)).toEqual(expect.objectContaining({ deviceId: 'front', facingMode: 'user' }));
  });

  it('keeps the lens and reports the problem when the switch fails', async () => {
    const { publisher, cameras } = await setup();
    cameras[0].restartError = new DOMException('gone', 'OverconstrainedError');

    await publisher.controlCamera(command({ lensId: 'back-wide' }));

    const state = await publisher.getCameraState();
    expect(state?.settings.lensId).toBe('back-main');
    expect(state?.problem).toBe('overconstrained');
    expect(publisher.slotState('camera')).toBe('live');
  });

  it('brings the image settings back after the camera restarted', async () => {
    const { publisher, cameras, media } = await setup();
    await publisher.controlCamera(command({ zoom: 3, torch: true }));

    await cameras[0].restartTrack();
    await flushMicrotasks();

    expect(media().applyConstraints).toHaveBeenCalledWith({ advanced: [{ zoom: 3, torch: true }] });
  });

  it('starts with the kept lens and image settings', async () => {
    const { createCameraTrack, media } = await setup(ANDROID_MAIN, {
      ...PHONE,
      deviceId: 'back-main',
      image: { zoom: 2.5 },
    });

    expect(createCameraTrack).toHaveBeenCalledWith(
      expect.objectContaining({ deviceId: { exact: 'back-main' } }),
    );
    expect(media().applyConstraints).toHaveBeenCalledWith({ advanced: [{ zoom: 2.5 }] });
  });

  it('falls back to the facing mode when the kept lens is gone', async () => {
    const session = new ConnectedSession();
    const createCameraTrack = vi.fn(async (options: VideoCaptureOptions) => {
      if (options.deviceId !== undefined) {
        throw new DOMException('no such camera', 'OverconstrainedError');
      }
      const camera = new FakeLocalVideoTrack();
      camera.mediaStreamTrack = lensTrack(ANDROID_MAIN).asTrack;
      return asLocalVideoTrack(camera);
    });
    const publisher = new Publisher(session, { createCameraTrack, logger: silentLogger });

    await publisher.publishCamera('camera', {
      ...PHONE,
      deviceId: 'old-phone',
      image: { zoom: 2 },
    });

    expect(publisher.slotState('camera')).toBe('live');
    expect(createCameraTrack).toHaveBeenLastCalledWith(
      expect.objectContaining({ facingMode: 'environment' }),
    );
  });

  it('resets everything to automatic but leaves the lens', async () => {
    const { publisher, media, kept } = await setup();
    await publisher.controlCamera(command({ zoom: 4, torch: true, exposureCompensation: -1 }));

    await publisher.controlCamera(command({ reset: true }));

    expect(media().applyConstraints).toHaveBeenLastCalledWith({
      advanced: [{ zoom: 1, exposureCompensation: 0, torch: false, focusMode: 'continuous' }],
    });
    expect(kept.at(-1)?.image).toEqual({});
  });

  it('gives up a remote lens and its zoom when the phone switches front/back', async () => {
    const { publisher, cameras } = await setup();
    await publisher.controlCamera(command({ lensId: 'back-wide' }));

    await publisher.switchCamera();

    expect(cameras[0].restartTrack).toHaveBeenLastCalledWith(
      expect.objectContaining({ facingMode: 'user' }),
    );
  });
});
