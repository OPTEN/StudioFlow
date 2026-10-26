import {
  AudioPresets,
  Track,
  type AudioCaptureOptions,
  type LocalAudioTrack,
} from 'livekit-client';
import type { Mock } from 'vitest';
import { AudioPublisher, type AudioPublisherOptions } from './audio-publisher';
import { silentLogger } from './logger';
import type { LocalSlotState } from './publisher';
import type { MicSettings } from './publish-options';
import {
  FakeLocalAudioTrack,
  FakeMediaStream,
  FakeRoom,
  asLocalAudioTrack,
  fakeCreateStream,
  flushMicrotasks,
} from './testing/fake-livekit';
import { FakeSession } from './testing/fake-session';
import { TrackEvent } from 'livekit-client';

const VOICE: MicSettings = { profile: 'voice' };
const STATION: MicSettings = { profile: 'station', deviceId: 'usb-interface' };

interface Harness {
  readonly session: FakeSession;
  readonly publisher: AudioPublisher;
  readonly tracks: FakeLocalAudioTrack[];
  readonly createMicTrack: Mock<(options: AudioCaptureOptions) => Promise<LocalAudioTrack>>;
  readonly states: [LocalSlotState, string?][];
  /** Plugs or unplugs a device: the browser fires `devicechange`. */
  readonly changeDevices: () => void;
  readonly inputs: { value: MediaDeviceInfo[] };
}

function setup(options: Partial<AudioPublisherOptions> = {}): Harness {
  const session = new FakeSession();
  const tracks: FakeLocalAudioTrack[] = [];
  const deviceListeners = new Set<() => void>();
  const inputs = { value: [] as MediaDeviceInfo[] };
  const createMicTrack = vi.fn(async (_options: AudioCaptureOptions) => {
    const track = new FakeLocalAudioTrack();
    tracks.push(track);
    return asLocalAudioTrack(track);
  });
  const publisher = new AudioPublisher(session, {
    createMicTrack,
    createStream: fakeCreateStream,
    logger: silentLogger,
    random: () => 0,
    listDevices: () => Promise.resolve(inputs.value),
    onDeviceChange: (listener) => {
      deviceListeners.add(listener);
      return () => deviceListeners.delete(listener);
    },
    ...options,
  });
  const states: [LocalSlotState, string?][] = [];
  publisher.onSlotState((slot, state, message) => {
    expect(slot).toBe('mic');
    states.push(message === undefined ? [state] : [state, message]);
  });
  return {
    session,
    publisher,
    tracks,
    createMicTrack,
    states,
    changeDevices: () => deviceListeners.forEach((listener) => listener()),
    inputs,
  };
}

function sequence(states: Harness['states']): LocalSlotState[] {
  return states.map(([state]) => state).filter((state, index, all) => state !== all[index - 1]);
}

function domError(name: string): DOMException {
  return new DOMException(name, name);
}

describe('AudioPublisher', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('publishing', () => {
    it('captures a person’s microphone with the browser processing on and publishes it as mono Opus with RED', async () => {
      const { session, publisher, createMicTrack, tracks, states } = setup();
      const room = session.connect();
      await publisher.publishMic(VOICE);

      expect(createMicTrack).toHaveBeenCalledWith({
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      });
      expect(room.localParticipant.publishTrack).toHaveBeenCalledWith(
        tracks[0],
        expect.objectContaining({
          name: 'mic',
          source: Track.Source.Microphone,
          audioPreset: AudioPresets.music,
          dtx: false,
          red: true,
          forceStereo: false,
        }),
      );
      expect(publisher.slotState()).toBe('live');
      expect(sequence(states)).toEqual(['starting', 'live']);
    });

    it('captures the mixing desk feed untouched, in stereo, and publishes it with a high bitrate', async () => {
      const { session, publisher, createMicTrack, tracks } = setup();
      const room = session.connect();
      await publisher.publishMic(STATION);

      expect(createMicTrack).toHaveBeenCalledWith({
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 2,
        deviceId: { exact: 'usb-interface' },
      });
      expect(room.localParticipant.publishTrack).toHaveBeenCalledWith(
        tracks[0],
        expect.objectContaining({
          name: 'mic',
          audioPreset: AudioPresets.musicHighQualityStereo,
          dtx: false,
          red: true,
          forceStereo: true,
        }),
      );
      expect(publisher.settings()).toEqual(STATION);
    });

    it('captures before the session connects and publishes once it does', async () => {
      const { session, publisher, tracks } = setup();
      await publisher.publishMic(VOICE);
      expect(publisher.slotState()).toBe('starting');
      const stream = publisher.localStream() as unknown as FakeMediaStream;
      expect(stream.track).toBe(tracks[0].mediaStreamTrack);
      expect(publisher.localStream()).toBe(stream);

      const room = session.connect();
      await flushMicrotasks();
      expect(room.localParticipant.publishTrack).toHaveBeenCalledTimes(1);
      expect(publisher.slotState()).toBe('live');
    });

    it('rejects invalid settings and ignores calls after dispose', async () => {
      const { publisher, createMicTrack } = setup();
      await expect(
        publisher.publishMic({ profile: 'loud' } as unknown as MicSettings),
      ).rejects.toBeInstanceOf(RangeError);
      await expect(publisher.publishMic({ profile: 'voice', deviceId: '' })).rejects.toBeInstanceOf(
        RangeError,
      );
      publisher.dispose();
      await publisher.publishMic(VOICE);
      expect(createMicTrack).not.toHaveBeenCalled();
    });

    it('is idle until started and after it was stopped', async () => {
      const { session, publisher, tracks, states } = setup();
      expect(publisher.slotState()).toBe('idle');
      expect(publisher.settings()).toBeNull();
      expect(publisher.localStream()).toBeNull();
      await expect(publisher.getSlotTelemetry()).resolves.toBeNull();

      const room = session.connect();
      await publisher.publishMic(VOICE);
      await publisher.unpublish();

      expect(tracks[0].stop).toHaveBeenCalled();
      expect(room.localParticipant.unpublishTrack).toHaveBeenCalledWith(tracks[0], false);
      expect(publisher.slotState()).toBe('idle');
      expect(sequence(states)).toEqual(['starting', 'live', 'idle']);
      await publisher.unpublish();
    });

    it('stops a microphone whose capture finishes after it was switched off', async () => {
      const { publisher, createMicTrack, tracks } = setup();
      let release!: () => void;
      createMicTrack.mockImplementationOnce(
        () =>
          new Promise<LocalAudioTrack>((resolve) => {
            release = () => {
              const track = new FakeLocalAudioTrack();
              tracks.push(track);
              resolve(asLocalAudioTrack(track));
            };
          }),
      );
      void publisher.publishMic(VOICE);
      await flushMicrotasks();
      await publisher.unpublish();
      release();
      await flushMicrotasks();
      expect(tracks[0].stop).toHaveBeenCalled();
      expect(publisher.slotState()).toBe('idle');
    });
  });

  describe('capture failures', () => {
    it('fails at once when microphone access is denied', async () => {
      const { publisher, createMicTrack, states } = setup();
      createMicTrack.mockRejectedValue(domError('NotAllowedError'));
      await publisher.publishMic(VOICE);
      expect(createMicTrack).toHaveBeenCalledTimes(1);
      expect(publisher.slotState()).toBe('failed');
      expect(states.at(-1)).toEqual(['failed', 'media.slot.mic.permission-denied']);
    });

    it('does not fall back to another input when the chosen one is gone', async () => {
      const { publisher, createMicTrack, states } = setup();
      createMicTrack.mockRejectedValue(domError('OverconstrainedError'));
      await publisher.publishMic(STATION);
      expect(createMicTrack).toHaveBeenCalledTimes(1);
      expect(states.at(-1)).toEqual(['failed', 'media.slot.mic.not-found']);
    });

    it('retries a busy microphone three times with backoff, then fails', async () => {
      const { publisher, createMicTrack, states } = setup();
      createMicTrack.mockRejectedValue(domError('NotReadableError'));
      const done = publisher.publishMic(VOICE);
      await flushMicrotasks();
      expect(createMicTrack).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(300);
      expect(createMicTrack).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(600);
      expect(createMicTrack).toHaveBeenCalledTimes(3);
      await vi.advanceTimersByTimeAsync(1200);
      expect(createMicTrack).toHaveBeenCalledTimes(4);
      await done;
      expect(states.at(-1)).toEqual(['failed', 'media.slot.mic.in-use']);
    });

    it('starts over after a failure when asked again', async () => {
      const { publisher, createMicTrack } = setup();
      createMicTrack.mockRejectedValueOnce(domError('NotAllowedError'));
      await publisher.publishMic(VOICE);
      expect(publisher.slotState()).toBe('failed');
      await publisher.publishMic(VOICE);
      expect(publisher.slotState()).toBe('starting');
    });

    it('fails when the sound cannot be sent after three retries', async () => {
      const { session, publisher, states } = setup();
      const room = session.connect();
      room.localParticipant.publishError = new Error('publish refused');
      const done = publisher.publishMic(VOICE);
      await vi.advanceTimersByTimeAsync(5000);
      await done;
      expect(states.at(-1)).toEqual(['failed', 'media.slot.mic.publish-failed']);
    });
  });

  describe('changing the input', () => {
    it('switches another input in place, without a gap in the room', async () => {
      const { session, publisher, tracks, createMicTrack } = setup();
      const room = session.connect();
      await publisher.publishMic(VOICE);
      await publisher.publishMic({ profile: 'voice', deviceId: 'headset' });

      expect(createMicTrack).toHaveBeenCalledTimes(1);
      expect(tracks[0].restartTrack).toHaveBeenCalledWith(
        expect.objectContaining({ deviceId: { exact: 'headset' } }),
      );
      expect(room.localParticipant.publishTrack).toHaveBeenCalledTimes(1);
      expect(room.localParticipant.unpublishTrack).not.toHaveBeenCalled();
      expect(publisher.slotState()).toBe('live');
      expect(publisher.settings()).toEqual({ profile: 'voice', deviceId: 'headset' });
    });

    it('does nothing when the settings did not change', async () => {
      const { session, publisher, tracks } = setup();
      session.connect();
      await publisher.publishMic(STATION);
      await publisher.publishMic({ ...STATION });
      expect(tracks[0].restartTrack).not.toHaveBeenCalled();
    });

    it('goes back to the earlier input when the new one cannot be opened', async () => {
      const { session, publisher, tracks } = setup();
      session.connect();
      await publisher.publishMic(VOICE);
      tracks[0].restartError = domError('OverconstrainedError');
      await publisher.publishMic({ profile: 'voice', deviceId: 'gone' });
      expect(publisher.settings()).toEqual(VOICE);
      expect(publisher.slotState()).toBe('failed');
    });

    it('starts the capture over when the profile changes', async () => {
      const { session, publisher, tracks, createMicTrack } = setup();
      const room = session.connect();
      await publisher.publishMic(VOICE);
      await publisher.publishMic(STATION);

      expect(createMicTrack).toHaveBeenCalledTimes(2);
      expect(tracks[0].stop).toHaveBeenCalled();
      expect(room.localParticipant.unpublishTrack).toHaveBeenCalledWith(tracks[0], false);
      expect(room.localParticipant.publishTrack).toHaveBeenLastCalledWith(
        tracks[1],
        expect.objectContaining({ forceStereo: true }),
      );
      expect(publisher.slotState()).toBe('live');
    });

    it('lists the audio inputs of the device', async () => {
      const { publisher, inputs } = setup();
      inputs.value = [
        { deviceId: 'default', label: 'Default', kind: 'audioinput' },
        { deviceId: 'cam', label: 'Camera', kind: 'videoinput' },
        { deviceId: '', label: '', kind: 'audioinput' },
        { deviceId: 'usb-interface', label: 'USB Audio Interface', kind: 'audioinput' },
      ] as MediaDeviceInfo[];
      await expect(publisher.listInputs()).resolves.toEqual([
        { id: 'default', label: 'Default' },
        { id: 'usb-interface', label: 'USB Audio Interface' },
      ]);

      const failing = setup({ listDevices: () => Promise.reject(new Error('denied')) });
      await expect(failing.publisher.listInputs()).resolves.toEqual([]);
    });
  });

  describe('a microphone that goes away', () => {
    async function live(options: Partial<AudioPublisherOptions> = {}) {
      const harness = setup(options);
      const room = harness.session.connect();
      await harness.publisher.publishMic(STATION);
      return { ...harness, room, track: harness.tracks[0] };
    }

    it('is ended once the SDK had its grace time, and live again when the device returns', async () => {
      const { publisher, track, changeDevices, states, room } = await live();
      track.endFromDevice();
      await vi.advanceTimersByTimeAsync(1999);
      expect(publisher.slotState()).toBe('live');
      await vi.advanceTimersByTimeAsync(1);
      expect(publisher.slotState()).toBe('ended');
      expect(states.at(-1)).toEqual(['ended', 'media.slot.mic.ended']);

      // The interface is plugged in again: the browser reports a changed device list.
      track.restartError = domError('NotFoundError');
      changeDevices();
      await flushMicrotasks();
      expect(track.restartTrack).toHaveBeenCalledTimes(1);
      expect(publisher.slotState()).toBe('ended');

      track.restartError = null;
      changeDevices();
      await flushMicrotasks();

      expect(track.restartTrack).toHaveBeenLastCalledWith(
        expect.objectContaining({ deviceId: { exact: 'usb-interface' }, channelCount: 2 }),
      );
      expect(publisher.slotState()).toBe('live');
      expect(states.at(-1)).toEqual(['live']);
      expect(room.localParticipant.publishTrack).toHaveBeenCalledTimes(1);
    });

    it('looks for the device every few seconds even if the browser reports nothing', async () => {
      const { publisher, track } = await live({ retryIntervalMs: 3000 });
      track.endFromDevice();
      track.restartError = domError('NotFoundError');
      await vi.advanceTimersByTimeAsync(2000);
      expect(publisher.slotState()).toBe('ended');

      await vi.advanceTimersByTimeAsync(3000);
      expect(track.restartTrack).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(3000);
      expect(track.restartTrack).toHaveBeenCalledTimes(2);

      track.restartError = null;
      await vi.advanceTimersByTimeAsync(3000);
      expect(publisher.slotState()).toBe('live');
      await vi.advanceTimersByTimeAsync(10_000);
      expect(track.restartTrack).toHaveBeenCalledTimes(3);
    });

    it('stays live when the SDK brought the device back within the grace time', async () => {
      const { publisher, track, states } = await live();
      track.endFromDevice();
      await vi.advanceTimersByTimeAsync(500);
      track.fakeMediaTrack.readyState = 'live';
      track.emit(TrackEvent.Restarted, track);
      await vi.advanceTimersByTimeAsync(5000);
      expect(publisher.slotState()).toBe('live');
      expect(sequence(states)).toEqual(['starting', 'live']);
    });

    it('treats a track the SDK muted after a failed restart as lost and unmutes it when the device is back', async () => {
      const { publisher, track, changeDevices } = await live();
      track.fakeMediaTrack.readyState = 'ended';
      track.muteBySdk();
      expect(publisher.slotState()).toBe('ended');
      changeDevices();
      await flushMicrotasks();
      expect(track.unmute).toHaveBeenCalledTimes(1);
      expect(publisher.slotState()).toBe('live');
    });

    it('ends the slot when the browser reports a device error for the microphone', async () => {
      const { publisher, room } = await live();
      room.emit('mediaDevicesError', new Error('gone'), 'audioinput');
      expect(publisher.slotState()).toBe('ended');
    });

    it('stops looking when the microphone is switched off', async () => {
      const { publisher, track } = await live();
      track.endFromDevice();
      await vi.advanceTimersByTimeAsync(2000);
      await publisher.unpublish();
      expect(vi.getTimerCount()).toBe(0);
    });

    it('pauses with the upstream and resumes with it', async () => {
      const { publisher, track } = await live();
      track.emit(TrackEvent.UpstreamPaused, track);
      expect(publisher.slotState()).toBe('paused');
      track.emit(TrackEvent.UpstreamResumed, track);
      expect(publisher.slotState()).toBe('live');
    });
  });

  describe('sessions', () => {
    it('publishes into the new room after a rejoin', async () => {
      const { session, publisher, tracks } = setup();
      session.connect();
      await publisher.publishMic(VOICE);
      session.lose();
      const second = session.connect();
      await flushMicrotasks();

      expect(second.localParticipant.publishTrack).toHaveBeenCalledWith(
        tracks[0],
        expect.objectContaining({ name: 'mic' }),
      );
      expect(publisher.slotState()).toBe('live');
    });

    it('frees the device when the session ends for good and takes it again when it connects', async () => {
      const { session, publisher, tracks, createMicTrack } = setup();
      session.connect();
      await publisher.publishMic(VOICE);
      session.setState('replaced');
      await flushMicrotasks();

      expect(tracks[0].stop).toHaveBeenCalled();
      expect(publisher.slotState()).toBe('paused');

      session.connect();
      await flushMicrotasks();
      expect(createMicTrack).toHaveBeenCalledTimes(2);
      expect(publisher.slotState()).toBe('live');
    });
  });

  describe('telemetry and level', () => {
    it('reports bitrate, loss and codec of the published microphone', async () => {
      const { session, publisher, tracks } = setup();
      session.connect();
      await publisher.publishMic(STATION);
      tracks[0].currentBitrate = 127_900;
      tracks[0].senderStats = {
        type: 'audio',
        packetsSent: 98,
        packetsLost: 2,
        timestamp: 0,
      };

      await expect(publisher.getSlotTelemetry()).resolves.toEqual({
        slot: 'mic',
        state: 'live',
        width: null,
        height: null,
        fps: null,
        bitrateKbps: 128,
        packetLossPct: 2,
        codec: 'opus',
      });
    });

    it('reports empty numbers before the microphone is published and survives failing stats', async () => {
      const { session, publisher, tracks } = setup();
      await publisher.publishMic(VOICE);
      await expect(publisher.getSlotTelemetry()).resolves.toMatchObject({
        state: 'starting',
        bitrateKbps: null,
        codec: null,
      });
      session.connect();
      await flushMicrotasks();
      tracks[0].getSenderStats.mockRejectedValue(new Error('closed'));
      await expect(publisher.getSlotTelemetry()).resolves.toMatchObject({
        state: 'live',
        packetLossPct: null,
        codec: 'opus',
      });
    });

    it('gives the level meter no stream for a microphone that has ended', async () => {
      const { session, publisher, tracks } = setup();
      session.connect();
      await publisher.publishMic(VOICE);
      expect(publisher.localStream()).not.toBeNull();
      tracks[0].fakeMediaTrack.readyState = 'ended';
      expect(publisher.localStream()).toBeNull();
    });
  });

  describe('dispose', () => {
    it('releases the device and every listener without further states', async () => {
      const { session, publisher, tracks, states, changeDevices } = setup();
      session.connect();
      await publisher.publishMic(VOICE);
      const before = states.length;
      publisher.dispose();
      publisher.dispose();

      expect(tracks[0].stop).toHaveBeenCalled();
      expect(session.listenerCount).toBe(0);
      changeDevices();
      session.lose();
      session.connect(new FakeRoom());
      await flushMicrotasks();
      expect(states).toHaveLength(before);
      expect(vi.getTimerCount()).toBe(0);
    });
  });
});
