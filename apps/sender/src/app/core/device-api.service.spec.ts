import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MemoryStorage } from '../../testing/sender-fakes';
import { ApiError, formatRetryAfter, parseRetryAfter } from './api-error';
import { LOCAL_STORAGE, STORAGE_KEYS } from './browser-storage';
import { DeviceApiService } from './device-api.service';
import { deviceAuthInterceptor } from './device-auth.interceptor';

describe('DeviceApiService', () => {
  let api: DeviceApiService;
  let http: HttpTestingController;
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
    storage.writeJson(STORAGE_KEYS.credentials, {
      deviceId: 'dev_abcd1234',
      secret: 'c2VjcmV0',
      productionId: 'prd_abcd1234',
    });
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([deviceAuthInterceptor])),
        provideHttpClientTesting(),
        { provide: LOCAL_STORAGE, useValue: storage },
      ],
    });
    api = TestBed.inject(DeviceApiService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
  });

  it('sends the device bearer on device routes', async () => {
    const self = api.getSelf();
    const request = http.expectOne('/api/device/me');
    expect(request.request.headers.get('Authorization')).toBe('Bearer dev_abcd1234.c2VjcmV0');
    request.flush({ id: 'dev_abcd1234' });
    await expect(self).resolves.toEqual({ id: 'dev_abcd1234' });
  });

  it('never sends the bearer to the public pairing routes', async () => {
    const created = api.createPairingRequest({
      name: 'Laptop Anna',
      kind: 'laptop',
      platform: 'Windows · Edge',
    });
    const request = http.expectOne('/api/pairing/requests');
    expect(request.request.method).toBe('POST');
    expect(request.request.headers.has('Authorization')).toBe(false);
    expect(request.request.body).toEqual({
      name: 'Laptop Anna',
      kind: 'laptop',
      platform: 'Windows · Edge',
    });
    request.flush(
      { requestId: 'prq_1', pollToken: 't', checkCode: '4712', expiresAt: '' },
      { status: 201, statusText: 'Created' },
    );
    await expect(created).resolves.toMatchObject({ checkCode: '4712' });
  });

  it('polls a knock with the X-Pairing-Token header', async () => {
    const status = api.getPairingRequestStatus('prq_1', 'poll-secret');
    const request = http.expectOne('/api/pairing/requests/prq_1');
    expect(request.request.headers.get('X-Pairing-Token')).toBe('poll-secret');
    request.flush({ status: 'pending', credentials: null });
    await expect(status).resolves.toEqual({ status: 'pending', credentials: null });
  });

  it('uploads the bandwidth test as octet stream', async () => {
    const result = api.bandwidthTest(new Uint8Array(16));
    const request = http.expectOne('/api/device/bandwidth-test');
    expect(request.request.headers.get('Content-Type')).toBe('application/octet-stream');
    expect(request.request.body).toBeInstanceOf(Blob);
    request.flush({ bytes: 16, serverMs: 1 });
    await expect(result).resolves.toEqual({ bytes: 16, serverMs: 1 });
  });

  it('maps 403 device_blocked to a German message', async () => {
    const self = api.getSelf();
    http
      .expectOne('/api/device/me')
      .flush(
        { status: 403, code: 'device_blocked', detail: 'Das Gerät ist gesperrt.' },
        { status: 403, statusText: 'Forbidden' },
      );
    const error = (await self.catch((reason: unknown) => reason)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(403);
    expect(error.isBlocked).toBe(true);
    expect(error.message).toBe('Dieses Gerät ist gesperrt. Die Regie kann es wieder freigeben.');
  });

  it('maps 410 pairing_expired', async () => {
    const redeem = api.redeemInvite('tok', {
      clientId: 'cli_x1234567',
      name: null,
      kind: 'phone',
      platform: 'x',
    });
    http
      .expectOne('/api/pairing/invites/tok/redeem')
      .flush({ code: 'pairing_expired' }, { status: 410, statusText: 'Gone' });
    await expect(redeem).rejects.toMatchObject({ status: 410, code: 'pairing_expired' });
  });

  it('maps 429 with Retry-After into a German retry hint', async () => {
    const created = api.createPairingRequest({ name: 'x', kind: 'laptop', platform: 'x' });
    http
      .expectOne('/api/pairing/requests')
      .flush(
        { code: 'rate_limited' },
        { status: 429, statusText: 'Too Many', headers: { 'Retry-After': '120' } },
      );
    const error = (await created.catch((reason: unknown) => reason)) as ApiError;
    expect(error.retryAfterSeconds).toBe(120);
    expect(error.message).toBe('Zu viele Versuche. Bitte in 2 Minuten noch einmal versuchen.');
  });

  it('maps a network failure to status 0', async () => {
    const self = api.getSelf();
    http.expectOne('/api/device/me').error(new ProgressEvent('error'));
    const error = (await self.catch((reason: unknown) => reason)) as ApiError;
    expect(error.status).toBe(0);
    expect(error.isNetwork).toBe(true);
    expect(error.isTransient).toBe(true);
    expect(error.message).toContain('nicht erreichbar');
  });

  it('maps 503 service_unavailable to a calm, retryable message', async () => {
    const self = api.getSelf();
    http
      .expectOne('/api/device/me')
      .flush(
        { code: 'service_unavailable', detail: 'Die Datenbank ist nicht erreichbar.' },
        { status: 503, statusText: 'Service Unavailable' },
      );
    const error = (await self.catch((reason: unknown) => reason)) as ApiError;
    expect(error.isUnavailable).toBe(true);
    expect(error.isTransient).toBe(true);
    expect(error.message).toBe(
      'Der Server ist gerade nicht erreichbar. Bitte gleich noch einmal versuchen.',
    );
    expect(new ApiError(502, null, 'x').isUnavailable).toBe(true);
    expect(new ApiError(500, 'internal_error', 'x').isUnavailable).toBe(false);
  });

  it('uses the first field error of a validation problem', async () => {
    const created = api.createPairingRequest({ name: '', kind: 'laptop', platform: 'x' });
    http
      .expectOne('/api/pairing/requests')
      .flush(
        { code: 'validation_failed', errors: { name: ['Der Name darf nicht leer sein.'] } },
        { status: 400, statusText: 'Bad Request' },
      );
    await expect(created).rejects.toMatchObject({ message: 'Der Name darf nicht leer sein.' });
  });
});

describe('Retry-After', () => {
  it('parses seconds and HTTP dates', () => {
    expect(parseRetryAfter('30')).toBe(30);
    expect(parseRetryAfter(null)).toBeNull();
    const now = Date.parse('2026-10-22T12:00:00Z');
    expect(parseRetryAfter('Thu, 22 Oct 2026 12:01:00 GMT', now)).toBe(60);
  });

  it('formats German hints', () => {
    expect(formatRetryAfter(1)).toBe('in 1 Sekunde');
    expect(formatRetryAfter(40)).toBe('in 40 Sekunden');
    expect(formatRetryAfter(61)).toBe('in 2 Minuten');
    expect(formatRetryAfter(null)).toBe('später');
  });
});
