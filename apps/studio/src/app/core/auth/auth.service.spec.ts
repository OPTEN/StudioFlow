import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter, type UrlTree } from '@angular/router';
import { flushMicrotasks } from '../../../testing/fake-studio-hub';
import { StudioApiService } from '../api/studio-api.service';
import { authInterceptor } from '../api/auth.interceptor';
import { csrfInterceptor } from '../api/csrf.interceptor';
import { authGuard } from './auth.guard';
import { AuthService, safeNextPath } from './auth.service';

describe('AuthService and authGuard', () => {
  let auth: AuthService;
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
    auth = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
  });

  afterEach(() => http.verify());

  function runGuard(url: string): Promise<boolean | UrlTree> {
    return TestBed.runInInjectionContext(
      () => authGuard({} as never, { url } as never) as Promise<boolean | UrlTree>,
    );
  }

  it('lets a signed-in admin pass and caches the session', async () => {
    const result = runGuard('/');
    http.expectOne('/api/auth/me').flush({ username: 'admin' });
    await expect(result).resolves.toBe(true);
    expect(auth.session()).toEqual({ username: 'admin' });
    await expect(runGuard('/monitoring')).resolves.toBe(true);
  });

  it('sends anonymous visitors to the login with the target as next', async () => {
    const result = runGuard('/monitoring');
    http
      .expectOne('/api/auth/me')
      .flush({ code: 'unauthorized' }, { status: 401, statusText: 'Unauthorized' });
    const tree = (await result) as UrlTree;
    expect(router.serializeUrl(tree)).toBe('/login?next=%2Fmonitoring');
  });

  it('lets the operator through when the server is unreachable', async () => {
    const result = runGuard('/');
    http.expectOne('/api/auth/me').error(new ProgressEvent('error'), { status: 0 });
    await expect(result).resolves.toBe(true);
    expect(auth.status()).toBe('unknown');
  });

  it('handles an expired session from any API call: signed out, handlers run, login page', async () => {
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const stopped = vi.fn();
    auth.onSignedOut(stopped);
    const api = TestBed.inject(StudioApiService);
    const call = api.listProductions().catch(() => undefined);
    http
      .expectOne('/api/productions')
      .flush({ code: 'unauthorized' }, { status: 401, statusText: 'Unauthorized' });
    await call;
    await flushMicrotasks();
    expect(stopped).toHaveBeenCalled();
    expect(auth.status()).toBe('anonymous');
    expect(navigate).toHaveBeenCalledWith(['/login'], { queryParams: {} });
  });

  it('does not treat a wrong password as an expired session', async () => {
    const stopped = vi.fn();
    auth.onSignedOut(stopped);
    const login = auth.login('admin', 'x').catch((error: unknown) => error);
    http
      .expectOne('/api/auth/login')
      .flush({ code: 'unauthorized' }, { status: 401, statusText: 'Unauthorized' });
    await login;
    expect(stopped).not.toHaveBeenCalled();
  });

  it('signs out even when the server call fails', async () => {
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    const done = auth.logout();
    http.expectOne('/api/auth/logout').flush(null, { status: 401, statusText: 'Unauthorized' });
    await done;
    expect(auth.status()).toBe('anonymous');
    expect(navigate).toHaveBeenCalledWith('/login');
  });

  it('accepts only in-app paths as next', () => {
    expect(safeNextPath('/monitoring')).toBe('/monitoring');
    expect(safeNextPath('https://evil.test')).toBe('/');
    expect(safeNextPath('//evil.test')).toBe('/');
    expect(safeNextPath('/login?next=/x')).toBe('/');
    expect(safeNextPath(null)).toBe('/');
  });
});
