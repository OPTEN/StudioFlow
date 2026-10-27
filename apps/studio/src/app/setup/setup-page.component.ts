import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  type AbstractControl,
  type ValidationErrors,
} from '@angular/forms';
import { Router } from '@angular/router';
import { msg, t, tm, type Msg } from '@studioflow/i18n';
import { LIMITS } from '@studioflow/scene-model';
import { ApiError, toUserMsg } from '../core/api/api-error';
import { AuthService, LOGIN_PATH } from '../core/auth/auth.service';
import {
  passwordMsg,
  passwordValidator,
  repeatMsg,
  repeatValidator,
  serverPasswordReason,
  type PasswordReason,
  type RepeatReason,
} from '../core/auth/password-rules';
import { SERVER_SETUP_PATH } from '../core/state/server-settings.guard';
import { RefusedFields, focusFirstInvalid } from '../core/ui/form-feedback';
import { IconComponent } from '../core/ui/icon.component';
import { LanguageSelectComponent } from '../core/ui/language-select.component';
import { ToastService } from '../core/ui/toast.service';

/** The fields of the form, in the order they are filled in. */
type Field = 'code' | 'username' | 'password' | 'repeat';

/** The setup code without hyphen and spaces, in capitals: 8 characters from the alphabet the API issues. */
const CODE_PATTERN = /^[A-HJ-NP-Z2-9]{8}$/;
const USERNAME_PATTERN = /^[A-Za-z0-9._@-]+$/;

function normalizeCode(code: string): string {
  return code.replace(/[-\s]/g, '').toUpperCase();
}

function codeValidator(control: AbstractControl): ValidationErrors | null {
  const code = normalizeCode(String(control.value ?? ''));
  if (code.length === 0) {
    return { code: 'required' };
  }
  return CODE_PATTERN.test(code) ? null : { code: 'format' };
}

function usernameValidator(control: AbstractControl): ValidationErrors | null {
  const username = String(control.value ?? '').trim();
  if (username.length === 0) {
    return { username: 'required' };
  }
  return username.length <= LIMITS.usernameLength && USERNAME_PATTERN.test(username)
    ? null
    : { username: 'invalid' };
}

function usernameInvalidMsg(): Msg {
  return msg('regie.setup.username.invalid', { max: String(LIMITS.usernameLength) });
}

/**
 * First-run setup of the Regie (`/setup`): as long as no account exists, this page replaces the login. The operator
 * enters the one-time setup code from the server log, a username and a password (twice). The form says what is wrong
 * next to a field as soon as it is left, and on submit moves the focus to the first field that needs attention. The
 * API has the last word (wrong code, rules the browser does not know such as the list of common passwords, an account
 * that was created meanwhile). After success the new account is signed in and the wizard of the server settings opens
 * (step 2 of 4: media address, address and certificate, embedding). The page shares the look of the login page.
 */
@Component({
  selector: 'sf-setup-page',
  imports: [IconComponent, LanguageSelectComponent, ReactiveFormsModule],
  templateUrl: './setup-page.component.html',
  styleUrls: ['../login/login-page.component.scss', './setup-page.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SetupPageComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly toasts = inject(ToastService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly refused = new RefusedFields<Field>();

  protected readonly t = t;
  protected readonly limits = LIMITS;
  protected readonly passwordMin = String(LIMITS.passwordMinLength);
  private readonly username = new FormControl('', {
    nonNullable: true,
    validators: [usernameValidator],
  });
  private readonly password = new FormControl('', {
    nonNullable: true,
    validators: [passwordValidator(() => this.username.value)],
  });
  protected readonly form = new FormGroup({
    code: new FormControl('', { nonNullable: true, validators: [codeValidator] }),
    username: this.username,
    password: this.password,
    repeat: new FormControl('', {
      nonNullable: true,
      validators: [repeatValidator(() => this.password.value)],
    }),
  });
  protected readonly submitting = signal(false);
  /** A problem that is not about one field (lockout, no connection). */
  protected readonly error = signal<Msg | null>(null);
  /** The general problem as text in the active language. */
  protected readonly message = computed(() => tm(this.error()) || null);

  constructor() {
    const { username, password, repeat } = this.form.controls;
    // The rules for the password depend on the username, and the repeat on the password.
    username.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe(() => password.updateValueAndValidity());
    password.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe(() => repeat.updateValueAndValidity());
    for (const field of ['code', 'username', 'password', 'repeat'] as const) {
      this.form.controls[field].valueChanges
        .pipe(takeUntilDestroyed())
        .subscribe(() => this.refused.clear(field));
    }
  }

  /** The text under a field, once it has been left or a submit was tried; the API's verdict comes first. */
  protected fieldError(field: Field): string | null {
    const fromServer = this.refused.get(field);
    if (fromServer) {
      return tm(fromServer);
    }
    const control = this.form.controls[field];
    return control.invalid && control.touched ? tm(this.clientError(field, control.errors)) : null;
  }

  protected async submit(event: Event): Promise<void> {
    event.preventDefault();
    if (this.submitting()) {
      return;
    }
    this.form.markAllAsTouched();
    if (this.form.invalid) {
      focusFirstInvalid(this.host, this.injector);
      return;
    }
    const { code, username, password } = this.form.getRawValue();
    this.submitting.set(true);
    this.error.set(null);
    this.refused.set({});
    try {
      await this.auth.completeSetup(code.trim(), username.trim(), password);
      await this.router.navigateByUrl(SERVER_SETUP_PATH);
    } catch (error) {
      await this.showFailure(ApiError.from(error));
    } finally {
      this.submitting.set(false);
    }
  }

  /** An account that exists already sends the operator to the login; a refusal about fields goes next to them; anything else is a general error. */
  private async showFailure(error: ApiError): Promise<void> {
    if (error.is('setup_closed')) {
      this.toasts.show(tm(toUserMsg(error)));
      await this.router.navigateByUrl(LOGIN_PATH);
      return;
    }
    const refused = this.refusedFields(error);
    if (Object.keys(refused).length === 0) {
      this.error.set(toUserMsg(error));
      return;
    }
    this.refused.set(refused);
    focusFirstInvalid(this.host, this.injector);
  }

  /** What the API refused, per field: a wrong setup code, or the rules the browser does not check itself. */
  private refusedFields(error: ApiError): Partial<Record<Field, Msg>> {
    if (error.is('setup_code_invalid')) {
      return { code: toUserMsg(error) };
    }
    const refused: Partial<Record<Field, Msg>> = {};
    if (error.fieldErrors['username']) {
      refused.username = usernameInvalidMsg();
    }
    const reason = serverPasswordReason(error.fieldErrors['password']);
    if (reason) {
      refused.password = passwordMsg(reason);
    }
    return refused;
  }

  private clientError(field: Field, errors: ValidationErrors | null): Msg {
    switch (field) {
      case 'code':
        return msg(
          errors?.['code'] === 'required' ? 'regie.setup.code.required' : 'regie.setup.code.format',
        );
      case 'username':
        return errors?.['username'] === 'required'
          ? msg('regie.setup.username.required')
          : usernameInvalidMsg();
      case 'password':
        return passwordMsg(errors?.['password'] as PasswordReason);
      case 'repeat':
        return repeatMsg(errors?.['repeat'] as RepeatReason);
    }
  }
}
