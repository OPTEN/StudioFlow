/**
 * Long-running scenarios across MediaSession, LiveKitSourceProvider and Publisher: many rejoins in a row must neither
 * leak listeners or timers nor duplicate publications.
 */
import { DisconnectReason } from 'livekit-client';
import { silentLogger } from './logger';
import { MediaSession } from './media-session';
import { Publisher } from './publisher';
import { LiveKitSourceProvider } from './source-provider';
import {
  FakeLifecycle,
  FakeLocalVideoTrack,
  FakeRoom,
  asLocalVideoTrack,
  fakeCreateStream,
  fakeToken,
  flushMicrotasks,
} from './testing/fake-livekit';

const CYCLES = 200;
const DEVICE = 'dev_aaaaaaaaaaaaaaaa';

function session(
  role: 'output' | 'sender',
  rooms: FakeRoom[],
  lifecycle = new FakeLifecycle(),
): MediaSession {
  return new MediaSession({
    role,
    tokenProvider: async () => fakeToken(),
    roomFactory: () => {
      const room = new FakeRoom(true);
      rooms.push(room);
      return room;
    },
    logger: silentLogger,
    random: () => 0,
    pageLifecycle: () => lifecycle,
  });
}

const REASONS = [
  undefined,
  DisconnectReason.SIGNAL_CLOSE,
  DisconnectReason.CLIENT_INITIATED,
  DisconnectReason.SERVER_SHUTDOWN,
  DisconnectReason.CONNECTION_TIMEOUT,
];

describe('soak', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it(`output: ${CYCLES} rejoins keep exactly one bound room and live pictures`, async () => {
    const rooms: FakeRoom[] = [];
    const output = session('output', rooms);
    const provider = new LiveKitSourceProvider(output, {
      assetUrl: () => null,
      logger: silentLogger,
      createStream: fakeCreateStream,
    });
    const element = document.createElement('video');
    vi.spyOn(element, 'play').mockResolvedValue(undefined);
    provider.attach(`${DEVICE}/camera`, element);
    provider.setDesiredSize(`${DEVICE}/camera`, 'program', { width: 1920, height: 1080 });
    output.start();

    for (let cycle = 0; cycle < CYCLES; cycle++) {
      await vi.advanceTimersByTimeAsync(1);
      expect(output.state).toBe('connected');
      const room = rooms[cycle];
      const { publication } = room.subscribe(DEVICE, 'camera');
      expect(publication.setVideoDimensions).toHaveBeenCalledWith({ width: 1920, height: 1080 });
      expect(provider.availability(`${DEVICE}/camera`)).toEqual({ state: 'live' });
      room.serverDisconnect(REASONS[cycle % REASONS.length]);
      expect(provider.availability(`${DEVICE}/camera`).state).toBe('lost');
    }

    expect(rooms).toHaveLength(CYCLES);
    expect(rooms.every((room) => room.listenerCount() === 0)).toBe(true);
    expect(output.state).toBe('waiting');
    output.stop();
    provider.dispose();
    expect(rooms.every((room) => room.listenerCount() === 0)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it(`sender: ${CYCLES} rejoins republish each slot exactly once per room`, async () => {
    const rooms: FakeRoom[] = [];
    const sender = session('sender', rooms);
    const camera = new FakeLocalVideoTrack();
    const screen = new FakeLocalVideoTrack();
    const publisher = new Publisher(sender, {
      createCameraTrack: async () => asLocalVideoTrack(camera),
      createScreenTrack: async () => asLocalVideoTrack(screen),
      createStream: fakeCreateStream,
      logger: silentLogger,
      random: () => 0,
    });
    sender.start();
    await vi.advanceTimersByTimeAsync(1);
    await publisher.publishCamera('camera', { facingMode: 'user', resolution: 720 });
    await publisher.publishScreen('screen-1');
    const cameraListeners = camera.listenerCount();

    for (let cycle = 0; cycle < CYCLES; cycle++) {
      const room = rooms[cycle];
      expect(room.localParticipant.publishTrack).toHaveBeenCalledTimes(2);
      room.serverDisconnect(REASONS[cycle % REASONS.length]);
      await vi.advanceTimersByTimeAsync(1);
      await flushMicrotasks();
    }

    expect(rooms[CYCLES].localParticipant.published.get('camera')).toBe(camera);
    expect(rooms[CYCLES].localParticipant.published.get('screen-1')).toBe(screen);
    expect(camera.listenerCount()).toBe(cameraListeners);
    expect(publisher.slotState('camera')).toBe('live');
    expect(publisher.slotState('screen-1')).toBe('live');
    publisher.dispose();
    sender.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a flapping network (online events during every wait) never overlaps attempts', async () => {
    const rooms: FakeRoom[] = [];
    const lifecycle = new FakeLifecycle();
    const flapping = new MediaSession({
      role: 'studio',
      tokenProvider: async () => fakeToken(),
      roomFactory: () => {
        const room = new FakeRoom();
        rooms.push(room);
        return room;
      },
      logger: silentLogger,
      random: () => 0,
      pageLifecycle: () => lifecycle,
    });
    flapping.start();
    for (let cycle = 0; cycle < CYCLES; cycle++) {
      await flushMicrotasks();
      const pending = rooms.filter(
        (room) => room.connectCalls.length > 0 && room.state === 'connecting',
      );
      expect(pending).toHaveLength(1);
      lifecycle.wake();
      pending[0].rejectConnect();
      await flushMicrotasks();
      lifecycle.wake();
      lifecycle.wake();
    }
    await flushMicrotasks();
    expect(rooms).toHaveLength(CYCLES + 1);
    flapping.stop();
    // The cancelled connect clears its timeout timer in the rejection handler.
    await flushMicrotasks();
    expect(vi.getTimerCount()).toBe(0);
  });
});
