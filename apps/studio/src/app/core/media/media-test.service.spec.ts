import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { MediaTestInput, MediaTestResult } from '@studioflow/media-client';
import { flushMicrotasks } from '../../../testing/fake-studio-hub';
import { csrfInterceptor } from '../api/csrf.interceptor';
import { MEDIA_TEST_RUNNER, MediaTestService } from './media-test.service';

const TRIAL = {
  room: 'mediatest-abc',
  first: {
    url: 'wss://x',
    token: 'token-1',
    identity: 'mediatest-first',
    room: 'mediatest-abc',
    expiresAt: '2026-10-27T10:00:00Z',
  },
  second: {
    url: 'wss://x',
    token: 'token-2',
    identity: 'mediatest-second',
    room: 'mediatest-abc',
    expiresAt: '2026-10-27T10:00:00Z',
  },
  expiresAt: '2026-10-27T10:02:00Z',
};

describe('MediaTestService', () => {
  let http: HttpTestingController;
  let service: MediaTestService;
  const runner = vi.fn<(input: MediaTestInput) => Promise<MediaTestResult>>();

  beforeEach(() => {
    runner.mockReset();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([csrfInterceptor])),
        provideHttpClientTesting(),
        { provide: MEDIA_TEST_RUNNER, useValue: runner },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    service = TestBed.inject(MediaTestService);
  });

  afterEach(() => http.verify());

  it('lets the server announce the address, then runs the round trip through the origin of the page', async () => {
    runner.mockResolvedValue({ ok: true, roundTripMs: 12 });
    const result = service.run('192.168.1.50');
    await flushMicrotasks();
    const request = http.expectOne('/api/settings/media/test');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ address: '192.168.1.50' });
    request.flush(TRIAL);

    expect(await result).toEqual({ ok: true, roundTripMs: 12 });
    const { protocol, host } = window.location;
    expect(runner).toHaveBeenCalledWith({
      url: `${protocol === 'https:' ? 'wss' : 'ws'}://${host}`,
      firstToken: 'token-1',
      secondToken: 'token-2',
    });
    expect(service.isOpen).toBe(true);
  });

  it('does not run anything when the server refuses the test', async () => {
    const result = service.run('192.168.1.50');
    await flushMicrotasks();
    http
      .expectOne('/api/settings/media/test')
      .flush({ code: 'broadcast_live' }, { status: 409, statusText: 'Conflict' });
    await expect(result).rejects.toMatchObject({ status: 409, code: 'broadcast_live' });
    expect(runner).not.toHaveBeenCalled();
    expect(service.isOpen).toBe(false);
  });

  it('ends an open test, once', async () => {
    runner.mockResolvedValue({ ok: false, stage: 'transport', detail: 'x' });
    const run = service.run('192.168.1.50');
    await flushMicrotasks();
    http.expectOne('/api/settings/media/test').flush(TRIAL);
    await run;

    const ending = service.end();
    const request = http.expectOne('/api/settings/media/test');
    expect(request.request.method).toBe('DELETE');
    request.flush(null, { status: 204, statusText: 'No Content' });
    await ending;

    await service.end();
    http.expectNone('/api/settings/media/test');
  });

  it('forgets the test when the address was saved, because the server ended it', async () => {
    runner.mockResolvedValue({ ok: true, roundTripMs: 5 });
    const run = service.run('192.168.1.50');
    await flushMicrotasks();
    http.expectOne('/api/settings/media/test').flush(TRIAL);
    await run;
    service.markSaved();
    await service.end();
    http.expectNone('/api/settings/media/test');
  });

  it('never rejects when ending the test fails', async () => {
    runner.mockResolvedValue({ ok: true, roundTripMs: 5 });
    const run = service.run('192.168.1.50');
    await flushMicrotasks();
    http.expectOne('/api/settings/media/test').flush(TRIAL);
    await run;
    const ending = service.end();
    http.expectOne('/api/settings/media/test').error(new ProgressEvent('error'));
    await expect(ending).resolves.toBeUndefined();
  });
});
