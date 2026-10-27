import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import {
  Router,
  provideRouter,
  type ActivatedRouteSnapshot,
  type RouterStateSnapshot,
  type UrlTree,
} from '@angular/router';
import {
  configuredSettingsFixture,
  serverSettingsFixture,
} from '../../../testing/settings-fixtures';
import { csrfInterceptor } from '../api/csrf.interceptor';
import { SERVER_SETUP_PATH, configuredGuard, wizardGuard } from './server-settings.guard';

describe('server settings guards', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([csrfInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  /** Lets the guard promise chain run up to its next request. */
  function settle(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve));
  }

  function run(guard: typeof configuredGuard): Promise<boolean | UrlTree> {
    return TestBed.runInInjectionContext(() =>
      guard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot),
    ) as Promise<boolean | UrlTree>;
  }

  async function answer(
    result: Promise<boolean | UrlTree>,
    body: object | null,
  ): Promise<boolean | UrlTree> {
    await settle();
    http.expectOne('/api/auth/me').flush({ username: 'regie' });
    await settle();
    const request = http.expectOne('/api/settings');
    if (body) {
      request.flush(body);
    } else {
      request.error(new ProgressEvent('error'));
    }
    return result;
  }

  it('sends an admin who has not finished the wizard to it', async () => {
    const result = await answer(run(configuredGuard), serverSettingsFixture());
    expect(TestBed.inject(Router).serializeUrl(result as UrlTree)).toBe(SERVER_SETUP_PATH);
  });

  it('lets an admin of a configured installation into the Regie', async () => {
    expect(await answer(run(configuredGuard), configuredSettingsFixture())).toBe(true);
  });

  it('does not lock the operator out while the server cannot be reached', async () => {
    expect(await answer(run(configuredGuard), null)).toBe(true);
  });

  it.each([
    ['configuredGuard', configuredGuard],
    ['wizardGuard', wizardGuard],
  ])(
    '%s asks for no settings while nobody is signed in (authGuard redirects)',
    async (_name, guard) => {
      const result = run(guard);
      await Promise.resolve();
      http
        .expectOne('/api/auth/me')
        .flush({ code: 'unauthorized' }, { status: 401, statusText: 'Unauthorized' });
      await expect(result).resolves.toBe(true);
      http.expectNone('/api/settings');
    },
  );

  it('shows the wizard until the installation is configured', async () => {
    expect(await answer(run(wizardGuard), serverSettingsFixture())).toBe(true);
  });

  it('closes the wizard once the installation is configured', async () => {
    const result = await answer(run(wizardGuard), configuredSettingsFixture());
    expect(TestBed.inject(Router).serializeUrl(result as UrlTree)).toBe('/');
  });
});
