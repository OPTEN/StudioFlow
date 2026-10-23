import { TestBed } from '@angular/core/testing';
import { MemoryStorage, settle } from '../../testing/sender-fakes';
import { ApiError } from '../core/api-error';
import { LOCAL_STORAGE, SESSION_STORAGE, STORAGE_KEYS } from '../core/browser-storage';
import { CredentialsService } from '../core/credentials.service';
import { DeviceApiService } from '../core/device-api.service';
import { NoticeService } from '../core/notice.service';
import { KNOCK_POLL_MS, KnockService } from './knock.service';

const CREATED = {
  requestId: 'prq_abcd1234',
  pollToken: 'poll-token',
  checkCode: '4712',
  expiresAt: '2026-10-22T12:10:00Z',
};

const CREDENTIALS = {
  deviceId: 'dev_laptop0001',
  deviceSecret: 'c2VjcmV0LWxhcHRvcA',
  productionId: 'prd_webinar01',
};

describe('KnockService', () => {
  let session: MemoryStorage;
  let local: MemoryStorage;
  let api: {
    createPairingRequest: ReturnType<typeof vi.fn>;
    getPairingRequestStatus: ReturnType<typeof vi.fn>;
    cancelPairingRequest: ReturnType<typeof vi.fn>;
  };

  function create(): KnockService {
    TestBed.configureTestingModule({
      providers: [
        { provide: SESSION_STORAGE, useValue: session },
        { provide: LOCAL_STORAGE, useValue: local },
        { provide: DeviceApiService, useValue: api },
      ],
    });
    return TestBed.inject(KnockService);
  }

  beforeEach(() => {
    vi.useFakeTimers();
    session = new MemoryStorage();
    local = new MemoryStorage();
    api = {
      createPairingRequest: vi.fn(() => Promise.resolve(CREATED)),
      getPairingRequestStatus: vi.fn(() =>
        Promise.resolve({ status: 'pending', credentials: null }),
      ),
      cancelPairingRequest: vi.fn(() => Promise.resolve()),
    };
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.useRealTimers();
  });

  it('knocks with name, kind and platform and keeps the request for a reload', async () => {
    const knock = create();

    await expect(knock.request('Laptop Anna', 'laptop', 'Windows · Edge')).resolves.toBe(true);

    expect(api.createPairingRequest).toHaveBeenCalledWith({
      name: 'Laptop Anna',
      kind: 'laptop',
      platform: 'Windows · Edge',
    });
    expect(knock.phase()).toBe('pending');
    expect(knock.knock()?.checkCode).toBe('4712');
    expect(session.readJson(STORAGE_KEYS.pairing)).toEqual({
      ...CREATED,
      name: 'Laptop Anna',
      kind: 'laptop',
    });
  });

  it('polls every 1.5 s with the poll token', async () => {
    const knock = create();
    await knock.request('Laptop Anna', 'laptop', 'x');

    await vi.advanceTimersByTimeAsync(KNOCK_POLL_MS);
    expect(api.getPairingRequestStatus).toHaveBeenCalledTimes(1);
    expect(api.getPairingRequestStatus).toHaveBeenCalledWith('prq_abcd1234', 'poll-token');
    await vi.advanceTimersByTimeAsync(KNOCK_POLL_MS);
    expect(api.getPairingRequestStatus).toHaveBeenCalledTimes(2);
  });

  it('approve: stores the credentials, forgets the request and greets on the station', async () => {
    const knock = create();
    await knock.request('Laptop Anna', 'laptop', 'x');
    api.getPairingRequestStatus.mockResolvedValue({ status: 'approved', credentials: CREDENTIALS });

    await vi.advanceTimersByTimeAsync(KNOCK_POLL_MS);

    expect(knock.phase()).toBe('approved');
    expect(TestBed.inject(CredentialsService).credentials()?.deviceId).toBe('dev_laptop0001');
    expect(TestBed.inject(NoticeService).justPaired()).toBe(true);
    expect(session.readJson(STORAGE_KEYS.pairing)).toBeNull();
    await vi.advanceTimersByTimeAsync(KNOCK_POLL_MS * 4);
    expect(api.getPairingRequestStatus).toHaveBeenCalledTimes(1);
  });

  it('deny: stops polling and keeps the name for a new request', async () => {
    const knock = create();
    await knock.request('Laptop Anna', 'laptop', 'x');
    api.getPairingRequestStatus.mockResolvedValue({ status: 'denied', credentials: null });

    await vi.advanceTimersByTimeAsync(KNOCK_POLL_MS);

    expect(knock.phase()).toBe('denied');
    expect(knock.hasPending()).toBe(false);
    expect(knock.lastRequest()).toEqual({ name: 'Laptop Anna', kind: 'laptop' });
    await vi.advanceTimersByTimeAsync(KNOCK_POLL_MS * 4);
    expect(api.getPairingRequestStatus).toHaveBeenCalledTimes(1);
  });

  it('expire: an expired status (also after the credentials window) ends the knock', async () => {
    const knock = create();
    await knock.request('Laptop Anna', 'laptop', 'x');
    api.getPairingRequestStatus.mockResolvedValue({ status: 'expired', credentials: null });

    await vi.advanceTimersByTimeAsync(KNOCK_POLL_MS);

    expect(knock.phase()).toBe('expired');
    expect(session.readJson(STORAGE_KEYS.pairing)).toBeNull();
  });

  it('backs off while the server is unreachable and continues where it was', async () => {
    const knock = create();
    await knock.request('Laptop Anna', 'laptop', 'x');
    api.getPairingRequestStatus.mockRejectedValue(new ApiError(0, null, 'offline'));

    await vi.advanceTimersByTimeAsync(KNOCK_POLL_MS);
    expect(knock.connectionTrouble()).toBe(true);
    expect(api.getPairingRequestStatus).toHaveBeenCalledTimes(1);

    // Second attempt after 3 s (1.5 s × 2), not after 1.5 s.
    await vi.advanceTimersByTimeAsync(KNOCK_POLL_MS);
    expect(api.getPairingRequestStatus).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(KNOCK_POLL_MS);
    expect(api.getPairingRequestStatus).toHaveBeenCalledTimes(2);

    api.getPairingRequestStatus.mockResolvedValue({ status: 'approved', credentials: CREDENTIALS });
    await vi.advanceTimersByTimeAsync(6000);
    expect(knock.phase()).toBe('approved');
    expect(knock.connectionTrouble()).toBe(false);
  });

  it('polls at once when the network comes back', async () => {
    const knock = create();
    await knock.request('Laptop Anna', 'laptop', 'x');
    api.getPairingRequestStatus.mockRejectedValue(new ApiError(0, null, 'offline'));
    await vi.advanceTimersByTimeAsync(KNOCK_POLL_MS);
    api.getPairingRequestStatus.mockResolvedValue({ status: 'pending', credentials: null });

    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(0);

    expect(api.getPairingRequestStatus).toHaveBeenCalledTimes(2);
  });

  it('survives a reload: a new instance resumes the same request and code', async () => {
    create().request('Laptop Anna', 'laptop', 'x');
    await settle();
    TestBed.resetTestingModule();

    const reloaded = create();
    expect(reloaded.hasPending()).toBe(true);
    expect(reloaded.knock()?.checkCode).toBe('4712');

    reloaded.resume();
    expect(reloaded.phase()).toBe('pending');
    await vi.advanceTimersByTimeAsync(0);
    expect(api.getPairingRequestStatus).toHaveBeenCalledWith('prq_abcd1234', 'poll-token');
    expect(api.createPairingRequest).toHaveBeenCalledTimes(1);
  });

  it('ignores corrupt pairing state from storage', () => {
    session.setRaw(STORAGE_KEYS.pairing, '{"requestId": 1}');
    expect(create().hasPending()).toBe(false);
  });

  it('shows the rate-limit message and stays on the form', async () => {
    api.createPairingRequest.mockRejectedValue(
      new ApiError(
        429,
        'rate_limited',
        'Zu viele Versuche. Bitte in 2 Minuten noch einmal versuchen.',
        120,
      ),
    );
    const knock = create();

    await expect(knock.request('Laptop Anna', 'laptop', 'x')).resolves.toBe(false);

    expect(knock.phase()).toBe('idle');
    expect(knock.error()?.userMessage).toContain('2 minutes');
  });

  it('cancel withdraws the request with the poll token', async () => {
    const knock = create();
    await knock.request('Laptop Anna', 'laptop', 'x');

    await knock.cancel();

    expect(api.cancelPairingRequest).toHaveBeenCalledWith('prq_abcd1234', 'poll-token');
    expect(knock.phase()).toBe('idle');
    expect(knock.hasPending()).toBe(false);
    await vi.advanceTimersByTimeAsync(KNOCK_POLL_MS * 3);
    expect(api.getPairingRequestStatus).not.toHaveBeenCalled();
  });
});
