import { TestBed } from '@angular/core/testing';
import { MemoryStorage } from '../../testing/sender-fakes';
import { ApiError } from '../core/api-error';
import { LOCAL_STORAGE, STORAGE_KEYS } from '../core/browser-storage';
import { CredentialsService } from '../core/credentials.service';
import { DeviceApiService } from '../core/device-api.service';
import {
  REDEEM_ATTEMPTS,
  REDEEM_MAX_RETRY_MS,
  REDEEM_OUTAGE_ATTEMPTS,
  RedeemService,
} from './redeem.service';

const CREDENTIALS = {
  deviceId: 'dev_phone0001',
  deviceSecret: 'cm90YXRlZC1zZWNyZXQ',
  productionId: 'prd_webinar01',
};

describe('RedeemService', () => {
  let storage: MemoryStorage;
  let redeemInvite: ReturnType<typeof vi.fn>;
  const noDelay = (): Promise<void> => Promise.resolve();

  function create(): RedeemService {
    TestBed.configureTestingModule({
      providers: [
        { provide: LOCAL_STORAGE, useValue: storage },
        { provide: DeviceApiService, useValue: { redeemInvite } },
      ],
    });
    return TestBed.inject(RedeemService);
  }

  beforeEach(() => {
    storage = new MemoryStorage();
    redeemInvite = vi.fn(() => Promise.resolve(CREDENTIALS));
  });

  afterEach(() => TestBed.resetTestingModule());

  it('redeems without a name (the server picks «Handy n») and stores the credentials', async () => {
    const outcome = await create().redeem('tok123', 'phone', 'Android · Chrome', noDelay);

    expect(outcome).toEqual({ kind: 'paired' });
    const [token, body] = redeemInvite.mock.calls[0] as [string, Record<string, unknown>];
    expect(token).toBe('tok123');
    expect(body).toMatchObject({ name: null, kind: 'phone', platform: 'Android · Chrome' });
    expect(TestBed.inject(CredentialsService).credentials()?.deviceId).toBe('dev_phone0001');
  });

  it('stores the client id before the first request', async () => {
    redeemInvite.mockImplementation(() => {
      expect(storage.readJson(STORAGE_KEYS.credentials)).toMatchObject({
        clientId: expect.any(String),
      });
      return Promise.resolve(CREDENTIALS);
    });
    await create().redeem('tok123', 'phone', 'x', noDelay);
    expect(redeemInvite).toHaveBeenCalledTimes(1);
  });

  it('retries a lost response with the same client id (idempotent redeem)', async () => {
    redeemInvite
      .mockRejectedValueOnce(new ApiError(0, null, 'offline'))
      .mockRejectedValueOnce(new ApiError(502, null, 'gateway'))
      .mockResolvedValueOnce(CREDENTIALS);

    const outcome = await create().redeem('tok123', 'phone', 'x', noDelay);

    expect(outcome).toEqual({ kind: 'paired' });
    const clientIds = redeemInvite.mock.calls.map(
      (call) => (call[1] as { clientId: string }).clientId,
    );
    expect(clientIds).toHaveLength(3);
    expect(new Set(clientIds).size).toBe(1);
  });

  it('reuses the stored client id after a reload during the redeem', async () => {
    redeemInvite.mockRejectedValue(new ApiError(0, null, 'offline'));
    await create().redeem('tok123', 'phone', 'x', noDelay);
    const first = (redeemInvite.mock.calls[0][1] as { clientId: string }).clientId;
    TestBed.resetTestingModule();

    redeemInvite = vi.fn(() => Promise.resolve(CREDENTIALS));
    await create().redeem('tok123', 'phone', 'x', noDelay);

    expect((redeemInvite.mock.calls[0][1] as { clientId: string }).clientId).toBe(first);
  });

  it('gives up after a few attempts and reports the error', async () => {
    redeemInvite.mockRejectedValue(new ApiError(0, null, 'Der Server ist nicht erreichbar.'));

    const outcome = await create().redeem('tok123', 'phone', 'x', noDelay);

    expect(redeemInvite).toHaveBeenCalledTimes(REDEEM_ATTEMPTS);
    expect(outcome).toMatchObject({ kind: 'failed', error: { status: 0 } });
  });

  it('keeps retrying calmly for about a minute while the server is briefly unavailable (503)', async () => {
    redeemInvite.mockRejectedValue(
      new ApiError(503, 'service_unavailable', 'Der Server ist gerade nicht erreichbar.'),
    );
    const delays: number[] = [];

    const outcome = await create().redeem('tok123', 'phone', 'x', (ms) => {
      delays.push(ms);
      return Promise.resolve();
    });

    expect(redeemInvite).toHaveBeenCalledTimes(REDEEM_OUTAGE_ATTEMPTS);
    expect(Math.max(...delays)).toBe(REDEEM_MAX_RETRY_MS);
    expect(delays.reduce((sum, ms) => sum + ms, 0)).toBeGreaterThanOrEqual(60_000);
    expect(outcome).toMatchObject({ kind: 'failed', error: { status: 503 } });
  });

  it('succeeds when the database is back during the retries', async () => {
    redeemInvite
      .mockRejectedValueOnce(new ApiError(503, 'service_unavailable', 'x'))
      .mockRejectedValueOnce(new ApiError(503, 'service_unavailable', 'x'))
      .mockRejectedValueOnce(new ApiError(503, 'service_unavailable', 'x'))
      .mockRejectedValueOnce(new ApiError(503, 'service_unavailable', 'x'))
      .mockRejectedValueOnce(new ApiError(503, 'service_unavailable', 'x'))
      .mockResolvedValueOnce(CREDENTIALS);

    await expect(create().redeem('tok123', 'phone', 'x', noDelay)).resolves.toEqual({
      kind: 'paired',
    });
    expect(redeemInvite).toHaveBeenCalledTimes(6);
  });

  it('410 pairing_expired is final (no retry)', async () => {
    redeemInvite.mockRejectedValue(new ApiError(410, 'pairing_expired', 'abgelaufen'));

    await expect(create().redeem('tok123', 'phone', 'x', noDelay)).resolves.toEqual({
      kind: 'expired',
    });
    expect(redeemInvite).toHaveBeenCalledTimes(1);
  });

  it('waits with growing pauses between attempts', async () => {
    redeemInvite
      .mockRejectedValueOnce(new ApiError(0, null, 'offline'))
      .mockRejectedValueOnce(new ApiError(0, null, 'offline'))
      .mockResolvedValueOnce(CREDENTIALS);
    const delays: number[] = [];

    await create().redeem('tok123', 'phone', 'x', (ms) => {
      delays.push(ms);
      return Promise.resolve();
    });

    expect(delays).toEqual([1000, 2000]);
  });
});
