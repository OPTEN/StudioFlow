import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { resetLocaleForTests, tFor } from '@studioflow/i18n';
import { flushMicrotasks } from '../../testing/fake-studio-hub';
import { csrfInterceptor } from '../core/api/csrf.interceptor';
import { ToastService } from '../core/ui/toast.service';
import { SetupPageComponent } from './setup-page.component';

const GOOD_PASSWORD = 'a-long-passphrase';

describe('SetupPageComponent', () => {
  let fixture: ComponentFixture<SetupPageComponent>;
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
    fixture = TestBed.createComponent(SetupPageComponent);
    element = fixture.nativeElement as HTMLElement;
    await render();
  }

  async function render(): Promise<void> {
    await flushMicrotasks();
    fixture.detectChanges();
    await fixture.whenStable();
  }

  function input(id: string): HTMLInputElement {
    return element.querySelector<HTMLInputElement>(`#${id}`)!;
  }

  function type(id: string, value: string): void {
    const field = input(id);
    field.value = value;
    field.dispatchEvent(new Event('input'));
  }

  function leave(id: string): void {
    input(id).dispatchEvent(new Event('blur'));
  }

  function fill(code = 'K7QM-3XD2', username = 'regie', password = GOOD_PASSWORD): void {
    type('setup-code', code);
    type('setup-username', username);
    type('setup-password', password);
    type('setup-repeat', password);
  }

  async function submit(): Promise<void> {
    element.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true }));
    fixture.detectChanges();
    await flushMicrotasks();
    fixture.detectChanges();
  }

  function errorOf(id: string): string | null {
    return element.querySelector(`#${id}-error`)?.textContent?.trim() ?? null;
  }

  function generalError(): string {
    return element.querySelector('.c-login__error')?.textContent?.trim() ?? '';
  }

  function refuseSetup(status: number, body: object, headers: Record<string, string> = {}): void {
    http.expectOne('/api/auth/setup').flush(body, { status, statusText: 'Refused', headers });
  }

  afterEach(() => http.verify());

  it('shows the first-run setup with the title, an explanation and four labelled fields', async () => {
    await setup();
    expect(element.querySelector('h1')?.textContent?.trim()).toBe('Create your account');
    expect(element.querySelector('.c-setup__intro')?.textContent).toContain('setup code');
    expect(element.querySelector('.c-setup__intro')?.textContent).toContain('cannot be changed');
    const labels = Array.from(element.querySelectorAll<HTMLLabelElement>('form label')).map((l) =>
      l.textContent?.trim(),
    );
    expect(labels).toEqual(['Setup code', 'Username', 'Password', 'Repeat password']);
    for (const label of Array.from(element.querySelectorAll<HTMLLabelElement>('form label'))) {
      expect(element.querySelector(`#${label.htmlFor}`)).not.toBeNull();
    }
    expect(element.querySelector('button[type="submit"]')?.textContent?.trim()).toBe(
      'Create account',
    );
  });

  it('tells the browser what each field is for', async () => {
    await setup();
    expect(input('setup-username').autocomplete).toBe('username');
    expect(input('setup-password').autocomplete).toBe('new-password');
    expect(input('setup-repeat').autocomplete).toBe('new-password');
    expect(input('setup-password').type).toBe('password');
    expect(input('setup-code').autocomplete).toBe('off');
  });

  it('points to the server log for the code and states the password rules as a hint', async () => {
    await setup();
    expect(element.querySelector('#setup-code-hint')?.textContent).toContain(
      'docker compose logs api',
    );
    expect(element.querySelector('#setup-password-hint')?.textContent).toContain(
      'At least 12 characters',
    );
    expect(input('setup-code').getAttribute('aria-describedby')).toContain('setup-code-hint');
  });

  it('shows no error before a field was left', async () => {
    await setup();
    await render();
    expect(element.querySelectorAll('.c-field-error')).toHaveLength(0);
    expect(input('setup-code').getAttribute('aria-invalid')).toBeNull();
  });

  it('explains a field when it is left empty and marks it invalid', async () => {
    await setup();
    leave('setup-code');
    leave('setup-username');
    await render();
    expect(errorOf('setup-code')).toBe('Enter the setup code.');
    expect(errorOf('setup-username')).toBe('Enter a username.');
    expect(input('setup-code').getAttribute('aria-invalid')).toBe('true');
    expect(input('setup-code').classList).toContain('is-invalid');
  });

  it('checks the shape of the setup code and accepts it in any case, with or without hyphen', async () => {
    await setup();
    type('setup-code', 'K7QM');
    leave('setup-code');
    await render();
    expect(errorOf('setup-code')).toBe('The setup code has 8 letters and digits, like K7QM-3XD2.');
    type('setup-code', 'k7qm 3xd2');
    await render();
    expect(errorOf('setup-code')).toBeNull();
    type('setup-code', 'K7QM3XD2');
    await render();
    expect(errorOf('setup-code')).toBeNull();
  });

  it('refuses letters that never occur in a code (I, O, 0, 1)', async () => {
    await setup();
    type('setup-code', 'IIII-0000');
    leave('setup-code');
    await render();
    expect(errorOf('setup-code')).not.toBeNull();
  });

  it('refuses a username with spaces, umlauts or more than 64 characters', async () => {
    await setup();
    for (const username of ['two words', 'jane$', 'ä']) {
      type('setup-username', username);
      leave('setup-username');
      await render();
      expect(errorOf('setup-username')).toBe(
        'Use only letters, digits and . _ @ - and at most 64 characters.',
      );
    }
    type('setup-username', 'jane.m@example-ch_1');
    await render();
    expect(errorOf('setup-username')).toBeNull();
    expect(input('setup-username').maxLength).toBe(64);
  });

  it('explains a password that is too short, equal to the username or missing', async () => {
    await setup();
    leave('setup-password');
    await render();
    expect(errorOf('setup-password')).toBe('Enter a password.');
    type('setup-password', 'eleven-chars');
    await render();
    expect(errorOf('setup-password')).toBeNull();
    type('setup-password', 'short');
    await render();
    expect(errorOf('setup-password')).toBe('The password needs at least 12 characters.');
    type('setup-username', 'a-long-passphrase');
    type('setup-password', 'A-Long-Passphrase');
    await render();
    expect(errorOf('setup-password')).toBe('The password must differ from the username.');
  });

  it('rechecks the password when the username changes afterwards', async () => {
    await setup();
    type('setup-password', 'regie-regie-regie');
    leave('setup-password');
    await render();
    expect(errorOf('setup-password')).toBeNull();
    type('setup-username', 'regie-regie-regie');
    await render();
    expect(errorOf('setup-password')).toBe('The password must differ from the username.');
  });

  it('asks to repeat the password and notices a difference, also when the password changes later', async () => {
    await setup();
    leave('setup-repeat');
    await render();
    expect(errorOf('setup-repeat')).toBe('Repeat the password.');
    type('setup-password', GOOD_PASSWORD);
    type('setup-repeat', 'a-long-passphrasX');
    await render();
    expect(errorOf('setup-repeat')).toBe('The passwords do not match.');
    type('setup-repeat', GOOD_PASSWORD);
    await render();
    expect(errorOf('setup-repeat')).toBeNull();
    type('setup-password', 'another-passphrase');
    await render();
    expect(errorOf('setup-repeat')).toBe('The passwords do not match.');
  });

  it('sends nothing, shows every problem and focuses the first invalid field when submitted empty', async () => {
    await setup();
    await submit();
    await render();
    http.expectNone('/api/auth/setup');
    expect(errorOf('setup-code')).toBe('Enter the setup code.');
    expect(errorOf('setup-username')).toBe('Enter a username.');
    expect(errorOf('setup-password')).toBe('Enter a password.');
    expect(errorOf('setup-repeat')).toBe('Repeat the password.');
    expect(document.activeElement).toBe(input('setup-code'));
  });

  it('focuses the first invalid field that is not the first field', async () => {
    await setup();
    fill('K7QM-3XD2', 'regie', 'short');
    type('setup-repeat', 'short');
    await submit();
    await render();
    http.expectNone('/api/auth/setup');
    expect(document.activeElement).toBe(input('setup-password'));
  });

  it('shows the account as the first of the labelled steps of the first run', async () => {
    await setup();
    const steps = element.querySelector('ol[aria-label="Setup steps"]')!;
    expect(
      Array.from(steps.querySelectorAll('.c-steps__label')).map((label) => label.textContent),
    ).toEqual(['Account', 'Media server', 'Address', 'Embedding', 'Done']);
    expect(steps.querySelector('[aria-current="step"]')?.textContent).toContain('Account');
  });

  it('shows both passwords on request', async () => {
    await setup();
    const reveal = element.querySelector<HTMLButtonElement>('.c-login__reveal')!;
    expect(reveal.textContent?.trim()).toBe('Show passwords');
    reveal.click();
    await render();
    expect(input('setup-password').type).toBe('text');
    expect(input('setup-repeat').type).toBe('text');
    expect(reveal.getAttribute('aria-pressed')).toBe('true');
  });

  it('shows the format of the setup code as a placeholder', async () => {
    await setup();
    expect(input('setup-code').placeholder).toBe('K7QM-3XD2');
  });

  it('creates the account with the trimmed values and continues with the server wizard', async () => {
    await setup();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    fill(' k7qm-3xd2 ', ' regie ');
    await submit();
    const request = http.expectOne('/api/auth/setup');
    expect(request.request.body).toEqual({
      setupCode: 'k7qm-3xd2',
      username: 'regie',
      password: GOOD_PASSWORD,
    });
    expect(request.request.headers.get('X-StudioFlow')).toBe('1');
    expect((element.querySelector('button[type="submit"]') as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(element.querySelector('button[type="submit"]')?.textContent?.trim()).toBe(
      'Creating account…',
    );
    request.flush({ username: 'regie' });
    await render();
    expect(navigate).toHaveBeenCalledWith('/setup/server');
  });

  it('ignores a second submit while the first one is running', async () => {
    await setup();
    vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    fill();
    await submit();
    await submit();
    http.expectOne('/api/auth/setup').flush({ username: 'regie' });
    await render();
  });

  it('puts a wrong setup code next to the code field and keeps the other values', async () => {
    await setup();
    fill();
    await submit();
    refuseSetup(403, { code: 'setup_code_invalid' });
    await render();
    expect(errorOf('setup-code')).toBe(
      'The setup code is not correct. After a restart the server shows a new one.',
    );
    expect(document.activeElement).toBe(input('setup-code'));
    expect(input('setup-username').value).toBe('regie');
    expect(input('setup-password').value).toBe(GOOD_PASSWORD);
    expect((element.querySelector('button[type="submit"]') as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it('clears the message of a field as soon as that field is edited', async () => {
    await setup();
    fill();
    await submit();
    refuseSetup(403, { code: 'setup_code_invalid' });
    await render();
    type('setup-code', 'K7QM-3XD3');
    await render();
    expect(errorOf('setup-code')).toBeNull();
  });

  it('shows a common password from the API next to the password field', async () => {
    await setup();
    fill('K7QM-3XD2', 'regie', 'studioflow123');
    await submit();
    refuseSetup(400, {
      code: 'validation_failed',
      errors: { password: ['password_too_common'] },
    });
    await render();
    expect(errorOf('setup-password')).toBe(
      'This password is too common. Please choose another one.',
    );
    expect(document.activeElement).toBe(input('setup-password'));
  });

  it('shows a username the API refuses next to the username field', async () => {
    await setup();
    fill();
    await submit();
    refuseSetup(400, { code: 'validation_failed', errors: { username: ['username_invalid'] } });
    await render();
    expect(errorOf('setup-username')).toBe(
      'Use only letters, digits and . _ @ - and at most 64 characters.',
    );
  });

  it('shows a general message for a 400 without a reason it knows', async () => {
    await setup();
    fill();
    await submit();
    refuseSetup(400, { code: 'validation_failed', errors: { other: ['x'] } });
    await render();
    expect(generalError()).toBe('The input is not valid.');
  });

  it('reports the lockout with the minutes from Retry-After', async () => {
    await setup();
    fill();
    await submit();
    refuseSetup(429, { code: 'rate_limited' }, { 'Retry-After': '840' });
    await render();
    expect(generalError()).toBe('Too many attempts. Please try again in 14 minutes.');
  });

  it('reports a missing server', async () => {
    await setup();
    fill();
    await submit();
    http.expectOne('/api/auth/setup').error(new ProgressEvent('error'), { status: 0 });
    await render();
    expect(generalError()).toBe('No connection to the server. Please try again.');
  });

  it('leads to the login with a toast when the account was created meanwhile', async () => {
    await setup();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    fill();
    await submit();
    refuseSetup(409, { code: 'setup_closed' });
    await render();
    expect(navigate).toHaveBeenCalledWith('/login');
    expect(TestBed.inject(ToastService).current()?.message).toBe(
      'The first-run setup is already complete. Please sign in.',
    );
  });

  it('offers the language select below the form', async () => {
    await setup();
    expect(element.querySelector('footer sf-language-select select')).not.toBeNull();
  });

  it('switches the page, and a shown error, to German without a reload', async () => {
    await setup();
    await submit();
    await render();
    const select = element.querySelector('select') as HTMLSelectElement;
    select.value = 'de-CH';
    select.dispatchEvent(new Event('change'));
    await render();
    const de = tFor('de-CH');
    expect(element.querySelector('h1')?.textContent?.trim()).toBe(de('regie.setup.heading'));
    expect(element.querySelector('button[type="submit"]')?.textContent?.trim()).toBe(
      de('regie.setup.submit'),
    );
    expect(errorOf('setup-code')).toBe(de('regie.setup.code.required'));
    resetLocaleForTests('en');
  });
});
