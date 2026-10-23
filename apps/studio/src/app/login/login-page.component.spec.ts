import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { flushMicrotasks } from '../../testing/fake-studio-hub';
import { csrfInterceptor } from '../core/api/csrf.interceptor';
import { LoginPageComponent, loginErrorMessage } from './login-page.component';
import { ApiError } from '../core/api/api-error';

describe('LoginPageComponent', () => {
  let fixture: ComponentFixture<LoginPageComponent>;
  let http: HttpTestingController;
  let element: HTMLElement;

  async function setup(): Promise<void> {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([csrfInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(LoginPageComponent);
    element = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    http
      .expectOne('/api/auth/me')
      .flush({ code: 'unauthorized' }, { status: 401, statusText: 'Unauthorized' });
    await fixture.whenStable();
  }

  function fill(username: string, password: string): void {
    const [user, pass] = Array.from(element.querySelectorAll('input'));
    user.value = username;
    user.dispatchEvent(new Event('input'));
    pass.value = password;
    pass.dispatchEvent(new Event('input'));
  }

  async function submit(): Promise<void> {
    element.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true }));
    fixture.detectChanges();
    await flushMicrotasks();
  }

  async function render(): Promise<void> {
    await flushMicrotasks();
    fixture.detectChanges();
    await fixture.whenStable();
  }

  function errorText(): string {
    return element.querySelector('.c-login__error')?.textContent?.trim() ?? '';
  }

  afterEach(() => http.verify());

  it('shows the console look with the brand and «Anmelden»', async () => {
    await setup();
    expect(element.querySelector('h1')?.textContent).toContain('StudioFlow');
    expect(element.querySelector('button[type="submit"]')?.textContent?.trim()).toBe('Anmelden');
  });

  it('asks for both fields before sending anything', async () => {
    await setup();
    await submit();
    await render();
    expect(errorText()).toBe('Bitte Benutzername und Passwort eingeben.');
    http.expectNone('/api/auth/login');
  });

  it('reports wrong credentials', async () => {
    await setup();
    fill('admin', 'falsch');
    await submit();
    const request = http.expectOne('/api/auth/login');
    expect(request.request.body).toEqual({ username: 'admin', password: 'falsch' });
    expect(request.request.headers.get('X-StudioFlow')).toBe('1');
    request.flush({ code: 'unauthorized' }, { status: 401, statusText: 'Unauthorized' });
    await render();
    expect(errorText()).toBe('Benutzername oder Passwort ist falsch.');
    expect((element.querySelectorAll('input')[1] as HTMLInputElement).value).toBe('');
  });

  it('reports the lockout with the minutes from Retry-After and disables the button', async () => {
    await setup();
    fill('admin', 'x');
    await submit();
    http
      .expectOne('/api/auth/login')
      .flush(
        { code: 'rate_limited' },
        { status: 429, statusText: 'Too Many', headers: { 'Retry-After': '840' } },
      );
    await render();
    expect(errorText()).toBe('Zu viele Fehlversuche. Bitte in 14 Minuten erneut versuchen.');
    expect((element.querySelector('button[type="submit"]') as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('reports a missing server', async () => {
    await setup();
    fill('admin', 'x');
    await submit();
    http.expectOne('/api/auth/login').error(new ProgressEvent('error'), { status: 0 });
    await render();
    expect(errorText()).toBe('Keine Verbindung zum Server. Bitte nochmals versuchen.');
  });

  it('continues to the Regie after a successful login', async () => {
    await setup();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    fill('admin', 'richtig');
    await submit();
    http.expectOne('/api/auth/login').flush({ username: 'admin' });
    await render();
    expect(navigate).toHaveBeenCalledWith('/');
  });

  it('formats login errors', () => {
    expect(loginErrorMessage(new ApiError({ status: 429, code: 'rate_limited' }))).toBe(
      'Zu viele Fehlversuche. Bitte in 15 Minuten erneut versuchen.',
    );
    expect(
      loginErrorMessage(new ApiError({ status: 429, code: 'rate_limited', retryAfterSeconds: 30 })),
    ).toBe('Zu viele Fehlversuche. Bitte in 1 Minute erneut versuchen.');
  });
});
