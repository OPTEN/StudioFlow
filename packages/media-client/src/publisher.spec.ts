import {
  RoomEvent,
  Track,
  TrackEvent,
  VideoPresets,
  type ScreenShareCaptureOptions,
  type VideoCaptureOptions,
} from 'livekit-client';
import type { LocalVideoTrack } from 'livekit-client';
import type { Mock } from 'vitest';
import type { MediaRoom } from './livekit-port';
import { silentLogger } from './logger';
import type { MediaSessionState, SessionStateSource } from './media-session';
import { Publisher, type LocalSlotState, type PublisherOptions } from './publisher';
import type { SlotFailure } from './slot-failure';
import {
  FakeLocalVideoTrack,
  FakeMediaStream,
  FakeMediaStreamTrack,
  FakeRoom,
  asLocalVideoTrack,
  fakeCreateStream,
  flushMicrotasks,
} from './testing/fake-livekit';

class FakeSession implements SessionStateSource {
  readonly role = 'sender' as const;
  room: MediaRoom | null = null;
  state: MediaSessionState = 'connecting';
  readonly #roomListeners = new Set<(room: MediaRoom | null) => void>();
  readonly #stateListeners = new Set<(state: MediaSessionState) => void>();

  onRoom(listener: (room: MediaRoom | null) => void): () => void {
    this.#roomListeners.add(listener);
    return () => this.#roomListeners.delete(listener);
  }

  onStateChange(listener: (state: MediaSessionState) => void): () => void {
    this.#stateListeners.add(listener);
    return () => this.#stateListeners.delete(listener);
  }

  /** New room announced, then connected (the MediaSession order). */
  connect(room: FakeRoom = new FakeRoom()): FakeRoom {
    this.room = room;
    this.#roomListeners.forEach((listener) => listener(room));
    this.setState('connected');
    return room;
  }

  lose(): void {
    this.room = null;
    this.#roomListeners.forEach((listener) => listener(null));
    this.setState('waiting');
  }

  setState(state: MediaSessionState): void {
    this.state = state;
    this.#stateListeners.forEach((listener) => listener(state));
  }

  get listenerCount(): number {
    return this.#roomListeners.size + this.#stateListeners.size;
  }
}

interface Harness {
  readonly session: FakeSession;
  readonly publisher: Publisher;
  readonly cameras: FakeLocalVideoTrack[];
  readonly screens: FakeLocalVideoTrack[];
  readonly createCameraTrack: Mock<(options: VideoCaptureOptions) => Promise<LocalVideoTrack>>;
  readonly createScreenTrack: Mock<
    (options: ScreenShareCaptureOptions) => Promise<LocalVideoTrack>
  >;
  readonly states: [string, LocalSlotState, string?][];
}

function setup(options: Partial<PublisherOptions> = {}): Harness {
  const session = new FakeSession();
  const cameras: FakeLocalVideoTrack[] = [];
  const screens: FakeLocalVideoTrack[] = [];
  const createCameraTrack = vi.fn(async (_options: VideoCaptureOptions) => {
    const track = new FakeLocalVideoTrack();
    cameras.push(track);
    return asLocalVideoTrack(track);
  });
  const createScreenTrack = vi.fn(async (_options: ScreenShareCaptureOptions) => {
    const track = new FakeLocalVideoTrack();
    track.codec = 'vp9';
    screens.push(track);
    return asLocalVideoTrack(track);
  });
  const publisher = new Publisher(session, {
    createCameraTrack,
    createScreenTrack,
    createStream: fakeCreateStream,
    logger: silentLogger,
    random: () => 0,
    ...options,
  });
  const states: [string, LocalSlotState, string?][] = [];
  publisher.onSlotState((slot, state, message) =>
    states.push(message === undefined ? [slot, state] : [slot, state, message]),
  );
  return { session, publisher, cameras, screens, createCameraTrack, createScreenTrack, states };
}

const PHONE = { facingMode: 'user', resolution: 720 } as const;

function stateSequence(states: Harness['states'], slot: string): LocalSlotState[] {
  return states
    .filter(([name]) => name === slot)
    .map(([, state]) => state)
    .filter((state, index, all) => state !== all[index - 1]);
}

function domError(name: string): DOMException {
  return new DOMException(name, name);
}

describe('Publisher', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('camera', () => {
    it('captures, publishes with the camera options and becomes live', async () => {
      const { session, publisher, cameras, createCameraTrack, states } = setup();
      const room = session.connect();
      await publisher.publishCamera('camera', { facingMode: 'environment', resolution: 1080 });

      expect(createCameraTrack).toHaveBeenCalledWith({
        facingMode: 'environment',
        resolution: VideoPresets.h1080.resolution,
      });
      expect(cameras[0].mediaStreamTrack.contentHint).toBe('motion');
      expect(room.localParticipant.publishTrack).toHaveBeenCalledWith(
        cameras[0],
        expect.objectContaining({
          name: 'camera',
          source: Track.Source.Camera,
          videoCodec: 'h264',
          backupCodec: false,
        }),
      );
      const layers =
        room.localParticipant.publishTrack.mock.calls[0][1]?.videoSimulcastLayers ?? [];
      expect(layers.map((preset) => preset.height)).toEqual([270, 540]);
      expect(publisher.slotState('camera')).toBe('live');
      expect(stateSequence(states, 'camera')).toEqual(['starting', 'live']);
    });

    it('previews before the session connects and publishes once it does', async () => {
      const { session, publisher, cameras } = setup();
      await publisher.publishCamera('camera', PHONE);
      expect(publisher.slotState('camera')).toBe('starting');
      const preview = publisher.localPreview('camera') as unknown as FakeMediaStream;
      expect(preview.track).toBe(cameras[0].mediaStreamTrack);
      expect(publisher.localPreview('camera')).toBe(preview);

      const room = session.connect();
      await flushMicrotasks();
      expect(room.localParticipant.publishTrack).toHaveBeenCalledTimes(1);
      expect(publisher.slotState('camera')).toBe('live');
    });

    it('rejects invalid arguments', async () => {
      const { publisher } = setup();
      await expect(publisher.publishCamera('screen-1', PHONE)).rejects.toBeInstanceOf(RangeError);
      await expect(
        publisher.publishCamera('camera', {
          facingMode: 'left',
          resolution: 720,
        } as unknown as typeof PHONE),
      ).rejects.toBeInstanceOf(RangeError);
      await expect(publisher.publishScreen('camera')).rejects.toBeInstanceOf(RangeError);
      await expect(publisher.setCameraResolution(480 as 720)).rejects.toBeInstanceOf(RangeError);
    });

    it('fails at once when camera access is denied', async () => {
      const { publisher, createCameraTrack, states } = setup();
      createCameraTrack.mockRejectedValue(domError('NotAllowedError'));
      await publisher.publishCamera('camera', PHONE);
      expect(createCameraTrack).toHaveBeenCalledTimes(1);
      expect(publisher.slotState('camera')).toBe('failed');
      expect(states.at(-1)).toEqual(['camera', 'failed', 'media.slot.failure.permission-denied']);
    });

    it('retries a busy camera three times with backoff, then fails', async () => {
      const { publisher, createCameraTrack, states } = setup();
      createCameraTrack.mockRejectedValue(domError('NotReadableError'));
      const done = publisher.publishCamera('camera', PHONE);
      await flushMicrotasks();
      expect(createCameraTrack).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(299);
      expect(createCameraTrack).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(createCameraTrack).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(600);
      expect(createCameraTrack).toHaveBeenCalledTimes(3);
      await vi.advanceTimersByTimeAsync(1200);
      await done;
      expect(createCameraTrack).toHaveBeenCalledTimes(4);
      expect(states.at(-1)).toEqual(['camera', 'failed', 'media.slot.failure.in-use']);
    });

    it('recovers when a retry succeeds', async () => {
      const { session, publisher, createCameraTrack } = setup();
      session.connect();
      createCameraTrack.mockRejectedValueOnce(domError('NotReadableError'));
      const done = publisher.publishCamera('camera', PHONE);
      await vi.advanceTimersByTimeAsync(300);
      await done;
      expect(publisher.slotState('camera')).toBe('live');
    });

    it('leaves an ended camera to the SDK restart when it works', async () => {
      const { session, publisher, cameras, states } = setup();
      session.connect();
      await publisher.publishCamera('camera', PHONE);
      const camera = cameras[0];
      camera.endFromDevice();
      camera.emit(TrackEvent.Restarted, camera);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(camera.restartTrack).not.toHaveBeenCalled();
      expect(stateSequence(states, 'camera')).toEqual(['starting', 'live']);
    });

    it('re-acquires a camera the SDK could not restart, then fails after three attempts', async () => {
      const { session, publisher, cameras, states } = setup();
      session.connect();
      await publisher.publishCamera('camera', PHONE);
      const camera = cameras[0];
      camera.restartError = domError('NotReadableError');
      camera.endFromDevice();
      await vi.advanceTimersByTimeAsync(2999);
      expect(publisher.slotState('camera')).toBe('live');
      await vi.advanceTimersByTimeAsync(1);
      expect(publisher.slotState('camera')).toBe('starting');
      await vi.advanceTimersByTimeAsync(300 + 600 + 1200);
      expect(camera.restartTrack).toHaveBeenCalledTimes(3);
      expect(publisher.slotState('camera')).toBe('failed');
      expect(states.at(-1)?.[2]).toBe('media.slot.failure.track-lost');
      expect(camera.stop).toHaveBeenCalled();
    });

    it('recovers an ended camera on the second attempt', async () => {
      const { session, publisher, cameras } = setup();
      const room = session.connect();
      await publisher.publishCamera('camera', PHONE);
      const camera = cameras[0];
      camera.restartTrack.mockRejectedValueOnce(domError('NotReadableError'));
      camera.endFromDevice();
      await vi.advanceTimersByTimeAsync(3000 + 300 + 600);
      expect(camera.restartTrack).toHaveBeenCalledTimes(2);
      expect(publisher.slotState('camera')).toBe('live');
      expect(camera.mediaStreamTrack.contentHint).toBe('motion');
      expect(room.localParticipant.publishTrack).toHaveBeenCalledTimes(1);
    });

    it('unmutes a camera the SDK muted after a failed restart', async () => {
      const { session, publisher, cameras } = setup();
      session.connect();
      await publisher.publishCamera('camera', PHONE);
      cameras[0].muteBySdk();
      await vi.advanceTimersByTimeAsync(300);
      expect(cameras[0].unmute).toHaveBeenCalledTimes(1);
      expect(publisher.slotState('camera')).toBe('live');
    });

    it('re-acquires on a media devices error of the room', async () => {
      const { session, publisher, cameras } = setup();
      const room = session.connect();
      await publisher.publishCamera('camera', PHONE);
      room.emit(RoomEvent.MediaDevicesError, new Error('device lost'), 'audioinput');
      await vi.advanceTimersByTimeAsync(1000);
      expect(cameras[0].restartTrack).not.toHaveBeenCalled();
      room.emit(RoomEvent.MediaDevicesError, new Error('device lost'), 'videoinput');
      room.emit(RoomEvent.MediaDevicesError, new Error('device lost'));
      await vi.advanceTimersByTimeAsync(300);
      expect(cameras[0].restartTrack).toHaveBeenCalledTimes(1);
      expect(publisher.slotState('camera')).toBe('live');
    });

    it('reports paused while the SDK pauses the upstream', async () => {
      const { session, publisher, cameras } = setup();
      session.connect();
      await publisher.publishCamera('camera', PHONE);
      cameras[0].emit(TrackEvent.UpstreamPaused, cameras[0]);
      expect(publisher.slotState('camera')).toBe('paused');
      cameras[0].emit(TrackEvent.UpstreamResumed, cameras[0]);
      expect(publisher.slotState('camera')).toBe('live');
    });

    it('switches between front and back camera in place', async () => {
      const { session, publisher, cameras, states } = setup();
      const room = session.connect();
      await publisher.publishCamera('camera', PHONE);
      const before = publisher.localPreview('camera');
      states.length = 0;
      await publisher.switchCamera();
      expect(cameras[0].restartTrack).toHaveBeenLastCalledWith({
        facingMode: 'environment',
        resolution: VideoPresets.h720.resolution,
      });
      await publisher.switchCamera();
      expect(cameras[0].restartTrack).toHaveBeenLastCalledWith(
        expect.objectContaining({ facingMode: 'user' }),
      );
      expect(room.localParticipant.publishTrack).toHaveBeenCalledTimes(1);
      expect(publisher.slotState('camera')).toBe('live');
      expect(states.length).toBeGreaterThan(0);
      expect(publisher.localPreview('camera')).not.toBe(before);
    });

    it('coalesces rapid switches into the final facing mode', async () => {
      const { session, publisher, cameras } = setup();
      session.connect();
      await publisher.publishCamera('camera', PHONE);
      await Promise.all([
        publisher.switchCamera(),
        publisher.switchCamera(),
        publisher.switchCamera(),
      ]);
      expect(cameras[0].restartTrack.mock.calls.map(([options]) => options?.facingMode)).toEqual([
        'environment',
      ]);
      await Promise.all([publisher.switchCamera(), publisher.switchCamera()]);
      expect(cameras[0].restartTrack).toHaveBeenCalledTimes(1);
    });

    it('keeps the old camera and reports a failed switch', async () => {
      const { session, publisher, cameras, states } = setup();
      session.connect();
      await publisher.publishCamera('camera', PHONE);
      cameras[0].restartTrack.mockRejectedValueOnce(domError('OverconstrainedError'));
      await publisher.switchCamera();
      expect(states.at(-1)).toEqual(['camera', 'live', 'media.slot.cameraSwitchFailed']);
      await publisher.switchCamera();
      expect(cameras[0].restartTrack).toHaveBeenLastCalledWith(
        expect.objectContaining({ facingMode: 'environment' }),
      );
    });

    it('applies a switch requested while the camera was still starting', async () => {
      let resolveCamera: (track: LocalVideoTrack) => void = () => undefined;
      const { session, publisher, createCameraTrack } = setup();
      session.connect();
      const first = new FakeLocalVideoTrack();
      createCameraTrack.mockImplementationOnce(
        () => new Promise((resolve) => (resolveCamera = resolve)),
      );
      const starting = publisher.publishCamera('camera', PHONE);
      await flushMicrotasks();
      const switching = publisher.switchCamera();
      resolveCamera(asLocalVideoTrack(first));
      await Promise.all([starting, switching]);
      expect(createCameraTrack).toHaveBeenCalledWith(
        expect.objectContaining({ facingMode: 'user' }),
      );
      expect(first.restartTrack).toHaveBeenCalledWith(
        expect.objectContaining({ facingMode: 'environment' }),
      );
    });

    it('stays starting when a camera recovers while the session is not connected', async () => {
      const { session, publisher, cameras } = setup();
      session.connect();
      await publisher.publishCamera('camera', PHONE);
      session.lose();
      cameras[0].muteBySdk();
      await vi.advanceTimersByTimeAsync(300);
      expect(cameras[0].unmute).toHaveBeenCalled();
      expect(publisher.slotState('camera')).toBe('starting');
      const next = session.connect(new FakeRoom());
      await flushMicrotasks();
      expect(next.localParticipant.published.get('camera')).toBe(cameras[0]);
      expect(publisher.slotState('camera')).toBe('live');
    });

    it('stays starting when a never-published camera recovers before the first connect', async () => {
      const { session, publisher, cameras } = setup();
      await publisher.publishCamera('camera', PHONE);
      cameras[0].muteBySdk();
      await vi.advanceTimersByTimeAsync(300);
      expect(cameras[0].unmute).toHaveBeenCalled();
      expect(publisher.slotState('camera')).toBe('starting');
      session.connect();
      await flushMicrotasks();
      expect(publisher.slotState('camera')).toBe('live');
    });

    it('changes the resolution in place', async () => {
      const { session, publisher, cameras } = setup();
      session.connect();
      await publisher.publishCamera('camera', PHONE);
      await publisher.setCameraResolution(1080);
      expect(cameras[0].restartTrack).toHaveBeenLastCalledWith({
        facingMode: 'user',
        resolution: VideoPresets.h1080.resolution,
      });
      await publisher.publishCamera('camera', { facingMode: 'user', resolution: 1080 });
      expect(cameras[0].restartTrack).toHaveBeenCalledTimes(1);
    });

    it('ignores switches without a camera', async () => {
      const { publisher } = setup();
      await expect(publisher.switchCamera()).resolves.toBeUndefined();
      await expect(publisher.setCameraResolution(1080)).resolves.toBeUndefined();
    });
  });

  describe('screens', () => {
    it('calls getDisplayMedia synchronously inside the gesture and publishes the share', async () => {
      const { session, publisher, screens, createScreenTrack } = setup();
      const room = session.connect();
      const done = publisher.publishScreen('screen-1');
      expect(createScreenTrack).toHaveBeenCalledTimes(1);
      expect(createScreenTrack).toHaveBeenCalledWith(
        expect.objectContaining({
          audio: false,
          contentHint: 'detail',
          selfBrowserSurface: 'exclude',
        }),
      );
      expect(publisher.slotState('screen-1')).toBe('starting');
      await done;
      expect(screens[0].mediaStreamTrack.contentHint).toBe('detail');
      expect(room.localParticipant.publishTrack).toHaveBeenCalledWith(
        screens[0],
        expect.objectContaining({
          name: 'screen-1',
          source: Track.Source.ScreenShare,
          videoCodec: 'vp9',
          simulcast: false,
        }),
      );
      expect(publisher.slotState('screen-1')).toBe('live');
    });

    it('starts several screens independently and ignores a second click on a running one', async () => {
      const { session, publisher, createScreenTrack } = setup();
      session.connect();
      await Promise.all([publisher.publishScreen('screen-1'), publisher.publishScreen('screen-2')]);
      await publisher.publishScreen('screen-1');
      expect(createScreenTrack).toHaveBeenCalledTimes(2);
      expect(publisher.slotState('screen-2')).toBe('live');
    });

    it('returns to idle when the user cancels the picker', async () => {
      const { publisher, createScreenTrack, states } = setup();
      createScreenTrack.mockRejectedValueOnce(domError('NotAllowedError'));
      await publisher.publishScreen('screen-1');
      expect(publisher.slotState('screen-1')).toBe('idle');
      expect(states.at(-1)).toEqual(['screen-1', 'idle', 'media.slot.failure.cancelled']);
      expect(await publisher.getSlotTelemetry()).toEqual([]);
    });

    it('returns to ended when a reshare is cancelled', async () => {
      const { session, publisher, screens, createScreenTrack } = setup();
      session.connect();
      await publisher.publishScreen('screen-1');
      screens[0].endFromDevice();
      await flushMicrotasks();
      createScreenTrack.mockRejectedValueOnce(domError('NotAllowedError'));
      await publisher.publishScreen('screen-1');
      expect(publisher.slotState('screen-1')).toBe('ended');
    });

    it.each([
      ['DeviceUnsupportedError', 'media.slot.failure.not-supported'],
      ['InvalidStateError', 'media.slot.failure.needs-gesture'],
      ['NotReadableError', 'media.slot.failure.unknown'],
    ])('fails with a message on %s', async (name, message) => {
      const { publisher, createScreenTrack, states } = setup();
      createScreenTrack.mockRejectedValueOnce(Object.assign(new Error(name), { name }));
      await publisher.publishScreen('screen-1');
      expect(states.at(-1)).toEqual(['screen-1', 'failed', message]);
    });

    it('turns a synchronous throw of the capture into a failed slot', async () => {
      const { publisher, createScreenTrack } = setup();
      createScreenTrack.mockImplementationOnce(() => {
        throw new TypeError("Cannot read properties of undefined (reading 'getDisplayMedia')");
      });
      await publisher.publishScreen('screen-1');
      expect(publisher.slotState('screen-1')).toBe('failed');
    });

    it('ends (and never restarts) when the user stops sharing', async () => {
      const { session, publisher, screens, createScreenTrack, states } = setup();
      const room = session.connect();
      await publisher.publishScreen('screen-1');
      screens[0].endFromDevice();
      await flushMicrotasks();
      expect(states.at(-1)).toEqual(['screen-1', 'ended', 'media.slot.shareEnded']);
      expect(room.localParticipant.unpublishTrack).toHaveBeenCalledWith(screens[0], false);
      expect(screens[0].stop).toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(60_000);
      session.lose();
      session.connect();
      await flushMicrotasks();
      expect(createScreenTrack).toHaveBeenCalledTimes(1);
      expect(publisher.slotState('screen-1')).toBe('ended');
    });
  });

  describe('rejoin', () => {
    it('republishes the same live tracks into the new room', async () => {
      const { session, publisher, cameras, screens, createCameraTrack } = setup();
      session.connect();
      await publisher.publishCamera('camera', PHONE);
      await publisher.publishScreen('screen-1');
      session.lose();
      const next = session.connect(new FakeRoom());
      await flushMicrotasks();
      expect(next.localParticipant.publishTrack).toHaveBeenCalledTimes(2);
      expect(next.localParticipant.published.get('camera')).toBe(cameras[0]);
      expect(next.localParticipant.published.get('screen-1')).toBe(screens[0]);
      expect(createCameraTrack).toHaveBeenCalledTimes(1);
      expect(publisher.slotState('camera')).toBe('live');
    });

    it('does not republish after an SDK resume in the same room', async () => {
      const { session, publisher } = setup();
      const room = session.connect();
      await publisher.publishCamera('camera', PHONE);
      session.setState('reconnecting');
      session.setState('connected');
      await flushMicrotasks();
      expect(room.localParticipant.publishTrack).toHaveBeenCalledTimes(1);
    });

    it('re-acquires a camera and ends a screen that were stopped behind its back', async () => {
      const { session, publisher, cameras, screens } = setup();
      session.connect();
      await publisher.publishCamera('camera', PHONE);
      await publisher.publishScreen('screen-2');
      (cameras[0].mediaStreamTrack as unknown as FakeMediaStreamTrack).readyState = 'ended';
      (screens[0].mediaStreamTrack as unknown as FakeMediaStreamTrack).readyState = 'ended';
      session.lose();
      const next = session.connect(new FakeRoom());
      await flushMicrotasks();
      expect(cameras).toHaveLength(2);
      expect(next.localParticipant.published.get('camera')).toBe(cameras[1]);
      expect(publisher.slotState('camera')).toBe('live');
      expect(publisher.slotState('screen-2')).toBe('ended');
      expect(next.localParticipant.published.has('screen-2')).toBe(false);
    });

    it('releases devices when the session ends and re-acquires the camera after restart', async () => {
      const { session, publisher, cameras } = setup();
      session.connect();
      await publisher.publishCamera('camera', PHONE);
      await publisher.publishScreen('screen-1');
      session.room = null;
      session.setState('replaced');
      await flushMicrotasks();
      expect(cameras[0].stop).toHaveBeenCalled();
      expect(publisher.slotState('camera')).toBe('paused');
      expect(publisher.slotState('screen-1')).toBe('ended');
      expect(publisher.localPreview('camera')).toBeNull();

      const next = session.connect(new FakeRoom());
      await flushMicrotasks();
      expect(cameras).toHaveLength(2);
      expect(next.localParticipant.published.get('camera')).toBe(cameras[1]);
      expect(publisher.slotState('camera')).toBe('live');
    });

    it('retries a failing publish three times while connected, then fails', async () => {
      const { session, publisher, states } = setup();
      const room = session.connect();
      room.localParticipant.publishError = new Error('publishing rejected');
      const done = publisher.publishCamera('camera', PHONE);
      await vi.advanceTimersByTimeAsync(300 + 600 + 1200);
      await done;
      expect(room.localParticipant.publishTrack).toHaveBeenCalledTimes(4);
      expect(states.at(-1)).toEqual(['camera', 'failed', 'media.slot.failure.publish-failed']);
    });

    it('waits for the next connection when a publish fails because the room went away', async () => {
      const { session, publisher } = setup();
      const room = session.connect();
      room.localParticipant.publishTrack.mockImplementationOnce(async () => {
        session.lose();
        throw new Error('engine not connected');
      });
      await publisher.publishCamera('camera', PHONE);
      expect(publisher.slotState('camera')).toBe('starting');
      const next = session.connect(new FakeRoom());
      await flushMicrotasks();
      expect(next.localParticipant.publishTrack).toHaveBeenCalledTimes(1);
      expect(publisher.slotState('camera')).toBe('live');
    });
  });

  describe('unpublish', () => {
    it('unpublishes, stops and forgets a slot', async () => {
      const { session, publisher, cameras, states } = setup();
      const room = session.connect();
      await publisher.publishCamera('camera', PHONE);
      await publisher.unpublish('camera');
      expect(room.localParticipant.unpublishTrack).toHaveBeenCalledWith(cameras[0], false);
      expect(cameras[0].stop).toHaveBeenCalled();
      expect(publisher.slotState('camera')).toBe('idle');
      expect(states.at(-1)).toEqual(['camera', 'idle']);
      await expect(publisher.unpublish('camera')).resolves.toBeUndefined();
    });

    it('stops a camera that arrives after the slot was unpublished', async () => {
      let resolveCamera: (track: LocalVideoTrack) => void = () => undefined;
      const { session, publisher, createCameraTrack } = setup();
      const room = session.connect();
      createCameraTrack.mockImplementationOnce(
        () => new Promise((resolve) => (resolveCamera = resolve)),
      );
      const done = publisher.publishCamera('camera', PHONE);
      await flushMicrotasks();
      expect(createCameraTrack).toHaveBeenCalledTimes(1);
      await publisher.unpublish('camera');
      const late = new FakeLocalVideoTrack();
      resolveCamera(asLocalVideoTrack(late));
      await done;
      expect(late.stop).toHaveBeenCalled();
      expect(room.localParticipant.publishTrack).not.toHaveBeenCalled();
      expect(publisher.slotState('camera')).toBe('idle');
    });

    it('cancels a pending camera retry', async () => {
      const { publisher, createCameraTrack } = setup();
      createCameraTrack.mockRejectedValue(domError('NotReadableError'));
      const done = publisher.publishCamera('camera', PHONE);
      await flushMicrotasks();
      await publisher.unpublish('camera');
      await vi.advanceTimersByTimeAsync(10_000);
      await done;
      expect(createCameraTrack).toHaveBeenCalledTimes(1);
      expect(publisher.slotState('camera')).toBe('idle');
    });

    it('stops everything with stopAll', async () => {
      const { session, publisher, cameras, screens } = setup();
      session.connect();
      await publisher.publishCamera('camera', PHONE);
      await publisher.publishScreen('screen-1');
      await publisher.stopAll();
      expect(cameras[0].stop).toHaveBeenCalled();
      expect(screens[0].stop).toHaveBeenCalled();
      expect(await publisher.getSlotTelemetry()).toEqual([]);
    });
  });

  describe('telemetry', () => {
    it('reports every slot, camera first, with sender stats of published tracks', async () => {
      const { session, publisher, cameras, screens } = setup();
      session.connect();
      await publisher.publishScreen('screen-2');
      await publisher.publishCamera('camera', PHONE);
      cameras[0].currentBitrate = 1_234_567;
      cameras[0].senderStats = [
        {
          type: 'video',
          rid: 'f',
          frameWidth: 1280,
          frameHeight: 720,
          framesPerSecond: 30,
          framesSent: 1,
          firCount: 0,
          pliCount: 0,
          nackCount: 0,
          targetBitrate: 0,
          timestamp: 0,
          packetsSent: 1000,
          packetsLost: 10,
        },
      ];
      screens[0].getSenderStats.mockRejectedValue(new Error('closed'));
      (screens[0].mediaStreamTrack as unknown as FakeMediaStreamTrack).settings = {
        width: 1920,
        height: 1080,
        frameRate: 15,
      };
      expect(await publisher.getSlotTelemetry()).toEqual([
        {
          slot: 'camera',
          state: 'live',
          width: 1280,
          height: 720,
          fps: 30,
          bitrateKbps: 1235,
          packetLossPct: 1,
          codec: 'h264',
        },
        {
          slot: 'screen-2',
          state: 'live',
          width: 1920,
          height: 1080,
          fps: 15,
          bitrateKbps: 0,
          packetLossPct: null,
          codec: 'vp9',
        },
      ]);
    });

    it('reports failed and ended slots without numbers', async () => {
      const { publisher, createCameraTrack } = setup();
      createCameraTrack.mockRejectedValue(domError('NotFoundError'));
      await publisher.publishCamera('camera', PHONE);
      expect(await publisher.getSlotTelemetry()).toEqual([
        {
          slot: 'camera',
          state: 'failed',
          width: null,
          height: null,
          fps: null,
          bitrateKbps: null,
          packetLossPct: null,
          codec: null,
        },
      ]);
    });
  });

  describe('failure codes', () => {
    function failures(publisher: Publisher): [string, LocalSlotState, string?, SlotFailure?][] {
      const seen: [string, LocalSlotState, string?, SlotFailure?][] = [];
      publisher.onSlotState((...args) => seen.push(args));
      return seen;
    }

    it.each([
      ['NotAllowedError', 'permission-denied'],
      ['SecurityError', 'permission-denied'],
      ['NotFoundError', 'not-found'],
      ['OverconstrainedError', 'not-found'],
    ] as const)('reports a camera %s as %s next to its message key', async (name, failure) => {
      const { publisher, createCameraTrack } = setup();
      const seen = failures(publisher);
      createCameraTrack.mockRejectedValue(domError(name));
      await publisher.publishCamera('camera', PHONE);
      expect(seen.at(-1)).toEqual(['camera', 'failed', expect.any(String), failure]);
    });

    it('reports a busy camera as in-use after the retries', async () => {
      const { publisher, createCameraTrack } = setup();
      const seen = failures(publisher);
      createCameraTrack.mockRejectedValue(domError('NotReadableError'));
      const done = publisher.publishCamera('camera', PHONE);
      await vi.advanceTimersByTimeAsync(300 + 600 + 1200);
      await done;
      expect(seen.at(-1)?.[3]).toBe('in-use');
    });

    it('reports a camera that could not be re-acquired as track-lost', async () => {
      const { session, publisher, cameras } = setup();
      const seen = failures(publisher);
      session.connect();
      await publisher.publishCamera('camera', PHONE);
      cameras[0].restartError = domError('NotReadableError');
      cameras[0].endFromDevice();
      await vi.advanceTimersByTimeAsync(3000 + 300 + 600 + 1200);
      expect(seen.at(-1)).toEqual([
        'camera',
        'failed',
        'media.slot.failure.track-lost',
        'track-lost',
      ]);
    });

    it.each([
      ['DeviceUnsupportedError', 'not-supported'],
      ['TypeError', 'not-supported'],
      ['InvalidStateError', 'needs-gesture'],
      ['NotReadableError', 'unknown'],
    ] as const)('reports a screen capture %s as %s', async (name, failure) => {
      const { publisher, createScreenTrack } = setup();
      const seen = failures(publisher);
      createScreenTrack.mockRejectedValueOnce(Object.assign(new Error(name), { name }));
      await publisher.publishScreen('screen-1');
      expect(seen.at(-1)).toEqual(['screen-1', 'failed', expect.any(String), failure]);
    });

    it('reports a cancelled picker as cancelled and an ended share without a failure', async () => {
      const { session, publisher, screens, createScreenTrack } = setup();
      const seen = failures(publisher);
      createScreenTrack.mockRejectedValueOnce(domError('NotAllowedError'));
      await publisher.publishScreen('screen-1');
      expect(seen.at(-1)).toEqual([
        'screen-1',
        'idle',
        'media.slot.failure.cancelled',
        'cancelled',
      ]);

      session.connect();
      await publisher.publishScreen('screen-1');
      screens[0].endFromDevice();
      await flushMicrotasks();
      expect(seen.at(-1)).toEqual(['screen-1', 'ended', 'media.slot.shareEnded']);
    });

    it('drops the failure code once the slot starts again', async () => {
      const { session, publisher, createCameraTrack } = setup();
      const seen = failures(publisher);
      session.connect();
      createCameraTrack.mockRejectedValueOnce(domError('NotAllowedError'));
      await publisher.publishCamera('camera', PHONE);
      await publisher.publishCamera('camera', PHONE);
      expect(seen.at(-1)).toEqual(['camera', 'live']);
    });
  });

  describe('robustness', () => {
    it('isolates a throwing slot listener', async () => {
      const { session, publisher } = setup();
      publisher.onSlotState(() => {
        throw new Error('ui bug');
      });
      session.connect();
      await publisher.publishCamera('camera', PHONE);
      expect(publisher.slotState('camera')).toBe('live');
    });

    it('releases devices and listeners on dispose', async () => {
      const { session, publisher, cameras, states } = setup();
      const room = session.connect();
      await publisher.publishCamera('camera', PHONE);
      const count = states.length;
      publisher.dispose();
      publisher.dispose();
      await flushMicrotasks();
      expect(cameras[0].stop).toHaveBeenCalled();
      expect(cameras[0].listenerCount()).toBe(0);
      expect(session.listenerCount).toBe(0);
      expect(room.listenerCount()).toBe(0);
      expect(states).toHaveLength(count);
      await expect(publisher.publishCamera('camera', PHONE)).resolves.toBeUndefined();
      await expect(publisher.publishScreen('screen-1')).resolves.toBeUndefined();
      expect(cameras).toHaveLength(1);
    });

    it('cancels pending retries on dispose', async () => {
      const { publisher, createCameraTrack } = setup();
      createCameraTrack.mockRejectedValue(domError('NotReadableError'));
      const done = publisher.publishCamera('camera', PHONE);
      await flushMicrotasks();
      publisher.dispose();
      await done;
      expect(vi.getTimerCount()).toBe(0);
    });
  });
});
