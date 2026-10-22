import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiError, minutesText, toGermanMessage } from '../core/api/api-error';
import { AuthService, safeNextPath } from '../core/auth/auth.service';
import { ClockService } from '../core/ui/clock.service';
import { IconComponent } from '../core/ui/icon.component';

/** Default lockout when the server sends 429 without Retry-After (spec 5: 15 minutes). */
const DEFAULT_LOCKOUT_SECONDS = 15 * 60;

/** German text for a failed login. */
export function loginErrorMessage(error: unknown): string {
  const apiError = ApiError.from(error);
  if (apiError.status === 401) {
    return 'Benutzername oder Passwort ist falsch.';
  }
  if (apiError.status === 429) {
    return `Zu viele Fehlversuche. Bitte in ${minutesText(apiError.retryAfterSeconds ?? DEFAULT_LOCKOUT_SECONDS)} erneut versuchen.`;
  }
  return toGermanMessage(apiError);
}

/**
 * Login of the Regie (`/login`, spec 5): one admin account. Dark console look with the brand mark, typed reactive
 * form, errors for wrong credentials, lockout (429 with Retry-After, the button stays disabled until it ends) and a
 * missing server. After success it continues to `?next=` (in-app paths only) or `/`.
 */
@Component({
  selector: 'fs-login-page',
  imports: [IconComponent, ReactiveFormsModule],
  templateUrl: './login-page.component.html',
  styleUrl: './login-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoginPageComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly clock = inject(ClockService);

  protected readonly form = new FormGroup({
    username: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    password: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
  });
  protected readonly submitting = signal(false);
  protected readonly error = signal<string | null>(null);
  private readonly lockedUntil = signal<number | null>(null);

  /** True while the lockout of a 429 lasts. */
  protected readonly locked = computed(() => {
    const until = this.lockedUntil();
    return until !== null && this.clock.now() < until;
  });
  /** The lockout message with the remaining minutes. */
  protected readonly message = computed(() => {
    const until = this.lockedUntil();
    if (until !== null && this.clock.now() < until) {
      return `Zu viele Fehlversuche. Bitte in ${minutesText((until - this.clock.now()) / 1000)} erneut versuchen.`;
    }
    return this.error();
  });

  constructor() {
    // An operator with a valid session (e.g. opening /login by hand) goes straight to the Regie.
    void this.auth.ensureSession().then((status) => {
      if (status === 'authenticated') {
        void this.router.navigateByUrl(this.nextPath());
      }
    });
  }

  protected async submit(event: Event): Promise<void> {
    event.preventDefault();
    if (this.submitting() || this.locked()) {
      return;
    }
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.error.set('Bitte Benutzername und Passwort eingeben.');
      return;
    }
    const { username, password } = this.form.getRawValue();
    this.submitting.set(true);
    this.error.set(null);
    try {
      await this.auth.login(username.trim(), password);
      this.form.controls.password.reset('');
      await this.router.navigateByUrl(this.nextPath());
    } catch (error) {
      const apiError = ApiError.from(error);
      if (apiError.status === 429) {
        const seconds = apiError.retryAfterSeconds ?? DEFAULT_LOCKOUT_SECONDS;
        // Relative to the shared clock, so the countdown starts at exactly the server's minutes.
        this.lockedUntil.set(this.clock.now() + seconds * 1000);
      }
      this.error.set(loginErrorMessage(apiError));
      this.form.controls.password.reset('');
    } finally {
      this.submitting.set(false);
    }
  }

  private nextPath(): string {
    return safeNextPath(this.route.snapshot.queryParamMap.get('next'));
  }
}
