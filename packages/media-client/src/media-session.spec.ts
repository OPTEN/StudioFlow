import type { LiveKitTokenDto } from '@studioflow/scene-model';
import { ConnectionState, DisconnectReason, RoomEvent, type RoomOptions } from 'livekit-client';
import type { Mock } from 'vitest';
import { silentLogger } from './logger';
import {
  MediaSession,
  isTerminalState,
  toRtcState,
  type MediaSessionOptions,
  type MediaSessionState,
} from './media-session';
import type { MediaRole } from './room-options';
import { FakeLifecycle, FakeRoom, fakeToken, flushMicrotasks } from './testing/fake-livekit';

interface Harness {
  readonly session: MediaSession;
  readonly rooms: FakeRoom[];
  readonly roomOptions: RoomOptions[];
  readonly lifecycle: FakeLifecycle;
  readonly tokenProvider: Mock<() => Promise<LiveKitTokenDto>>;
  readonly states: MediaSessionState[];
  readonly roomEvents: (FakeRoom | null)[];
}

function setup(role: MediaRole = 'studio', overrides: Partial<MediaSessionOptions> = {}): Harness {
  const rooms: FakeRoom[] = [];
  const roomOptions: RoomOptions[] = [];
  const lifecycle = new FakeLifecycle();
  let tokenCount = 0;
  const tokenProvider = vi.fn(async (): Promise<LiveKitTokenDto> => fakeToken(++tokenCount));
  const session = new MediaSession({
    role,
    tokenProvider,
    roomFactory: (options) => {
      const room = new FakeRoom();
      rooms.push(room);
      roomOptions.push(options);
      return room;
    },
    logger: silentLogger,
    random: () => 0,
    pageLifecycle: () => lifecycle,
    ...overrides,
  });
  const states: MediaSessionState[] = [];
  const roomEvents: (FakeRoom | null)[] = [];
  session.onStateChange((state) => states.push(state));
  session.onRoom((room) => roomEvents.push(room as FakeRoom | null));
  return { session, rooms, roomOptions, lifecycle, tokenProvider, states, roomEvents };
}

/** Starts the session and completes the first connect. */
async function connected(role: MediaRole = 'studio'): Promise<Harness> {
  const harness = setup(role);
  harness.session.start();
  await flushMicrotasks();
  harness.rooms[0].resolveConnect();
  await flushMicrotasks();
  return harness;
}

describe('MediaSession', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('connect', () => {
    it('fetches a token, announces the room before connecting and becomes connected', async () => {
      const { session, rooms, states, roomEvents, tokenProvider } = setup();
      session.start();
      expect(session.state).toBe('connecting');
      await flushMicrotasks();

      expect(tokenProvider).toHaveBeenCalledTimes(1);
      expect(rooms).toHaveLength(1);
      expect(roomEvents).toEqual([rooms[0]]);
      expect(rooms[0].connectCalls).toEqual([
        { url: 'wss://studio.example.test', token: 'token-1', options: { autoSubscribe: true } },
      ]);
      expect(session.room).toBe(rooms[0]);

      rooms[0].resolveConnect();
      await flushMicrotasks();
      expect(session.state).toBe('connected');
      expect(states).toEqual(['connecting', 'connected']);
    });

    it('does not subscribe as sender', async () => {
      const { session, rooms } = setup('sender');
      session.start();
      await flushMicrotasks();
      expect(rooms[0].connectCalls[0].options).toEqual({ autoSubscribe: false });
    });

    it('passes the role options to every room', async () => {
      const { session, roomOptions } = setup('output');
      session.start();
      await flushMicrotasks();
      expect(roomOptions[0]).toMatchObject({
        adaptiveStream: false,
        dynacast: false,
        disconnectOnPageLeave: true,
      });
    });

    it('ignores start() while running and after stop()', async () => {
      const { session, rooms } = setup();
      session.start();
      session.start();
      await flushMicrotasks();
      expect(rooms).toHaveLength(1);
      session.stop();
      session.start();
      await flushMicrotasks();
      expect(rooms).toHaveLength(1);
      expect(session.state).toBe('stopped');
    });

    it('treats a room that died right after connect() resolved as lost', async () => {
      const { session, rooms } = setup();
      session.start();
      await flushMicrotasks();
      rooms[0].resolveConnect();
      rooms[0].serverDisconnect(undefined);
      await flushMicrotasks();
      expect(session.state).toBe('waiting');
      await vi.advanceTimersByTimeAsync(0);
      expect(rooms).toHaveLength(2);
    });
  });

  describe('SDK reconnect', () => {
    it('reports reconnecting while the SDK resumes and keeps the room', async () => {
      const { session, rooms } = await connected();
      rooms[0].setState(ConnectionState.SignalReconnecting, RoomEvent.SignalReconnecting);
      expect(session.state).toBe('reconnecting');
      rooms[0].setState(ConnectionState.Reconnecting, RoomEvent.Reconnecting);
      expect(session.state).toBe('reconnecting');
      rooms[0].setState(ConnectionState.Connected, RoomEvent.Reconnected);
      expect(session.state).toBe('connected');
      expect(rooms).toHaveLength(1);
    });
  });

  describe('rejoin', () => {
    it('joins with a fresh token and a new room after the SDK gave up', async () => {
      const { session, rooms, tokenProvider, roomEvents } = await connected();
      rooms[0].serverDisconnect(undefined);
      expect(session.state).toBe('waiting');
      expect(session.room).toBeNull();
      expect(roomEvents).toEqual([rooms[0], null]);

      await vi.advanceTimersByTimeAsync(0);
      expect(tokenProvider).toHaveBeenCalledTimes(2);
      expect(rooms).toHaveLength(2);
      expect(rooms[1].connectCalls[0].token).toBe('token-2');
      expect(session.state).toBe('reconnecting');

      rooms[1].resolveConnect();
      await flushMicrotasks();
      expect(session.state).toBe('connected');
      expect(session.room).toBe(rooms[1]);
    });

    it.each([
      ['JOIN_FAILURE', DisconnectReason.JOIN_FAILURE],
      ['STATE_MISMATCH', DisconnectReason.STATE_MISMATCH],
      ['SIGNAL_CLOSE', DisconnectReason.SIGNAL_CLOSE],
      ['CONNECTION_TIMEOUT', DisconnectReason.CONNECTION_TIMEOUT],
      ['MEDIA_FAILURE', DisconnectReason.MEDIA_FAILURE],
      ['SERVER_SHUTDOWN', DisconnectReason.SERVER_SHUTDOWN],
      ['UNKNOWN_REASON', DisconnectReason.UNKNOWN_REASON],
      ['CLIENT_INITIATED (page lifecycle, not our stop)', DisconnectReason.CLIENT_INITIATED],
    ])('rejoins after %s', async (_name, reason) => {
      const { session, rooms } = await connected();
      rooms[0].serverDisconnect(reason);
      await vi.advanceTimersByTimeAsync(0);
      expect(rooms).toHaveLength(2);
      expect(session.state).toBe('reconnecting');
    });

    it('backs off 0, 300, 600 … 5000 ms between failed attempts and resets after success', async () => {
      const { session, rooms } = setup();
      session.start();
      await flushMicrotasks();
      const expectedDelays = [0, 300, 600, 1200, 2400, 4800, 5000, 5000];
      for (const [index, delay] of expectedDelays.entries()) {
        rooms[index].rejectConnect();
        await flushMicrotasks();
        expect(session.state).toBe('waiting');
        if (delay > 0) {
          await vi.advanceTimersByTimeAsync(delay - 1);
          expect(rooms).toHaveLength(index + 1);
        }
        await vi.advanceTimersByTimeAsync(1);
        expect(rooms).toHaveLength(index + 2);
      }
      rooms.at(-1)?.resolveConnect();
      await flushMicrotasks();
      expect(session.state).toBe('connected');

      rooms.at(-1)?.serverDisconnect(undefined);
      await vi.advanceTimersByTimeAsync(0);
      expect(rooms).toHaveLength(expectedDelays.length + 2);
    });

    it('cuts the wait short on a wake signal (online, visible, pageshow, resume)', async () => {
      const { session, rooms, lifecycle } = setup();
      session.start();
      await flushMicrotasks();
      for (let index = 0; index < 6; index++) {
        rooms[index].rejectConnect();
        await flushMicrotasks();
        await vi.runOnlyPendingTimersAsync();
      }
      rooms[6].rejectConnect();
      await flushMicrotasks();
      expect(session.state).toBe('waiting');
      lifecycle.wake();
      await flushMicrotasks();
      expect(rooms).toHaveLength(8);
      expect(vi.getTimerCount()).toBe(1);
    });

    it('does not start attempts while the page is suspended and resumes on wake', async () => {
      const { session, rooms, lifecycle } = await connected();
      lifecycle.suspended = true;
      rooms[0].serverDisconnect(DisconnectReason.CLIENT_INITIATED);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(rooms).toHaveLength(1);
      expect(session.state).toBe('waiting');
      lifecycle.wake();
      await flushMicrotasks();
      expect(rooms).toHaveLength(2);
    });

    it('never runs two connect attempts at once', async () => {
      const { session, rooms, lifecycle } = setup();
      session.start();
      await flushMicrotasks();
      lifecycle.wake();
      lifecycle.wake();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(rooms).toHaveLength(1);

      rooms[0].rejectConnect();
      await flushMicrotasks();
      lifecycle.wake();
      lifecycle.wake();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(rooms).toHaveLength(2);
    });

    it('ignores events of a room it already released', async () => {
      const { session, rooms } = await connected();
      rooms[0].serverDisconnect(undefined);
      rooms[0].serverDisconnect(undefined);
      rooms[0].emit(RoomEvent.Reconnected);
      await vi.advanceTimersByTimeAsync(0);
      expect(rooms).toHaveLength(2);
      expect(session.state).toBe('reconnecting');
    });

    it('retries when the token request fails or returns garbage', async () => {
      const tokenProvider = vi
        .fn<() => Promise<LiveKitTokenDto>>()
        .mockRejectedValueOnce(new TypeError('Failed to fetch'))
        .mockResolvedValueOnce({ ...fakeToken(), token: '' })
        .mockResolvedValue(fakeToken(3));
      const { session, rooms } = setup('studio', { tokenProvider });
      session.start();
      await flushMicrotasks();
      expect(session.state).toBe('waiting');
      await vi.advanceTimersByTimeAsync(0);
      expect(session.state).toBe('waiting');
      await vi.advanceTimersByTimeAsync(300);
      expect(rooms).toHaveLength(1);
      expect(rooms[0].connectCalls[0].token).toBe('token-3');
    });

    it('times out a hanging token request', async () => {
      const tokenProvider = vi
        .fn<() => Promise<LiveKitTokenDto>>()
        .mockReturnValueOnce(new Promise(() => undefined))
        .mockResolvedValue(fakeToken(2));
      const { session, rooms } = setup('studio', { tokenProvider });
      session.start();
      await vi.advanceTimersByTimeAsync(14_999);
      expect(session.state).toBe('connecting');
      await vi.advanceTimersByTimeAsync(1);
      expect(session.state).toBe('waiting');
      // A 0 ms timer scheduled inside a fake-timer tick is due 1 ms later.
      await vi.advanceTimersByTimeAsync(1);
      expect(rooms).toHaveLength(1);
    });

    it('times out a hanging connect and disconnects that room', async () => {
      const { session, rooms } = setup();
      session.start();
      await flushMicrotasks();
      await vi.advanceTimersByTimeAsync(45_000);
      expect(rooms[0].disconnectCalls).toEqual([false]);
      expect(session.state).toBe('waiting');
      await vi.advanceTimersByTimeAsync(1);
      expect(rooms).toHaveLength(2);
    });

    it('retries when creating the room throws', async () => {
      let calls = 0;
      const room = new FakeRoom();
      const { session } = setup('studio', {
        roomFactory: () => {
          calls++;
          if (calls === 1) {
            throw new Error('boom');
          }
          return room;
        },
      });
      session.start();
      await flushMicrotasks();
      expect(session.state).toBe('waiting');
      await vi.advanceTimersByTimeAsync(0);
      expect(session.room).toBe(room);
    });
  });

  describe('terminal reasons', () => {
    it.each([
      ['DUPLICATE_IDENTITY', DisconnectReason.DUPLICATE_IDENTITY, 'replaced'],
      ['PARTICIPANT_REMOVED', DisconnectReason.PARTICIPANT_REMOVED, 'removed'],
      ['ROOM_DELETED', DisconnectReason.ROOM_DELETED, 'removed'],
    ] as const)('%s → %s without reconnect', async (_name, reason, state) => {
      const { session, rooms, lifecycle } = await connected();
      rooms[0].serverDisconnect(reason);
      expect(session.state).toBe(state);
      expect(session.room).toBeNull();
      expect(lifecycle.disposed).toBe(true);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(rooms).toHaveLength(1);
    });

    it.each([401, 403])(
      'stops as unauthorized when the token endpoint answers %i',
      async (status) => {
        const tokenProvider = vi.fn(async () => {
          throw Object.assign(new Error('Forbidden'), { status });
        });
        const { session, rooms } = setup('studio', { tokenProvider });
        session.start();
        await flushMicrotasks();
        expect(session.state).toBe('unauthorized');
        await vi.advanceTimersByTimeAsync(60_000);
        expect(tokenProvider).toHaveBeenCalledTimes(1);
        expect(rooms).toHaveLength(0);
      },
    );

    it('becomes unauthorized on a rejoin token refusal', async () => {
      const { session, rooms, tokenProvider } = await connected();
      tokenProvider.mockRejectedValueOnce({ status: 403 });
      rooms[0].serverDisconnect(undefined);
      await vi.advanceTimersByTimeAsync(0);
      expect(session.state).toBe('unauthorized');
    });

    it('restart() leaves a terminal state and connects again', async () => {
      const { session, rooms } = await connected();
      rooms[0].serverDisconnect(DisconnectReason.DUPLICATE_IDENTITY);
      session.restart();
      expect(session.state).toBe('connecting');
      await flushMicrotasks();
      rooms[1].resolveConnect();
      await flushMicrotasks();
      expect(session.state).toBe('connected');
    });

    it('stop() keeps an earlier terminal reason', async () => {
      const { session, rooms } = await connected();
      rooms[0].serverDisconnect(DisconnectReason.DUPLICATE_IDENTITY);
      session.stop();
      expect(session.state).toBe('replaced');
    });
  });

  describe('stop', () => {
    it('disconnects without reconnecting (our own CLIENT_INITIATED is ignored)', async () => {
      const { session, rooms, roomEvents } = await connected();
      session.stop();
      expect(session.state).toBe('stopped');
      expect(rooms[0].disconnectCalls).toEqual([false]);
      expect(rooms[0].listenerCount()).toBe(0);
      expect(roomEvents).toEqual([rooms[0], null]);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(rooms).toHaveLength(1);
    });

    it('is safe during the token request', async () => {
      let resolveToken: (token: LiveKitTokenDto) => void = () => undefined;
      const tokenProvider = vi.fn(
        () => new Promise<LiveKitTokenDto>((resolve) => (resolveToken = resolve)),
      );
      const { session, rooms } = setup('studio', { tokenProvider });
      session.start();
      session.stop();
      resolveToken(fakeToken());
      await vi.advanceTimersByTimeAsync(60_000);
      expect(rooms).toHaveLength(0);
      expect(session.state).toBe('stopped');
    });

    it('is safe during connect', async () => {
      const { session, rooms } = setup();
      session.start();
      await flushMicrotasks();
      session.stop();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(rooms).toHaveLength(1);
      expect(rooms[0].disconnectCalls).toEqual([false]);
      expect(session.state).toBe('stopped');
    });

    it('is safe while waiting and clears the timer', async () => {
      const { session, rooms } = await connected();
      rooms[0].serverDisconnect(undefined);
      session.stop();
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(rooms).toHaveLength(1);
    });

    it('restart() while connected replaces the room', async () => {
      const { session, rooms } = await connected();
      session.restart();
      await flushMicrotasks();
      expect(rooms[0].disconnectCalls).toEqual([false]);
      expect(rooms).toHaveLength(2);
      expect(session.room).toBe(rooms[1]);
    });

    it('survives listeners that throw or stop the session re-entrantly', async () => {
      const { session, rooms } = setup();
      session.onStateChange(() => {
        throw new Error('listener bug');
      });
      session.onRoom((room) => {
        if (room !== null) {
          session.stop();
        }
      });
      session.start();
      await flushMicrotasks();
      expect(session.state).toBe('stopped');
      expect(rooms[0].disconnectCalls).toEqual([]);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(rooms).toHaveLength(1);
    });
  });
});

describe('session state helpers', () => {
  it('maps to the reported RtcState', () => {
    expect(toRtcState('connected')).toBe('connected');
    expect(toRtcState('connecting')).toBe('reconnecting');
    expect(toRtcState('reconnecting')).toBe('reconnecting');
    expect(toRtcState('waiting')).toBe('reconnecting');
    expect(toRtcState('idle')).toBe('disconnected');
    expect(toRtcState('replaced')).toBe('disconnected');
  });

  it('knows the terminal states', () => {
    expect(
      ['stopped', 'replaced', 'removed', 'unauthorized'].every((state) =>
        isTerminalState(state as MediaSessionState),
      ),
    ).toBe(true);
    expect(isTerminalState('waiting')).toBe(false);
    expect(isTerminalState('idle')).toBe(false);
  });
});
