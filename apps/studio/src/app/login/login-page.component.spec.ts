import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { resetLocaleForTests, tFor, tm } from '@studioflow/i18n';
import { flushMicrotasks } from '../../testing/fake-studio-hub';
import { csrfInterceptor } from '../core/api/csrf.interceptor';
import { LoginPageComponent, loginErrorMsg } from './login-page.component';
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

  it('shows the card with the mark, the title, the two fields and “Sign in”', async () => {
    await setup();
    expect(element.querySelector('h1')?.textContent?.trim()).toBe('Sign in to StudioFlow');
    expect(element.querySelector('.c-login__lead')?.textContent).toBe(
      'Use the account of this control room.',
    );
    const labels = Array.from(element.querySelectorAll('label.c-login__label')).map((label) =>
      label.textContent?.trim(),
    );
    expect(labels).toEqual(['Username', 'Password']);
    expect(element.querySelector('button[type="submit"]')?.textContent?.trim()).toBe('Sign in');
  });

  it('shows the password on request and hides it again', async () => {
    await setup();
    const password = element.querySelectorAll('input')[1] as HTMLInputElement;
    const reveal = element.querySelector<HTMLButtonElement>('.c-login__reveal')!;
    expect(password.type).toBe('password');
    expect(reveal.getAttribute('aria-pressed')).toBe('false');
    expect(reveal.textContent?.trim()).toBe('Show password');
    reveal.click();
    await render();
    expect(password.type).toBe('text');
    expect(reveal.getAttribute('aria-pressed')).toBe('true');
    reveal.click();
    await render();
    expect(password.type).toBe('password');
  });

  it('explains how a forgotten password is reset on the server', async () => {
    await setup();
    const forgot = Array.from(element.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Forgot your password?',
    )!;
    expect(forgot.getAttribute('aria-expanded')).toBe('false');
    expect(element.querySelector('#login-forgot')).toBeNull();
    forgot.click();
    await render();
    expect(forgot.getAttribute('aria-expanded')).toBe('true');
    expect(element.querySelector('#login-forgot code')?.textContent).toContain('reset-admin');
  });

  it('names the sponsor below the card', async () => {
    await setup();
    const sponsor = element.querySelector<HTMLAnchorElement>('[data-testid="login-sponsor"]')!;
    expect(sponsor.textContent?.replace(/\s+/g, ' ').trim()).toBe('Sponsored by OPTEN');
    expect(sponsor.getAttribute('href')).toBe('https://www.opten.ch');
    expect(sponsor.getAttribute('rel')).toBe('noopener');
  });

  it('asks for both fields before sending anything', async () => {
    await setup();
    await submit();
    await render();
    expect(errorText()).toBe('Please enter your username and password.');
    http.expectNone('/api/auth/login');
  });

  it('reports wrong credentials', async () => {
    await setup();
    fill('admin', 'wrong');
    await submit();
    const request = http.expectOne('/api/auth/login');
    expect(request.request.body).toEqual({ username: 'admin', password: 'wrong' });
    expect(request.request.headers.get('X-StudioFlow')).toBe('1');
    request.flush({ code: 'unauthorized' }, { status: 401, statusText: 'Unauthorized' });
    await render();
    expect(errorText()).toBe('Wrong username or password.');
    expect((element.querySelectorAll('input')[1] as HTMLInputElement).value).toBe('');
  });

  it('puts the focus back on the password field after a failed login', async () => {
    await setup();
    document.body.append(element);
    fill('admin', 'wrong');
    await submit();
    http
      .expectOne('/api/auth/login')
      .flush({ code: 'unauthorized' }, { status: 401, statusText: 'Unauthorized' });
    await render();
    expect(document.activeElement).toBe(element.querySelectorAll('input')[1]);
    element.remove();
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
    expect(errorText()).toBe('Too many failed attempts. Please try again in 14 minutes.');
    const button = element.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-describedby')).toBe('login-error');
  });

  it('reports a missing server', async () => {
    await setup();
    fill('admin', 'x');
    await submit();
    http.expectOne('/api/auth/login').error(new ProgressEvent('error'), { status: 0 });
    await render();
    expect(errorText()).toBe('No connection to the server. Please try again.');
  });

  it('continues to the Regie after a successful login', async () => {
    await setup();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    fill('admin', 'right');
    await submit();
    http.expectOne('/api/auth/login').flush({ username: 'admin' });
    await render();
    expect(navigate).toHaveBeenCalledWith('/');
  });

  it('formats login errors', () => {
    expect(tm(loginErrorMsg(new ApiError({ status: 429, code: 'rate_limited' })))).toBe(
      'Too many failed attempts. Please try again in 15 minutes.',
    );
    expect(
      tm(loginErrorMsg(new ApiError({ status: 429, code: 'rate_limited', retryAfterSeconds: 30 }))),
    ).toBe('Too many failed attempts. Please try again in 1 minute.');
  });

  it('offers the language select below the form', async () => {
    await setup();
    expect(element.querySelector('footer sf-language-select select')).not.toBeNull();
  });

  it('switches the whole page to German without a reload', async () => {
    await setup();
    const select = element.querySelector('select') as HTMLSelectElement;
    select.value = 'de-CH';
    select.dispatchEvent(new Event('change'));
    await render();
    expect(element.querySelector('button[type="submit"]')?.textContent?.trim()).toBe(
      tFor('de-CH')('regie.login.submit'),
    );
    expect(element.querySelector('.c-login__lead')?.textContent).toBe(
      tFor('de-CH')('regie.login.lead'),
    );
    resetLocaleForTests('en');
  });

  it('keeps an error on screen in step with the language', async () => {
    await setup();
    await submit();
    await render();
    expect(errorText()).toBe('Please enter your username and password.');
    const select = element.querySelector('select') as HTMLSelectElement;
    select.value = 'de-CH';
    select.dispatchEvent(new Event('change'));
    await render();
    expect(errorText()).toBe(tFor('de-CH')('regie.login.error.required'));
    resetLocaleForTests('en');
  });
});
