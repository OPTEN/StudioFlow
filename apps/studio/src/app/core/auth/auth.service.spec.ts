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

  async function signIn(): Promise<void> {
    const login = auth.login('admin', 'secret');
    http.expectOne('/api/auth/login').flush({ username: 'admin' });
    await login;
  }

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
    await flushMicrotasks();
    http.expectOne('/api/auth/setup').flush({ setupRequired: false });
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

  it('stays signed in and rejects when the logout did not reach the server (the session is still valid)', async () => {
    await signIn();
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    const stopped = vi.fn();
    auth.onSignedOut(stopped);
    const done = auth.logout().catch((error: unknown) => error);
    http
      .expectOne('/api/auth/logout')
      .flush({ code: 'service_unavailable' }, { status: 503, statusText: 'Service Unavailable' });
    await expect(done).resolves.toMatchObject({ status: 503, code: 'service_unavailable' });
    expect(auth.status()).toBe('authenticated');
    expect(stopped).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('a hub 401 during the logout stops the connections once and opens the plain login page', async () => {
    await signIn();
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const navigateByUrl = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    vi.spyOn(router, 'url', 'get').mockReturnValue('/monitoring');
    const stopped = vi.fn();
    auth.onSignedOut(stopped);

    const done = auth.logout();
    // The server closed the hub of the session; its reconnect met a 401 before the logout answered.
    auth.handleUnauthorized();
    http.expectOne('/api/auth/logout').flush(null, { status: 204, statusText: 'No Content' });
    await done;

    expect(stopped).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();
    expect(navigateByUrl).toHaveBeenCalledWith('/login');
    expect(auth.status()).toBe('anonymous');
  });

  it('runs the sign-out handlers only once for repeated refusals', async () => {
    await signIn();
    vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const stopped = vi.fn();
    auth.onSignedOut(stopped);
    auth.handleUnauthorized();
    auth.handleUnauthorized();
    expect(stopped).toHaveBeenCalledTimes(1);
  });

  it('reports whether the first-run setup is open', async () => {
    const open = auth.fetchSetupRequired();
    http.expectOne('/api/auth/setup').flush({ setupRequired: true });
    await expect(open).resolves.toBe(true);

    const closed = auth.fetchSetupRequired();
    http.expectOne('/api/auth/setup').flush({ setupRequired: false });
    await expect(closed).resolves.toBe(false);
  });

  it('reports an unreachable server as unknown instead of throwing', async () => {
    const result = auth.fetchSetupRequired();
    http.expectOne('/api/auth/setup').error(new ProgressEvent('error'), { status: 0 });
    await expect(result).resolves.toBeNull();
  });

  it('signs the new account in after the first-run setup', async () => {
    const done = auth.completeSetup('K7QM-3XD2', 'regie', 'a-long-passphrase');
    const request = http.expectOne('/api/auth/setup');
    expect(request.request.body).toEqual({
      setupCode: 'K7QM-3XD2',
      username: 'regie',
      password: 'a-long-passphrase',
    });
    request.flush({ username: 'regie' });
    await expect(done).resolves.toEqual({ username: 'regie' });
    expect(auth.status()).toBe('authenticated');
    expect(auth.session()).toEqual({ username: 'regie' });
  });

  it('stays signed out when the first-run setup is refused, and passes the reason on', async () => {
    const done = auth
      .completeSetup('AAAA-AAAA', 'regie', 'a-long-passphrase')
      .catch((e: unknown) => e);
    http
      .expectOne('/api/auth/setup')
      .flush({ code: 'setup_code_invalid' }, { status: 403, statusText: 'Forbidden' });
    await expect(done).resolves.toMatchObject({ status: 403, code: 'setup_code_invalid' });
    expect(auth.status()).toBe('unknown');
  });

  it('does not treat a refused first-run setup as an expired session', async () => {
    const stopped = vi.fn();
    auth.onSignedOut(stopped);
    const setup = auth.completeSetup('x', 'regie', 'y').catch(() => undefined);
    http
      .expectOne('/api/auth/setup')
      .flush({ code: 'setup_code_invalid' }, { status: 403, statusText: 'Forbidden' });
    await setup;
    expect(stopped).not.toHaveBeenCalled();
  });

  it('changes the password and keeps the session', async () => {
    await signIn();
    const done = auth.changePassword('old-passphrase-1', 'new-passphrase-2');
    const request = http.expectOne('/api/auth/password');
    expect(request.request.body).toEqual({
      currentPassword: 'old-passphrase-1',
      newPassword: 'new-passphrase-2',
    });
    request.flush(null, { status: 204, statusText: 'No Content' });
    await done;
    expect(auth.status()).toBe('authenticated');
  });

  it('accepts only in-app paths as next', () => {
    expect(safeNextPath('/monitoring')).toBe('/monitoring');
    expect(safeNextPath('https://evil.test')).toBe('/');
    expect(safeNextPath('//evil.test')).toBe('/');
    expect(safeNextPath('/login?next=/x')).toBe('/');
    expect(safeNextPath('/setup')).toBe('/');
    expect(safeNextPath(null)).toBe('/');
  });
});
