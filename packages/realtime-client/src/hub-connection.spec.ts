import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { HttpError, HubConnectionState, LogLevel } from '@microsoft/signalr';
import {
  KEEP_ALIVE_INTERVAL_MS,
  SERVER_TIMEOUT_MS,
  createHubConnection,
  hubRetryPolicy,
  isUnauthorizedError,
} from './hub-connection';
import { RecordingLogger } from './testing/fakes';

function retryContext(
  previousRetryCount: number,
  retryReason: Error,
): Parameters<typeof hubRetryPolicy.nextRetryDelayInMilliseconds>[0] {
  return { previousRetryCount, elapsedMilliseconds: previousRetryCount * 1000, retryReason };
}

describe('isUnauthorizedError', () => {
  it.each([
    new Error(
      "Failed to complete negotiation with the server: Error: Unauthorized: Status code '401'",
    ),
    new Error(
      "Failed to complete negotiation with the server: Error: Forbidden: Status code '403'",
    ),
    new HttpError('Unauthorized', 401),
    { statusCode: 403 },
    "Status code '401'",
  ])('recognises %s', (error) => {
    expect(isUnauthorizedError(error)).toBe(true);
  });

  it.each([
    new Error('WebSocket closed with status code: 1006 (no reason given).'),
    new Error(
      "Failed to complete negotiation with the server: Error: Internal Server Error: Status code '500'",
    ),
    new Error("Status code '4011'"),
    new HttpError('Not Found', 404),
    { statusCode: '401' },
    { message: 42 },
    'Failed to fetch',
    null,
    undefined,
    42,
  ])('does not treat %s as unauthorized', (error) => {
    expect(isUnauthorizedError(error)).toBe(false);
  });
});

describe('hubRetryPolicy', () => {
  it('gives up only for 401/403', () => {
    expect(
      hubRetryPolicy.nextRetryDelayInMilliseconds(
        retryContext(3, new Error("Unauthorized: Status code '401'")),
      ),
    ).toBeNull();
    expect(
      hubRetryPolicy.nextRetryDelayInMilliseconds(
        retryContext(0, new Error("Forbidden: Status code '403'")),
      ),
    ).toBeNull();
  });

  it('never gives up for other reasons, however long the outage lasts', () => {
    const reasons = [
      new Error('WebSocket closed with status code: 1006'),
      new Error('Server timeout elapsed without receiving a message from the server.'),
      new Error("Status code '502'"),
      new Error(''),
    ];
    for (const reason of reasons) {
      for (let count = 0; count < 500; count += 1) {
        const delay = hubRetryPolicy.nextRetryDelayInMilliseconds(retryContext(count, reason));
        expect(delay).not.toBeNull();
        expect(delay).toBeLessThanOrEqual(5250);
      }
    }
  });

  it('retries immediately first, then follows the shared backoff', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const reason = new Error('gone');
    const delays = [0, 1, 2, 3, 4, 5, 6].map((count) =>
      hubRetryPolicy.nextRetryDelayInMilliseconds(retryContext(count, reason)),
    );
    expect(delays).toEqual([0, 300, 600, 1200, 2400, 4800, 5000]);
    vi.restoreAllMocks();
  });
});

describe('createHubConnection', () => {
  it('builds a stopped connection with the spec timeouts', () => {
    const connection = createHubConnection({
      url: 'http://127.0.0.1:1/hubs/studio',
      logger: new RecordingLogger(),
    });
    expect(connection.state).toBe(HubConnectionState.Disconnected);
    expect(connection.serverTimeoutInMilliseconds).toBe(SERVER_TIMEOUT_MS);
    expect(connection.keepAliveIntervalInMilliseconds).toBe(KEEP_ALIVE_INTERVAL_MS);
    expect(SERVER_TIMEOUT_MS).toBe(6000);
    expect(KEEP_ALIVE_INTERVAL_MS).toBe(2000);
  });
});

describe('createHubConnection against a negotiate endpoint', () => {
  let server: Server;
  let status = 401;
  let authorization: string | undefined;
  let baseUrl = '';

  beforeAll(async () => {
    server = createServer((request, response) => {
      authorization = request.headers.authorization;
      response.statusCode = status;
      response.end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it.each([401, 403])(
    'rejects start() with an unauthorized error for HTTP %s and sends the token',
    async (code) => {
      status = code;
      const logger = new RecordingLogger();
      const connection = createHubConnection({
        url: `${baseUrl}/hubs/device`,
        accessTokenFactory: () => 'dev_abc.s3cr3t',
        logger,
      });
      const error: unknown = await connection.start().then(
        () => null,
        (reason: unknown) => reason,
      );
      expect(isUnauthorizedError(error)).toBe(true);
      expect(authorization).toBe('Bearer dev_abc.s3cr3t');
      expect(connection.state).toBe(HubConnectionState.Disconnected);
      expect(logger.messages(LogLevel.Error).join('\n')).not.toContain('s3cr3t');
    },
  );

  it('rejects start() with a retryable error for HTTP 500', async () => {
    status = 500;
    const connection = createHubConnection({
      url: `${baseUrl}/hubs/studio`,
      logger: new RecordingLogger(),
    });
    const error: unknown = await connection.start().then(
      () => null,
      (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(Error);
    expect(isUnauthorizedError(error)).toBe(false);
  });
});
