import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter, type CanActivateFn, type UrlTree } from '@angular/router';
import { flushMicrotasks } from '../../../testing/fake-studio-hub';
import { authInterceptor } from '../api/auth.interceptor';
import { csrfInterceptor } from '../api/csrf.interceptor';
import { authGuard, loginGuard, setupGuard } from './auth.guard';

describe('guards of the login and the first-run setup', () => {
  let http: HttpTestingController;
  let router: Router;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([csrfInterceptor, authInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
  });

  afterEach(() => http.verify());

  function run(guard: CanActivateFn, url = '/'): Promise<boolean | UrlTree> {
    return TestBed.runInInjectionContext(
      () => guard({} as never, { url } as never) as Promise<boolean | UrlTree>,
    );
  }

  function url(target: boolean | UrlTree): string {
    return router.serializeUrl(target as UrlTree);
  }

  function setupStatus(setupRequired: boolean): void {
    http.expectOne('/api/auth/setup').flush({ setupRequired });
  }

  function setupStatusUnreachable(): void {
    http.expectOne('/api/auth/setup').error(new ProgressEvent('error'), { status: 0 });
  }

  function notSignedIn(): void {
    http
      .expectOne('/api/auth/me')
      .flush({ code: 'unauthorized' }, { status: 401, statusText: 'Unauthorized' });
  }

  describe('authGuard', () => {
    it('sends an anonymous visitor to the first-run setup while no account exists', async () => {
      const result = run(authGuard, '/monitoring');
      notSignedIn();
      await flushMicrotasks();
      setupStatus(true);
      expect(url(await result)).toBe('/setup');
    });

    it('sends an anonymous visitor to the login with the target once the account exists', async () => {
      const result = run(authGuard, '/monitoring');
      notSignedIn();
      await flushMicrotasks();
      setupStatus(false);
      expect(url(await result)).toBe('/login?next=%2Fmonitoring');
    });

    it('sends an anonymous visitor to the login when the setup status is not reachable', async () => {
      const result = run(authGuard);
      notSignedIn();
      await flushMicrotasks();
      setupStatusUnreachable();
      expect(url(await result)).toBe('/login');
    });

    it('does not ask for the setup status of a signed-in admin', async () => {
      const result = run(authGuard);
      http.expectOne('/api/auth/me').flush({ username: 'regie' });
      await expect(result).resolves.toBe(true);
      http.expectNone('/api/auth/setup');
    });
  });

  describe('loginGuard', () => {
    it('leads to the setup while no account exists', async () => {
      const result = run(loginGuard);
      setupStatus(true);
      expect(url(await result)).toBe('/setup');
    });

    it('shows the login once the account exists', async () => {
      const result = run(loginGuard);
      setupStatus(false);
      await expect(result).resolves.toBe(true);
    });

    it('shows the login when the server cannot be reached, so its offline message can appear', async () => {
      const result = run(loginGuard);
      setupStatusUnreachable();
      await expect(result).resolves.toBe(true);
    });
  });

  describe('setupGuard', () => {
    it('shows the setup while no account exists', async () => {
      const result = run(setupGuard);
      setupStatus(true);
      await expect(result).resolves.toBe(true);
    });

    it('leads to the login once the account exists', async () => {
      const result = run(setupGuard);
      setupStatus(false);
      expect(url(await result)).toBe('/login');
    });

    it('shows the setup when the server cannot be reached, so its offline message can appear', async () => {
      const result = run(setupGuard);
      setupStatusUnreachable();
      await expect(result).resolves.toBe(true);
    });
  });
});
