import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { msg, t, tm, type Msg } from '@studioflow/i18n';
import { ApiError, toUserMsg, waitMinutes } from '../core/api/api-error';
import { AuthService, safeNextPath } from '../core/auth/auth.service';
import { ClockService } from '../core/ui/clock.service';
import { IconComponent } from '../core/ui/icon.component';
import { LanguageSelectComponent } from '../core/ui/language-select.component';

/** Default lockout when the server sends 429 without Retry-After (spec 5: 15 minutes). */
const DEFAULT_LOCKOUT_SECONDS = 15 * 60;

/** The message for a failed login; it stays correct when the language changes while it is shown. */
export function loginErrorMsg(error: unknown): Msg {
  const apiError = ApiError.from(error);
  if (apiError.status === 401) {
    return msg('regie.login.error.invalid');
  }
  if (apiError.status === 429) {
    return lockedMsg(apiError.retryAfterSeconds ?? DEFAULT_LOCKOUT_SECONDS);
  }
  return toUserMsg(apiError);
}

function lockedMsg(seconds: number): Msg {
  return msg('regie.login.error.locked', { count: waitMinutes(seconds) });
}

/**
 * Login of the Regie (`/login`, spec 5): one admin account. Dark console look with the brand mark, typed reactive
 * form, errors for wrong credentials, lockout (429 with Retry-After, the button stays disabled until it ends) and a
 * missing server. After success it continues to `?next=` (in-app paths only) or `/`.
 */
@Component({
  selector: 'sf-login-page',
  imports: [IconComponent, LanguageSelectComponent, ReactiveFormsModule],
  templateUrl: './login-page.component.html',
  styleUrl: './login-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoginPageComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly clock = inject(ClockService);

  protected readonly t = t;
  protected readonly form = new FormGroup({
    username: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    password: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
  });
  protected readonly submitting = signal(false);
  protected readonly error = signal<Msg | null>(null);
  private readonly lockedUntil = signal<number | null>(null);
  private readonly passwordInput = viewChild<ElementRef<HTMLInputElement>>('password');

  /** True while the lockout of a 429 lasts. */
  protected readonly locked = computed(() => {
    const until = this.lockedUntil();
    return until !== null && this.clock.now() < until;
  });
  /** The lockout message with the remaining minutes, else the last error. */
  protected readonly message = computed(() => {
    const until = this.lockedUntil();
    if (until !== null && this.clock.now() < until) {
      return tm(lockedMsg((until - this.clock.now()) / 1000));
    }
    return tm(this.error()) || null;
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
      this.error.set(msg('regie.login.error.required'));
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
      this.error.set(loginErrorMsg(apiError));
      this.form.controls.password.reset('');
      // The disabled submit button took the focus with it: the next attempt starts in the password field.
      this.passwordInput()?.nativeElement.focus();
    } finally {
      this.submitting.set(false);
    }
  }

  private nextPath(): string {
    return safeNextPath(this.route.snapshot.queryParamMap.get('next'));
  }
}
