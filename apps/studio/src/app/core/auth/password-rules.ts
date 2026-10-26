import type { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';
import { msg, type Msg } from '@studioflow/i18n';
import { FIELD_ERROR_CODES, LIMITS } from '@studioflow/scene-model';

/**
 * Why a new password is refused. The first three are checked in the browser while typing; `tooCommon` (the list of
 * common passwords) only the server knows. The API reports every reason as a code in the field errors of a 400.
 */
export type PasswordReason = 'required' | 'tooShort' | 'tooLong' | 'equalsUsername' | 'tooCommon';

/** Why the repeated password is refused. */
export type RepeatReason = 'required' | 'mismatch';

const SERVER_REASONS: Readonly<Record<string, PasswordReason>> = {
  [FIELD_ERROR_CODES.passwordTooShort]: 'tooShort',
  [FIELD_ERROR_CODES.passwordTooLong]: 'tooLong',
  [FIELD_ERROR_CODES.passwordEqualsUsername]: 'equalsUsername',
  [FIELD_ERROR_CODES.passwordTooCommon]: 'tooCommon',
};

/** The first rule a password breaks (the same rules as `AdminAccountRules` in the API, minus the common passwords), or null. */
export function passwordReason(password: string, username: string): PasswordReason | null {
  if (password.length === 0) {
    return 'required';
  }
  if (password.length < LIMITS.passwordMinLength) {
    return 'tooShort';
  }
  if (password.length > LIMITS.passwordMaxLength) {
    return 'tooLong';
  }
  return password.toLowerCase() === username.trim().toLowerCase() ? 'equalsUsername' : null;
}

/** The reason of the first password rule code in the field errors of an API answer, or null. */
export function serverPasswordReason(
  messages: readonly string[] | undefined,
): PasswordReason | null {
  for (const code of messages ?? []) {
    const reason = SERVER_REASONS[code];
    if (reason) {
      return reason;
    }
  }
  return null;
}

/** The text for a {@link PasswordReason}; it follows the language while it is shown. */
export function passwordMsg(reason: PasswordReason): Msg {
  switch (reason) {
    case 'required':
      return msg('regie.account.password.required');
    case 'tooShort':
      return msg('regie.account.password.tooShort', { min: String(LIMITS.passwordMinLength) });
    case 'tooLong':
      return msg('regie.account.password.tooLong', { max: String(LIMITS.passwordMaxLength) });
    case 'equalsUsername':
      return msg('regie.account.password.equalsUsername');
    case 'tooCommon':
      return msg('regie.account.password.tooCommon');
  }
}

/** The text for a {@link RepeatReason}. */
export function repeatMsg(reason: RepeatReason): Msg {
  return msg(
    reason === 'required'
      ? 'regie.account.password.repeatRequired'
      : 'regie.account.password.mismatch',
  );
}

/** Validator of a new password: error `{ password: PasswordReason }`. `username` is read on every check. */
export function passwordValidator(username: () => string): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const reason = passwordReason(String(control.value ?? ''), username());
    return reason ? { password: reason } : null;
  };
}

/** Validator of the repeated password: error `{ repeat: RepeatReason }`. `password` is read on every check. */
export function repeatValidator(password: () => string): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const repeated = String(control.value ?? '');
    if (repeated.length === 0) {
      return { repeat: 'required' satisfies RepeatReason };
    }
    return repeated === password() ? null : { repeat: 'mismatch' satisfies RepeatReason };
  };
}
