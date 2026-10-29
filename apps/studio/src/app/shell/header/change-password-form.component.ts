import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { msg, t, tm, type Msg } from '@studioflow/i18n';
import { LIMITS } from '@studioflow/scene-model';
import { ApiError, toUserMsg } from '../../core/api/api-error';
import { AuthService } from '../../core/auth/auth.service';
import {
  passwordMsg,
  passwordValidator,
  repeatMsg,
  repeatValidator,
  serverPasswordReason,
  type PasswordReason,
  type RepeatReason,
} from '../../core/auth/password-rules';
import { RefusedFields, focusFirstInvalid } from '../../core/ui/form-feedback';
import { ToastService } from '../../core/ui/toast.service';

/** The fields of the form, in the order they are filled in. */
type Field = 'current' | 'password' | 'repeat';

/**
 * Change of the Regie password: the current password and the new one (twice, with the same rules as the first-run
 * setup). The consequence (every other session is signed out, this one continues) is stated before the button, whose
 * label "Update password" differs from the heading. `layout="page"` is the grouped form of Settings › Account (Cancel
 * appears once something is typed and clears the form); `menu` is the compact form of a popover. Reports `done` after
 * success and `cancelled` when the operator backs out.
 */
@Component({
  selector: 'sf-change-password-form',
  imports: [ReactiveFormsModule],
  templateUrl: './change-password-form.component.html',
  styleUrl: './change-password-form.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChangePasswordFormComponent {
  private readonly auth = inject(AuthService);
  private readonly toasts = inject(ToastService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly refused = new RefusedFields<Field>();

  /** `page`: the grouped form of the account page; `menu`: the compact form of a popover. */
  readonly layout = input<'menu' | 'page'>('menu');
  /** The password was changed. */
  readonly done = output();
  /** The operator closed the form without changing anything. */
  readonly cancelled = output();

  protected readonly t = t;
  protected readonly passwordMin = String(LIMITS.passwordMinLength);
  private readonly password = new FormControl('', {
    nonNullable: true,
    validators: [passwordValidator(() => this.auth.session()?.username ?? '')],
  });
  protected readonly form = new FormGroup({
    current: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    password: this.password,
    repeat: new FormControl('', {
      nonNullable: true,
      validators: [repeatValidator(() => this.password.value)],
    }),
  });
  protected readonly busy = signal(false);
  /** A problem that is not about one field (lockout, no connection). */
  protected readonly error = signal<Msg | null>(null);
  /** The general problem as text in the active language. */
  protected readonly message = computed(() => tm(this.error()) || null);

  constructor() {
    const { password, repeat } = this.form.controls;
    password.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe(() => repeat.updateValueAndValidity());
    for (const field of ['current', 'password', 'repeat'] as const) {
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
    if (!control.invalid || !control.touched) {
      return null;
    }
    switch (field) {
      case 'current':
        return t('regie.account.change.currentRequired');
      case 'password':
        return tm(passwordMsg(control.errors?.['password'] as PasswordReason));
      case 'repeat':
        return tm(repeatMsg(control.errors?.['repeat'] as RepeatReason));
    }
  }

  protected async submit(event: Event): Promise<void> {
    event.preventDefault();
    if (this.busy()) {
      return;
    }
    this.form.markAllAsTouched();
    if (this.form.invalid) {
      focusFirstInvalid(this.host, this.injector);
      return;
    }
    const { current, password } = this.form.getRawValue();
    this.busy.set(true);
    this.error.set(null);
    this.refused.set({});
    try {
      await this.auth.changePassword(current, password);
      this.toasts.show(t('regie.account.change.done'));
      if (this.layout() === 'page') {
        this.form.reset();
      }
      this.done.emit();
    } catch (error) {
      this.showFailure(ApiError.from(error));
    } finally {
      this.busy.set(false);
    }
  }

  /** Backs out: the page form forgets what was typed. */
  protected cancel(): void {
    if (this.layout() === 'page') {
      this.form.reset();
      this.refused.set({});
      this.error.set(null);
    }
    this.cancelled.emit();
  }

  /** A refusal about a field goes next to it; anything else (lockout, no connection) is a general error. */
  private showFailure(error: ApiError): void {
    const refused = this.refusedFields(error);
    if (Object.keys(refused).length === 0) {
      this.error.set(toUserMsg(error));
      return;
    }
    this.refused.set(refused);
    focusFirstInvalid(this.host, this.injector);
  }

  /** What the API refused, per field: the current password, or the rules the browser does not check itself. */
  private refusedFields(error: ApiError): Partial<Record<Field, Msg>> {
    if (error.is('password_incorrect')) {
      return { current: msg('errors.code.password_incorrect') };
    }
    const reason = serverPasswordReason(error.fieldErrors['newPassword']);
    return reason ? { password: passwordMsg(reason) } : {};
  }
}
