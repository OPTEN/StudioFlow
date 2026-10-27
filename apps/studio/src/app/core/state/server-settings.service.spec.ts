import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { flushMicrotasks } from '../../../testing/fake-studio-hub';
import {
  appliedStatusFixture,
  configuredSettingsFixture,
  serverSettingsFixture,
} from '../../../testing/settings-fixtures';
import { csrfInterceptor } from '../api/csrf.interceptor';
import { ServerSettingsService } from './server-settings.service';

describe('ServerSettingsService', () => {
  let http: HttpTestingController;
  let service: ServerSettingsService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([csrfInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    service = TestBed.inject(ServerSettingsService);
  });

  afterEach(() => http.verify());

  it('knows nothing until the server has answered, then shares one request', async () => {
    expect(service.settings()).toBeNull();
    expect(service.configured()).toBeNull();
    const first = service.load();
    const second = service.load();
    http.expectOne('/api/settings').flush(serverSettingsFixture());
    await Promise.all([first, second]);
    expect(service.configured()).toBe(false);
    expect(service.settings()?.baseUrl).toBe('https://localhost:8443');
  });

  it('takes the whole settings from every save', async () => {
    const saved = service.saveMedia('192.168.1.50');
    const request = http.expectOne('/api/settings/media');
    expect(request.request.method).toBe('PUT');
    expect(request.request.body).toEqual({ address: '192.168.1.50' });
    expect(request.request.headers.get('X-StudioFlow')).toBe('1');
    request.flush(configuredSettingsFixture());
    await saved;
    expect(service.configured()).toBe(true);
    expect(service.settings()?.media.address).toBe('192.168.1.50');
  });

  it('sends each section to its own route', async () => {
    const calls: [Promise<unknown>, string, string][] = [
      [
        service.saveAddress({
          tlsMode: 'internal',
          domain: null,
          acmeEmail: null,
          dnsChallengeDomain: null,
          dnsCredentials: null,
        }),
        'PUT',
        '/api/settings/address',
      ],
      [
        service.uploadCertificate({ certificatePem: 'c', privateKeyPem: 'k', domain: null }),
        'PUT',
        '/api/settings/certificate',
      ],
      [service.saveEmbedding({ origins: [] }), 'PUT', '/api/settings/embedding'],
      [
        service.saveBackup({
          schedule: null,
          timezone: null,
          keepDaily: 7,
          keepWeekly: 4,
          rcloneRemote: null,
          rcloneConfig: null,
          ageRecipients: [],
          offsiteUnencrypted: false,
        }),
        'PUT',
        '/api/settings/backup',
      ],
    ];
    for (const [, method, url] of calls) {
      const request = http.expectOne(url);
      expect(request.request.method).toBe(method);
      request.flush(serverSettingsFixture());
    }
    await Promise.all(calls.map(([promise]) => promise));
  });

  describe('ensureConfigured', () => {
    it('asks the server and reports an unfinished installation', async () => {
      const result = service.ensureConfigured();
      http.expectOne('/api/settings').flush(serverSettingsFixture());
      expect(await result).toBe(false);
    });

    it('does not ask again once the installation is configured', async () => {
      const first = service.ensureConfigured();
      http.expectOne('/api/settings').flush(configuredSettingsFixture());
      expect(await first).toBe(true);
      expect(await service.ensureConfigured()).toBe(true);
      http.expectNone('/api/settings');
    });

    it('lets the operator through when the server cannot be reached', async () => {
      const result = service.ensureConfigured();
      http.expectOne('/api/settings').error(new ProgressEvent('error'));
      expect(await result).toBeNull();
    });

    it('leaves a refused session to the login page', async () => {
      const result = service.ensureConfigured();
      http.expectOne('/api/settings').flush({}, { status: 401, statusText: 'Unauthorized' });
      expect(await result).toBe(true);
    });
  });

  describe('waitUntilApplied', () => {
    const noWait = (): Promise<void> => Promise.resolve();

    it('returns as soon as the named services run the settings', async () => {
      const waiting = service.waitUntilApplied(['caddy', 'liveKit'], 5000, noWait);
      await flushMicrotasks();
      http
        .expectOne('/api/settings/status')
        .flush(appliedStatusFixture({ backup: { applied: false, error: null } }));
      expect(await waiting).toEqual({ applied: true, failed: [] });
    });

    it('asks again while a service has not taken the settings over yet', async () => {
      const waiting = service.waitUntilApplied(['liveKit'], 60_000, noWait);
      await flushMicrotasks();
      http
        .expectOne('/api/settings/status')
        .flush(appliedStatusFixture({ liveKit: { applied: false, error: null } }));
      await flushMicrotasks();
      http.expectOne('/api/settings/status').flush(appliedStatusFixture());
      expect(await waiting).toEqual({ applied: true, failed: [] });
    });

    it('stops at once when a service reports an error, and names it', async () => {
      const waiting = service.waitUntilApplied(['caddy', 'liveKit'], 60_000, noWait);
      await flushMicrotasks();
      http
        .expectOne('/api/settings/status')
        .flush(appliedStatusFixture({ caddy: { applied: false, error: 'bad config' } }));
      expect(await waiting).toEqual({
        applied: false,
        failed: [{ target: 'caddy', error: 'bad config' }],
      });
    });

    it('gives up when the time is over', async () => {
      vi.useFakeTimers();
      try {
        const waiting = service.waitUntilApplied(
          ['caddy'],
          2000,
          (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        );
        await vi.advanceTimersByTimeAsync(0);
        for (let attempt = 0; attempt < 4; attempt++) {
          const open = http.match('/api/settings/status');
          for (const request of open) {
            request.flush(appliedStatusFixture({ caddy: { applied: false, error: null } }));
          }
          await vi.advanceTimersByTimeAsync(1000);
        }
        expect(await waiting).toEqual({ applied: false, failed: [] });
      } finally {
        vi.useRealTimers();
      }
    });

    it('keeps waiting through a moment without an answer', async () => {
      const waiting = service.waitUntilApplied(['caddy'], 60_000, noWait);
      await flushMicrotasks();
      http.expectOne('/api/settings/status').error(new ProgressEvent('error'));
      await flushMicrotasks();
      http.expectOne('/api/settings/status').flush(appliedStatusFixture());
      expect((await waiting).applied).toBe(true);
    });
  });
});
