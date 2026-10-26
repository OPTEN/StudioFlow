import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { Mock } from 'vitest';

import { flushMicrotasks } from '../../../testing/fake-studio-hub';
import { csrfInterceptor } from '../../core/api/csrf.interceptor';
import { AuthService } from '../../core/auth/auth.service';
import { ToastService } from '../../core/ui/toast.service';
import { ChangePasswordFormComponent } from './change-password-form.component';

const CURRENT = 'old-passphrase-1';
const NEW = 'new-passphrase-2';

describe('ChangePasswordFormComponent', () => {
  let fixture: ComponentFixture<ChangePasswordFormComponent>;
  let http: HttpTestingController;
  let element: HTMLElement;
  let done: Mock<() => void>;
  let cancelled: Mock<() => void>;

  async function setup(username = 'regie'): Promise<void> {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([csrfInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(AuthService).session.set({ username });
    fixture = TestBed.createComponent(ChangePasswordFormComponent);
    done = vi.fn<() => void>();
    cancelled = vi.fn<() => void>();
    fixture.componentInstance.done.subscribe(done);
    fixture.componentInstance.cancelled.subscribe(cancelled);
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

  function fill(current = CURRENT, password = NEW, repeat = password): void {
    type('change-current', current);
    type('change-password', password);
    type('change-repeat', repeat);
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
    return element.querySelector('.c-field-error:not([id])')?.textContent?.trim() ?? '';
  }

  function buttons(): string[] {
    return Array.from(element.querySelectorAll('button')).map((b) => b.textContent?.trim() ?? '');
  }

  afterEach(() => http.verify());

  it('shows three labelled password fields, the hint and the two buttons', async () => {
    await setup();
    const labels = Array.from(element.querySelectorAll('label')).map((l) => l.textContent?.trim());
    expect(labels).toEqual(['Current password', 'New password', 'Repeat new password']);
    for (const label of Array.from(element.querySelectorAll('label'))) {
      expect(element.querySelector(`#${label.htmlFor}`)).not.toBeNull();
    }
    expect(input('change-current').autocomplete).toBe('current-password');
    expect(input('change-password').autocomplete).toBe('new-password');
    expect(element.textContent).toContain('At least 12 characters');
    expect(element.textContent).toContain('All other sessions are signed out.');
    expect(buttons()).toEqual(['Change password', 'Cancel']);
  });

  it('shows no error before a field was left, then explains the empty current password', async () => {
    await setup();
    expect(element.querySelectorAll('.c-field-error')).toHaveLength(0);
    leave('change-current');
    await render();
    expect(errorOf('change-current')).toBe('Enter your current password.');
    expect(input('change-current').getAttribute('aria-invalid')).toBe('true');
  });

  it('applies the password rules to the new password, including the username of the session', async () => {
    await setup('a-long-passphrase');
    type('change-password', 'short');
    leave('change-password');
    await render();
    expect(errorOf('change-password')).toBe('The password needs at least 12 characters.');
    type('change-password', 'A-Long-Passphrase');
    await render();
    expect(errorOf('change-password')).toBe('The password must differ from the username.');
    type('change-password', NEW);
    await render();
    expect(errorOf('change-password')).toBeNull();
  });

  it('compares the repeat with the new password, also when the password changes later', async () => {
    await setup();
    type('change-password', NEW);
    type('change-repeat', 'new-passphrase-3');
    leave('change-repeat');
    await render();
    expect(errorOf('change-repeat')).toBe('The passwords do not match.');
    type('change-repeat', NEW);
    await render();
    expect(errorOf('change-repeat')).toBeNull();
    type('change-password', 'yet-another-passphrase');
    await render();
    expect(errorOf('change-repeat')).toBe('The passwords do not match.');
  });

  it('sends nothing and focuses the first invalid field when submitted incomplete', async () => {
    await setup();
    fill(CURRENT, 'short');
    await submit();
    await render();
    http.expectNone('/api/auth/password');
    expect(document.activeElement).toBe(input('change-password'));
    expect(done).not.toHaveBeenCalled();
  });

  it('changes the password, confirms with a toast and reports done', async () => {
    await setup();
    fill();
    await submit();
    const request = http.expectOne('/api/auth/password');
    expect(request.request.body).toEqual({ currentPassword: CURRENT, newPassword: NEW });
    expect(request.request.headers.get('X-StudioFlow')).toBe('1');
    expect((element.querySelector('button[type="submit"]') as HTMLButtonElement).disabled).toBe(
      true,
    );
    request.flush(null, { status: 204, statusText: 'No Content' });
    await render();
    expect(done).toHaveBeenCalledTimes(1);
    expect(TestBed.inject(ToastService).current()?.message).toBe(
      'Password changed. All other sessions were signed out.',
    );
    expect(TestBed.inject(AuthService).status()).toBe('unknown');
  });

  it('ignores a second submit while the first one is running', async () => {
    await setup();
    fill();
    await submit();
    await submit();
    http.expectOne('/api/auth/password').flush(null, { status: 204, statusText: 'No Content' });
    await render();
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('puts a wrong current password next to its field and stays open', async () => {
    await setup();
    fill();
    await submit();
    http
      .expectOne('/api/auth/password')
      .flush(
        { code: 'password_incorrect', errors: { currentPassword: ['password_incorrect'] } },
        { status: 400, statusText: 'Bad Request' },
      );
    await render();
    expect(errorOf('change-current')).toBe('The current password is not correct.');
    expect(document.activeElement).toBe(input('change-current'));
    expect(done).not.toHaveBeenCalled();
    expect(input('change-password').value).toBe(NEW);
    type('change-current', 'x');
    await render();
    expect(errorOf('change-current')).toBeNull();
  });

  it('puts a common password from the API next to the new password field', async () => {
    await setup();
    fill(CURRENT, 'studioflow2026');
    await submit();
    http
      .expectOne('/api/auth/password')
      .flush(
        { code: 'validation_failed', errors: { newPassword: ['password_too_common'] } },
        { status: 400, statusText: 'Bad Request' },
      );
    await render();
    expect(errorOf('change-password')).toBe(
      'This password is too common. Please choose another one.',
    );
  });

  it('reports the lockout and a missing server as a general message', async () => {
    await setup();
    fill();
    await submit();
    http
      .expectOne('/api/auth/password')
      .flush(
        { code: 'rate_limited' },
        { status: 429, statusText: 'Too Many', headers: { 'Retry-After': '120' } },
      );
    await render();
    expect(generalError()).toBe('Too many attempts. Please try again in 2 minutes.');
    await submit();
    http.expectOne('/api/auth/password').error(new ProgressEvent('error'), { status: 0 });
    await render();
    expect(generalError()).toBe('No connection to the server. Please try again.');
  });

  it('reports cancelled without sending anything', async () => {
    await setup();
    fill();
    (element.querySelectorAll('button')[1] as HTMLButtonElement).click();
    expect(cancelled).toHaveBeenCalledTimes(1);
    http.expectNone('/api/auth/password');
  });
});
