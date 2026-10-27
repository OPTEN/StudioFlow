import { ConnectionErrorReason, RoomEvent } from 'livekit-client';
import {
  connectFailureStage,
  runMediaRoundTrip,
  type MediaTestInput,
  type MediaTestRoom,
} from './media-test';

const INPUT: MediaTestInput = {
  url: 'wss://studio.example.ch:8443',
  firstToken: 'first-token',
  secondToken: 'second-token',
  timeoutMs: 1000,
};

type Listener = (...args: never[]) => void;

/** A room that relays published data to its peer, like the SFU does. */
class FakeTestRoom implements MediaTestRoom {
  peer: FakeTestRoom | null = null;
  connected: { url: string; token: string } | null = null;
  disconnected = false;
  connectError: unknown = null;
  /** Never resolves `connect` when true (a transport that does not come up). */
  hangOnConnect = false;
  /** Swallows published data when true (a path that loses messages). */
  dropData = false;
  published: string[] = [];
  private readonly listeners = new Map<string, Set<Listener>>();

  readonly localParticipant = {
    publishData: async (data: Uint8Array): Promise<void> => {
      this.published.push(new TextDecoder().decode(data));
      if (!this.dropData) {
        this.peer?.deliver(data);
      }
    },
  };

  connect(url: string, token: string): Promise<void> {
    if (this.hangOnConnect) {
      return new Promise<void>(() => undefined);
    }
    if (this.connectError) {
      return Promise.reject(this.connectError as Error);
    }
    this.connected = { url, token };
    return Promise.resolve();
  }

  disconnect(): Promise<void> {
    this.disconnected = true;
    return Promise.resolve();
  }

  on(event: string, listener: Listener): this {
    const set = this.listeners.get(event) ?? new Set<Listener>();
    set.add(listener);
    this.listeners.set(event, set);
    return this;
  }

  off(event: string, listener: Listener): this {
    this.listeners.get(event)?.delete(listener);
    return this;
  }

  private deliver(data: Uint8Array): void {
    for (const listener of this.listeners.get(RoomEvent.DataReceived) ?? []) {
      (listener as (payload: Uint8Array) => void)(data);
    }
  }
}

function pair(): { first: FakeTestRoom; second: FakeTestRoom; create: () => MediaTestRoom } {
  const first = new FakeTestRoom();
  const second = new FakeTestRoom();
  first.peer = second;
  second.peer = first;
  const queue = [first, second];
  return { first, second, create: () => queue.shift() as FakeTestRoom };
}

describe('runMediaRoundTrip', () => {
  it('succeeds when the answer comes back, over the given url with each token', async () => {
    const { first, second, create } = pair();
    const result = await runMediaRoundTrip(INPUT, create, () => 100);
    expect(result).toEqual({ ok: true, roundTripMs: 0 });
    expect(first.connected).toEqual({ url: INPUT.url, token: 'first-token' });
    expect(second.connected).toEqual({ url: INPUT.url, token: 'second-token' });
    expect(first.published).toEqual(['studioflow-media-test-ping']);
    expect(second.published).toEqual(['studioflow-media-test-pong']);
  });

  it('measures the time between the message and its answer', async () => {
    const { create } = pair();
    let clock = 1000;
    const result = await runMediaRoundTrip(INPUT, create, () => (clock += 37));
    expect(result).toEqual({ ok: true, roundTripMs: 37 });
  });

  it('disconnects both rooms after a success', async () => {
    const { first, second, create } = pair();
    await runMediaRoundTrip(INPUT, create);
    expect(first.disconnected).toBe(true);
    expect(second.disconnected).toBe(true);
  });

  it('reports the transport when connecting does not complete in time', async () => {
    vi.useFakeTimers();
    try {
      const { first, second, create } = pair();
      first.hangOnConnect = true;
      const run = runMediaRoundTrip(INPUT, create);
      await vi.advanceTimersByTimeAsync(1500);
      const result = await run;
      expect(result).toMatchObject({ ok: false, stage: 'transport' });
      expect(first.disconnected).toBe(true);
      expect(second.disconnected).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports the signalling when the server cannot be reached', async () => {
    const { first, create } = pair();
    first.connectError = Object.assign(new Error('could not connect'), {
      reason: ConnectionErrorReason.ServerUnreachable,
    });
    const result = await runMediaRoundTrip(INPUT, create);
    expect(result).toMatchObject({ ok: false, stage: 'signal', detail: 'could not connect' });
  });

  it('reports the transport when the peer connection cannot be established', async () => {
    const { second, create } = pair();
    second.connectError = Object.assign(new Error('could not establish pc connection'), {
      reason: ConnectionErrorReason.InternalError,
    });
    const result = await runMediaRoundTrip(INPUT, create);
    expect(result).toMatchObject({ ok: false, stage: 'transport' });
  });

  it('reports the data path when the message never comes back', async () => {
    vi.useFakeTimers();
    try {
      const { first, create } = pair();
      first.dropData = true;
      const run = runMediaRoundTrip(INPUT, create);
      await vi.advanceTimersByTimeAsync(1500);
      const result = await run;
      expect(result).toMatchObject({ ok: false, stage: 'data' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('classifies a failed connect', () => {
    expect(connectFailureStage(new Error('x'))).toBe('signal');
    expect(connectFailureStage({ reason: ConnectionErrorReason.Timeout })).toBe('transport');
    expect(connectFailureStage({ reason: ConnectionErrorReason.NotAllowed, status: 401 })).toBe(
      'signal',
    );
    expect(connectFailureStage(null)).toBe('signal');
  });
});
