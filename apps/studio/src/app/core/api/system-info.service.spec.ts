import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { flushMicrotasks } from '../../../testing/fake-studio-hub';
import { csrfInterceptor } from './csrf.interceptor';
import { SystemInfoService } from './system-info.service';

describe('SystemInfoService', () => {
  let http: HttpTestingController;
  let service: SystemInfoService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([csrfInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    service = TestBed.inject(SystemInfoService);
  });

  afterEach(() => http.verify());

  it('knows nothing until the server has answered', () => {
    expect(service.info()).toBeNull();
    expect(service.version()).toBeNull();
  });

  it('loads the version once, however often it is asked', async () => {
    service.ensureLoaded();
    service.ensureLoaded();
    http
      .expectOne('/api/system/info')
      .flush({ version: '0.1.0+1a2b3c4', publicBaseUrl: 'https://regie.example.ch' });
    await flushMicrotasks();
    expect(service.version()).toBe('0.1.0+1a2b3c4');
    expect(service.info()?.publicBaseUrl).toBe('https://regie.example.ch');

    service.ensureLoaded();
    http.expectNone('/api/system/info');
  });

  it('shows a version without a commit as it is', async () => {
    service.ensureLoaded();
    http.expectOne('/api/system/info').flush({ version: '0.1.0', publicBaseUrl: '' });
    await flushMicrotasks();
    expect(service.version()).toBe('0.1.0');
  });

  it('shows nothing for an empty version', async () => {
    service.ensureLoaded();
    http.expectOne('/api/system/info').flush({ version: '  ', publicBaseUrl: '' });
    await flushMicrotasks();
    expect(service.version()).toBeNull();
  });

  it('stays silent when the request fails and asks again next time', async () => {
    service.ensureLoaded();
    http
      .expectOne('/api/system/info')
      .flush({ title: 'Unauthorized' }, { status: 401, statusText: 'Unauthorized' });
    await flushMicrotasks();
    expect(service.version()).toBeNull();

    service.ensureLoaded();
    http.expectOne('/api/system/info').flush({ version: '0.2.0', publicBaseUrl: '' });
    await flushMicrotasks();
    expect(service.version()).toBe('0.2.0');
  });
});
