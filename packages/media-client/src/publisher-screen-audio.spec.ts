import { AudioPresets, Track, TrackEvent } from 'livekit-client';
import type { ScreenCapture } from './capture';
import { silentLogger } from './logger';
import { Publisher, type LocalSlotState } from './publisher';
import {
  FakeLocalAudioTrack,
  FakeLocalVideoTrack,
  FakeRoom,
  asLocalAudioTrack,
  asLocalVideoTrack,
  fakeCreateStream,
  flushMicrotasks,
} from './testing/fake-livekit';
import { FakeSession } from './testing/fake-session';

/** Screen shares with sound (issue #7): the audio track of getDisplayMedia is published next to the picture. */

interface Harness {
  readonly session: FakeSession;
  readonly publisher: Publisher;
  readonly videos: FakeLocalVideoTrack[];
  readonly sounds: FakeLocalAudioTrack[];
  readonly createScreenTrack: ReturnType<typeof vi.fn>;
  readonly states: [string, LocalSlotState][];
  /** What the next share delivers: with sound unless the user did not tick it. */
  shareSound: boolean;
}

function setup(): Harness {
  const session = new FakeSession();
  const videos: FakeLocalVideoTrack[] = [];
  const sounds: FakeLocalAudioTrack[] = [];
  const harness: Harness = {
    session,
    videos,
    sounds,
    shareSound: true,
    states: [],
    createScreenTrack: vi.fn(),
    publisher: undefined as unknown as Publisher,
  };
  const createScreenTrack = vi.fn(async (): Promise<ScreenCapture> => {
    const video = new FakeLocalVideoTrack();
    videos.push(video);
    if (!harness.shareSound) {
      return { video: asLocalVideoTrack(video), audio: null };
    }
    const sound = new FakeLocalAudioTrack();
    sounds.push(sound);
    return { video: asLocalVideoTrack(video), audio: asLocalAudioTrack(sound) };
  });
  const publisher = new Publisher(session, {
    createScreenTrack,
    createStream: fakeCreateStream,
    logger: silentLogger,
    random: () => 0,
  });
  publisher.onSlotState((slot, state) => harness.states.push([slot, state]));
  return Object.assign(harness, { publisher, createScreenTrack });
}

describe('Publisher screen audio', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('asks the browser for sound without processing only when the share should carry sound', async () => {
    const { session, publisher, createScreenTrack } = setup();
    session.connect();
    await publisher.publishScreen('screen-1', { audio: true });
    await publisher.publishScreen('screen-2');

    expect(createScreenTrack).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        systemAudio: 'include',
      }),
    );
    expect(createScreenTrack).toHaveBeenNthCalledWith(2, expect.objectContaining({ audio: false }));
  });

  it('publishes the sound next to the picture as screen-n-audio', async () => {
    const { session, publisher, videos, sounds } = setup();
    const room = session.connect();
    await publisher.publishScreen('screen-1', { audio: true });

    expect(room.localParticipant.publishTrack).toHaveBeenCalledTimes(2);
    expect(room.localParticipant.publishTrack).toHaveBeenCalledWith(
      videos[0],
      expect.objectContaining({ name: 'screen-1', source: Track.Source.ScreenShare }),
    );
    expect(room.localParticipant.publishTrack).toHaveBeenCalledWith(
      sounds[0],
      expect.objectContaining({
        name: 'screen-1-audio',
        source: Track.Source.ScreenShareAudio,
        audioPreset: AudioPresets.musicHighQualityStereo,
        dtx: false,
        red: true,
        forceStereo: true,
      }),
    );
    expect(publisher.screenHasAudio('screen-1')).toBe(true);
    expect(publisher.slotState('screen-1')).toBe('live');
  });

  it('shares only the picture when the user did not share sound in the browser dialog', async () => {
    const harness = setup();
    harness.shareSound = false;
    const room = harness.session.connect();
    await harness.publisher.publishScreen('screen-1', { audio: true });

    expect(room.localParticipant.publishTrack).toHaveBeenCalledTimes(1);
    expect(harness.publisher.screenHasAudio('screen-1')).toBe(false);
    expect(harness.publisher.slotState('screen-1')).toBe('live');
  });

  it('keeps the picture when only the sound ends, and tells the listeners', async () => {
    const { session, publisher, sounds, states } = setup();
    const room = session.connect();
    await publisher.publishScreen('screen-1', { audio: true });
    const count = states.length;

    sounds[0].endFromDevice();
    await flushMicrotasks();

    expect(room.localParticipant.unpublishTrack).toHaveBeenCalledWith(sounds[0], false);
    expect(sounds[0].stop).toHaveBeenCalled();
    expect(publisher.screenHasAudio('screen-1')).toBe(false);
    expect(publisher.slotState('screen-1')).toBe('live');
    expect(states.length).toBeGreaterThan(count);
    expect(states.at(-1)).toEqual(['screen-1', 'live']);
  });

  it('ends picture and sound together when the share is stopped', async () => {
    const { session, publisher, videos, sounds } = setup();
    const room = session.connect();
    await publisher.publishScreen('screen-1', { audio: true });

    videos[0].endFromDevice();
    await flushMicrotasks();

    expect(publisher.slotState('screen-1')).toBe('ended');
    expect(sounds[0].stop).toHaveBeenCalled();
    expect(room.localParticipant.unpublishTrack).toHaveBeenCalledTimes(2);
    expect(publisher.screenHasAudio('screen-1')).toBe(false);
  });

  it('unpublishes the sound with the share', async () => {
    const { session, publisher, sounds } = setup();
    const room = session.connect();
    await publisher.publishScreen('screen-1', { audio: true });
    await publisher.unpublish('screen-1');

    expect(room.localParticipant.unpublishTrack).toHaveBeenCalledWith(sounds[0], false);
    expect(sounds[0].stop).toHaveBeenCalled();
    expect(sounds[0].listenerCount()).toBe(0);
  });

  it('publishes both into the new room after a rejoin', async () => {
    const { session, publisher, videos, sounds } = setup();
    session.connect();
    await publisher.publishScreen('screen-1', { audio: true });
    session.lose();
    const second = session.connect(new FakeRoom());
    await flushMicrotasks();

    expect(second.localParticipant.publishTrack).toHaveBeenCalledWith(
      videos[0],
      expect.objectContaining({ name: 'screen-1' }),
    );
    expect(second.localParticipant.publishTrack).toHaveBeenCalledWith(
      sounds[0],
      expect.objectContaining({ name: 'screen-1-audio' }),
    );
  });

  it('keeps the picture live when the sound cannot be sent', async () => {
    const { session, publisher, sounds } = setup();
    const room = session.connect();
    room.localParticipant.publishTrack.mockImplementation(async (track) => {
      if ((track as unknown) === sounds[0]) {
        throw new Error('audio refused');
      }
      return {};
    });
    const done = publisher.publishScreen('screen-1', { audio: true });
    await vi.advanceTimersByTimeAsync(5000);
    await done;

    expect(publisher.slotState('screen-1')).toBe('live');
    expect(
      room.localParticipant.publishTrack.mock.calls.filter(([t]) => (t as unknown) === sounds[0]),
    ).toHaveLength(3);
  });

  it('stops a sound whose share was cancelled while the picker was open', async () => {
    const { publisher, sounds } = setup();
    const done = publisher.publishScreen('screen-1', { audio: true });
    await publisher.unpublish('screen-1');
    await done;
    await flushMicrotasks();
    expect(sounds[0].stop).toHaveBeenCalled();
  });

  it('accepts a capture that is only a picture (older callers)', async () => {
    const session = new FakeSession();
    const video = new FakeLocalVideoTrack();
    const publisher = new Publisher(session, {
      createScreenTrack: async () => asLocalVideoTrack(video),
      createStream: fakeCreateStream,
      logger: silentLogger,
    });
    const room = session.connect();
    await publisher.publishScreen('screen-1', { audio: true });
    expect(room.localParticipant.publishTrack).toHaveBeenCalledTimes(1);
    expect(publisher.screenHasAudio('screen-1')).toBe(false);
    video.emit(TrackEvent.Ended, video);
  });
});
