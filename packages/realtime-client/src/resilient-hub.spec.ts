import { HubConnectionState, LogLevel } from '@microsoft/signalr';
import {
  HubNotConnectedError,
  ResilientHub,
  type HubState,
  type ResilientHubOptions,
} from './resilient-hub';
import {
  FakeConnection,
  RecordingLogger,
  UNAUTHORIZED_ERROR,
  flushMicrotasks,
} from './testing/fakes';

interface Harness {
  readonly hub: ResilientHub;
  readonly connections: FakeConnection[];
  readonly states: HubState[];
  readonly logger: RecordingLogger;
  readonly wake: () => void;
  readonly wakeDisposed: () => boolean;
  connectedCount: number;
  latest(): FakeConnection;
}

function createHarness(overrides: Partial<ResilientHubOptions> = {}): Harness {
  const connections: FakeConnection[] = [];
  const states: HubState[] = [];
  const logger = new RecordingLogger();
  let wakeCallback: (() => void) | null = null;
  let disposed = false;
  const hub = new ResilientHub({
    url: '/hubs/studio',
    logger,
    random: () => 0,
    connectionFactory: () => {
      const connection = new FakeConnection();
      connections.push(connection);
      return connection;
    },
    wakeSignals: (wake) => {
      wakeCallback = wake;
      disposed = false;
      return () => {
        disposed = true;
        wakeCallback = null;
      };
    },
    ...overrides,
  });
  const harness: Harness = {
    hub,
    connections,
    states,
    logger,
    connectedCount: 0,
    wake: () => wakeCallback?.(),
    wakeDisposed: () => disposed,
    latest: () => {
      const connection = connections.at(-1);
      if (!connection) {
        throw new Error('no connection yet');
      }
      return connection;
    },
  };
  hub.onStateChange((state) => states.push(state));
  hub.onConnected(() => {
    harness.connectedCount += 1;
  });
  return harness;
}

async function connect(harness: Harness): Promise<FakeConnection> {
  harness.hub.start();
  const connection = harness.latest();
  connection.succeed();
  await flushMicrotasks();
  return connection;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ResilientHub start loop', () => {
  it('starts idle and connects on start()', async () => {
    const harness = createHarness();
    expect(harness.hub.state).toBe('idle');
    await connect(harness);
    expect(harness.hub.state).toBe('connected');
    expect(harness.states).toEqual(['connecting', 'connected']);
    expect(harness.connectedCount).toBe(1);
  });

  it('retries a failing first start with the backoff until it succeeds', async () => {
    const harness = createHarness();
    harness.hub.start();
    for (const delay of [300, 600, 1200]) {
      harness.latest().fail(new Error('Failed to fetch'));
      await flushMicrotasks();
      expect(harness.hub.state).toBe('connecting');
      const before = harness.connections.length;
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(harness.connections).toHaveLength(before);
      await vi.advanceTimersByTimeAsync(1);
      expect(harness.connections).toHaveLength(before + 1);
    }
    harness.latest().succeed();
    await flushMicrotasks();
    expect(harness.connections).toHaveLength(4);
    expect(harness.hub.state).toBe('connected');
    expect(harness.states).toEqual(['connecting', 'connected']);
    expect(harness.connectedCount).toBe(1);
  });

  it('caps the retry delay at 5 s and never gives up', async () => {
    const harness = createHarness();
    harness.hub.start();
    for (let attempt = 0; attempt < 30; attempt += 1) {
      harness.latest().fail(new Error('Failed to fetch'));
      await flushMicrotasks();
      await vi.advanceTimersByTimeAsync(5000);
    }
    expect(harness.connections).toHaveLength(31);
    expect(harness.hub.state).toBe('connecting');
  });

  it('is idempotent', async () => {
    const harness = createHarness();
    harness.hub.start();
    harness.hub.start();
    expect(harness.connections).toHaveLength(1);
    harness.latest().succeed();
    await flushMicrotasks();
    harness.hub.start();
    expect(harness.connections).toHaveLength(1);
  });

  it('retries when the connection factory throws', async () => {
    let calls = 0;
    const connections: FakeConnection[] = [];
    const harness = createHarness({
      connectionFactory: () => {
        calls += 1;
        if (calls === 1) {
          throw new Error('bad url');
        }
        const connection = new FakeConnection();
        connections.push(connection);
        return connection;
      },
    });
    harness.hub.start();
    expect(harness.hub.state).toBe('connecting');
    await vi.advanceTimersByTimeAsync(300);
    connections[0].succeed();
    await flushMicrotasks();
    expect(harness.hub.state).toBe('connected');
  });

  it('stops the loop for good on 401/403', async () => {
    const harness = createHarness();
    harness.hub.start();
    harness.latest().fail(UNAUTHORIZED_ERROR);
    await flushMicrotasks();
    expect(harness.hub.state).toBe('unauthorized');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(harness.connections).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
    expect(harness.wakeDisposed()).toBe(true);
  });
});

describe('ResilientHub reconnects', () => {
  it('follows SignalR reconnecting/reconnected and notifies onConnected again', async () => {
    const harness = createHarness();
    const connection = await connect(harness);
    connection.loseConnection();
    expect(harness.hub.state).toBe('reconnecting');
    connection.reconnect();
    expect(harness.hub.state).toBe('connected');
    expect(harness.states).toEqual(['connecting', 'connected', 'reconnecting', 'connected']);
    expect(harness.connectedCount).toBe(2);
    expect(harness.connections).toHaveLength(1);
  });

  it('starts a fresh connection after SignalR closed the connection', async () => {
    const harness = createHarness();
    const first = await connect(harness);
    first.close(new Error('Server returned an error on close'));
    expect(harness.hub.state).toBe('reconnecting');
    await vi.advanceTimersByTimeAsync(300);
    expect(harness.connections).toHaveLength(2);
    harness.latest().succeed();
    await flushMicrotasks();
    expect(harness.hub.state).toBe('connected');
    expect(harness.connectedCount).toBe(2);
  });

  it('ends in unauthorized when the close reason is 401/403', async () => {
    const harness = createHarness();
    const connection = await connect(harness);
    connection.close(new Error("Forbidden: Status code '403'"));
    expect(harness.hub.state).toBe('unauthorized');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(harness.connections).toHaveLength(1);
  });

  it('detects 401/403 with one fresh attempt when SignalR gave up without a reason', async () => {
    const harness = createHarness();
    const connection = await connect(harness);
    connection.loseConnection();
    // The retry policy returned null for a 401 during reconnect; SignalR then closes without an error.
    connection.close(undefined);
    expect(harness.hub.state).toBe('reconnecting');
    await vi.advanceTimersByTimeAsync(300);
    harness.latest().fail(UNAUTHORIZED_ERROR);
    await flushMicrotasks();
    expect(harness.hub.state).toBe('unauthorized');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps the backoff growing for a server that closes every connection at once', async () => {
    const harness = createHarness();
    await connect(harness);
    const delays: number[] = [];
    for (let round = 0; round < 4; round += 1) {
      harness.latest().close(new Error('closed'));
      const before = harness.connections.length;
      let waited = 0;
      while (harness.connections.length === before) {
        await vi.advanceTimersByTimeAsync(100);
        waited += 100;
      }
      delays.push(waited);
      harness.latest().succeed();
      await flushMicrotasks();
    }
    expect(delays).toEqual([300, 600, 1200, 2400]);
  });

  it('starts the backoff from the beginning after a stable connection', async () => {
    let now = 0;
    const harness = createHarness({ now: () => now });
    await connect(harness);
    harness.latest().close(new Error('closed'));
    await vi.advanceTimersByTimeAsync(300);
    harness.latest().succeed();
    await flushMicrotasks();
    now += 10_000;
    harness.latest().close(new Error('closed'));
    await vi.advanceTimersByTimeAsync(300);
    expect(harness.connections).toHaveLength(3);
  });

  it('does not accumulate handlers, listeners or timers over many reconnect cycles', async () => {
    let now = 0;
    const harness = createHarness({ now: () => now });
    harness.hub.on('event', () => undefined);
    await connect(harness);
    for (let cycle = 0; cycle < 200; cycle += 1) {
      now += 20_000;
      if (cycle % 2 === 0) {
        harness.latest().loseConnection();
        harness.latest().reconnect();
      } else {
        harness.latest().close(new Error('closed'));
        await vi.advanceTimersByTimeAsync(300);
        harness.latest().succeed();
        await flushMicrotasks();
      }
      expect(vi.getTimerCount()).toBe(0);
    }
    expect(harness.hub.state).toBe('connected');
    expect(harness.latest().handlerCount('event')).toBe(1);
    expect(harness.connections).toHaveLength(101);
    expect(harness.connectedCount).toBe(201);
  });

  it('does not report connected when the connection dropped right after start resolved', async () => {
    const harness = createHarness();
    harness.hub.start();
    const connection = harness.latest();
    connection.succeed();
    connection.loseConnection();
    await flushMicrotasks();
    expect(harness.hub.state).toBe('reconnecting');
    expect(harness.connectedCount).toBe(0);
    connection.reconnect();
    expect(harness.hub.state).toBe('connected');
    expect(harness.connectedCount).toBe(1);
  });

  it('retries when the connection closed right after start resolved', async () => {
    const harness = createHarness();
    harness.hub.start();
    const connection = harness.latest();
    connection.succeed();
    connection.close(new Error('gone'));
    await flushMicrotasks();
    expect(harness.hub.state).toBe('reconnecting');
    expect(harness.connectedCount).toBe(0);
    await vi.advanceTimersByTimeAsync(300);
    expect(harness.connections).toHaveLength(2);
  });

  it('ignores callbacks of connections it replaced', async () => {
    const harness = createHarness();
    const first = await connect(harness);
    first.close(new Error('closed'));
    await vi.advanceTimersByTimeAsync(300);
    harness.latest().succeed();
    await flushMicrotasks();
    first.loseConnection();
    first.reconnect();
    first.close(new Error('late'));
    expect(harness.hub.state).toBe('connected');
    expect(harness.connectedCount).toBe(2);
  });
});

describe('ResilientHub wake signals', () => {
  it('cuts a retry wait short', async () => {
    const harness = createHarness();
    harness.hub.start();
    for (let attempt = 0; attempt < 6; attempt += 1) {
      harness.latest().fail(new Error('offline'));
      await flushMicrotasks();
      await vi.advanceTimersByTimeAsync(5000);
    }
    harness.latest().fail(new Error('offline'));
    await flushMicrotasks();
    const before = harness.connections.length;
    harness.wake();
    expect(harness.connections).toHaveLength(before + 1);
    expect(vi.getTimerCount()).toBe(0);
    harness.latest().succeed();
    await flushMicrotasks();
    expect(harness.hub.state).toBe('connected');
  });

  it('replaces a connection that waits inside SignalR’s own reconnect', async () => {
    const harness = createHarness();
    const first = await connect(harness);
    first.loseConnection();
    harness.wake();
    expect(first.stopCalls).toBe(1);
    expect(harness.connections).toHaveLength(2);
    expect(harness.hub.state).toBe('reconnecting');
    harness.latest().succeed();
    await flushMicrotasks();
    expect(harness.hub.state).toBe('connected');
    expect(harness.connectedCount).toBe(2);
  });

  it('does nothing while connected or while a start is running', async () => {
    const harness = createHarness();
    harness.hub.start();
    harness.wake();
    expect(harness.connections).toHaveLength(1);
    harness.latest().succeed();
    await flushMicrotasks();
    harness.wake();
    harness.wake();
    expect(harness.connections).toHaveLength(1);
    expect(harness.hub.state).toBe('connected');
  });

  it('removes the wake listeners on stop and adds them again on restart', async () => {
    const harness = createHarness();
    await connect(harness);
    await harness.hub.stop();
    expect(harness.wakeDisposed()).toBe(true);
    harness.hub.restart();
    expect(harness.wakeDisposed()).toBe(false);
  });
});

describe('ResilientHub stop, terminal states and restart', () => {
  it('stop during a retry wait cancels it and leaves no timers', async () => {
    const harness = createHarness();
    harness.hub.start();
    harness.latest().fail(new Error('offline'));
    await flushMicrotasks();
    expect(vi.getTimerCount()).toBe(1);
    await harness.hub.stop();
    expect(harness.hub.state).toBe('stopped');
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(harness.connections).toHaveLength(1);
  });

  it('stop while connected closes the connection without reconnecting', async () => {
    const harness = createHarness();
    const connection = await connect(harness);
    await harness.hub.stop();
    expect(connection.stopCalls).toBe(1);
    expect(harness.hub.state).toBe('stopped');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(harness.connections).toHaveLength(1);
    expect(harness.states.at(-1)).toBe('stopped');
  });

  it('stops a connection whose start resolves after stop()', async () => {
    const harness = createHarness({
      connectionFactory: () => {
        const connection = new FakeConnection();
        // A start that cannot be aborted: stop() does not reject it.
        connection.stop = () => {
          connection.stopCalls += 1;
          return Promise.resolve();
        };
        harness.connections.push(connection);
        return connection;
      },
    });
    harness.hub.start();
    const connection = harness.latest();
    await harness.hub.stop();
    connection.succeed();
    await flushMicrotasks();
    expect(connection.stopCalls).toBe(2);
    expect(harness.hub.state).toBe('stopped');
    expect(harness.connectedCount).toBe(0);
  });

  it('markTerminal stops reconnecting with the given state', async () => {
    const harness = createHarness();
    const connection = await connect(harness);
    harness.hub.markTerminal('stopped');
    expect(harness.hub.state).toBe('stopped');
    expect(connection.stopCalls).toBe(1);
    const other = createHarness();
    await connect(other);
    other.hub.markTerminal('unauthorized');
    expect(other.hub.state).toBe('unauthorized');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(other.connections).toHaveLength(1);
  });

  it('restart connects again after unauthorized and after stop; start does not', async () => {
    const harness = createHarness();
    harness.hub.start();
    harness.latest().fail(UNAUTHORIZED_ERROR);
    await flushMicrotasks();
    harness.hub.start();
    expect(harness.connections).toHaveLength(1);
    harness.hub.restart();
    expect(harness.hub.state).toBe('connecting');
    harness.latest().succeed();
    await flushMicrotasks();
    expect(harness.hub.state).toBe('connected');
    harness.hub.restart();
    expect(harness.connections).toHaveLength(2);
    await harness.hub.stop();
    harness.hub.restart();
    expect(harness.connections).toHaveLength(3);
  });

  it('stop before start ends in stopped without connecting', async () => {
    const harness = createHarness();
    await harness.hub.stop();
    expect(harness.hub.state).toBe('stopped');
    expect(harness.connections).toHaveLength(0);
  });

  it('a state listener that stops the hub prevents the connect notification', async () => {
    const harness = createHarness();
    let connectedCalls = 0;
    harness.hub.onConnected(() => {
      connectedCalls += 1;
    });
    harness.hub.onStateChange((state) => {
      if (state === 'connected') {
        void harness.hub.stop();
      }
    });
    await connect(harness);
    expect(harness.hub.state).toBe('stopped');
    expect(connectedCalls).toBe(0);
  });
});

describe('ResilientHub handlers', () => {
  it('delivers to handlers registered before start, across reconnects and replacements', async () => {
    const harness = createHarness();
    const received: unknown[] = [];
    harness.hub.on('event', (payload) => received.push(payload));
    const first = await connect(harness);
    first.receive('event', 1);
    first.loseConnection();
    first.reconnect();
    first.receive('event', 2);
    first.close(new Error('closed'));
    await vi.advanceTimersByTimeAsync(300);
    const second = harness.latest();
    second.succeed();
    await flushMicrotasks();
    second.receive('event', 3);
    first.receive('event', 'stale');
    expect(received).toEqual([1, 2, 3]);
    expect(second.handlerCount('event')).toBe(1);
  });

  it('treats method names case-insensitively like SignalR', async () => {
    const harness = createHarness();
    const received: unknown[] = [];
    harness.hub.on('Event', (payload) => received.push(payload));
    const connection = await connect(harness);
    connection.receive('event', 'x');
    expect(received).toEqual(['x']);
  });

  it('registers handlers added while connected and detaches the last one', async () => {
    const harness = createHarness();
    const connection = await connect(harness);
    const received: unknown[] = [];
    const offA = harness.hub.on('tally', (value) => received.push(`a:${String(value)}`));
    const offB = harness.hub.on('tally', (value) => received.push(`b:${String(value)}`));
    expect(connection.handlerCount('tally')).toBe(1);
    connection.receive('tally', 1);
    offA();
    offA();
    connection.receive('tally', 2);
    offB();
    expect(connection.handlerCount('tally')).toBe(0);
    connection.receive('tally', 3);
    expect(received).toEqual(['a:1', 'b:1', 'b:2']);
  });

  it('keeps two registrations of the same function apart', async () => {
    const harness = createHarness();
    const connection = await connect(harness);
    let calls = 0;
    const handler = (): void => {
      calls += 1;
    };
    const off = harness.hub.on('presence', handler);
    harness.hub.on('presence', handler);
    connection.receive('presence', 1);
    off();
    connection.receive('presence', 2);
    expect(calls).toBe(3);
  });

  it('isolates throwing and rejecting handlers', async () => {
    const harness = createHarness();
    const connection = await connect(harness);
    const received: unknown[] = [];
    harness.hub.on('event', () => {
      throw new Error('boom');
    });
    harness.hub.on('event', () => Promise.reject(new Error('async boom')));
    harness.hub.on('event', (value) => received.push(value));
    expect(() => connection.receive('event', 7)).not.toThrow();
    await flushMicrotasks();
    expect(received).toEqual([7]);
    expect(harness.logger.messages(LogLevel.Error)).toEqual([
      'Unexpected error in handler for event: boom',
      'Unexpected error in handler for event: async boom',
    ]);
  });

  it('isolates throwing state and connected listeners', async () => {
    const harness = createHarness();
    harness.hub.onStateChange(() => {
      throw new Error('listener');
    });
    harness.hub.onConnected(() => {
      throw new Error('listener');
    });
    await connect(harness);
    expect(harness.hub.state).toBe('connected');
    expect(harness.connectedCount).toBe(1);
  });

  it('unsubscribes state and connected listeners', async () => {
    const harness = createHarness();
    const states: HubState[] = [];
    const off = harness.hub.onStateChange((state) => states.push(state));
    let connected = 0;
    const offConnected = harness.hub.onConnected(() => {
      connected += 1;
    });
    off();
    offConnected();
    await connect(harness);
    expect(states).toEqual([]);
    expect(connected).toBe(0);
  });
});

describe('ResilientHub invoke and send', () => {
  it('rejects with HubNotConnectedError while not connected', async () => {
    const harness = createHarness();
    await expect(harness.hub.invoke('Subscribe')).rejects.toBeInstanceOf(HubNotConnectedError);
    harness.hub.start();
    await expect(harness.hub.send('Report', {})).rejects.toMatchObject({
      method: 'Report',
      state: 'connecting',
    });
  });

  it('forwards to the connection while connected', async () => {
    const harness = createHarness();
    const connection = await connect(harness);
    connection.invokeResult = (method, args) => Promise.resolve({ method, args });
    await expect(harness.hub.invoke('Subscribe', 'prd_1', null)).resolves.toEqual({
      method: 'Subscribe',
      args: ['prd_1', null],
    });
    await harness.hub.send('Report', { rendering: true });
    expect(connection.sent).toEqual([{ method: 'Report', args: [{ rendering: true }] }]);
  });

  it('rejects while reconnecting and turns synchronous throws into rejections', async () => {
    const harness = createHarness();
    const connection = await connect(harness);
    connection.invokeResult = () => {
      throw new Error('sync');
    };
    await expect(harness.hub.invoke('X')).rejects.toThrow('sync');
    connection.loseConnection();
    await expect(harness.hub.invoke('X')).rejects.toBeInstanceOf(HubNotConnectedError);
  });
});

describe('ResilientHub logging', () => {
  it('never logs hub tokens', async () => {
    const harness = createHarness();
    harness.hub.start();
    harness
      .latest()
      .fail(
        new Error('WebSocket failed: wss://host/hubs/device?id=1&access_token=dev_x.secret123'),
      );
    await flushMicrotasks();
    const text = harness.logger.messages().join('\n');
    expect(text).toContain('access_token=REDACTED');
    expect(text).not.toContain('secret123');
  });

  it('uses the console when no logger is given', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const hub = new ResilientHub({
      url: '/hubs/output',
      random: () => 0,
      wakeSignals: () => () => undefined,
      connectionFactory: () => {
        const connection = new FakeConnection();
        queueMicrotask(() => connection.fail(new Error('offline')));
        return connection;
      },
    });
    hub.start();
    await flushMicrotasks();
    expect(info).not.toHaveBeenCalled();
    await hub.stop();
    info.mockRestore();
  });
});

describe('ResilientHub with the real connection state', () => {
  it('reads HubConnectionState from the connection for the wake shortcut', async () => {
    const harness = createHarness();
    const connection = await connect(harness);
    connection.loseConnection();
    connection.state = HubConnectionState.Connecting;
    harness.wake();
    expect(harness.connections).toHaveLength(1);
  });
});
