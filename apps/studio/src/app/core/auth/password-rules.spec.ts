import { FormControl } from '@angular/forms';
import { tm } from '@studioflow/i18n';
import {
  passwordMsg,
  passwordReason,
  passwordValidator,
  repeatMsg,
  repeatValidator,
  serverPasswordReason,
} from './password-rules';

describe('passwordReason', () => {
  it('accepts a password of 12 characters that differs from the username', () => {
    expect(passwordReason('abcdefgh-1234', 'regie')).toBeNull();
    expect(passwordReason('x'.repeat(12), 'regie')).toBeNull();
    expect(passwordReason('x'.repeat(256), 'regie')).toBeNull();
  });

  it('asks for a password when it is empty', () => {
    expect(passwordReason('', 'regie')).toBe('required');
  });

  it('refuses fewer than 12 characters', () => {
    expect(passwordReason('x'.repeat(11), 'regie')).toBe('tooShort');
  });

  it('refuses more than 256 characters', () => {
    expect(passwordReason('x'.repeat(257), 'regie')).toBe('tooLong');
  });

  it('refuses the username as password, ignoring case and surrounding spaces', () => {
    expect(passwordReason('Studio.Admin.Account', 'studio.admin.account')).toBe('equalsUsername');
    expect(passwordReason('studio.admin.account', ' STUDIO.admin.ACCOUNT ')).toBe('equalsUsername');
  });

  it('does not compare with an empty username', () => {
    expect(passwordReason('a-long-passphrase', '')).toBeNull();
  });
});

describe('serverPasswordReason', () => {
  it('maps the codes of the API', () => {
    expect(serverPasswordReason(['password_too_short'])).toBe('tooShort');
    expect(serverPasswordReason(['password_too_long'])).toBe('tooLong');
    expect(serverPasswordReason(['password_equals_username'])).toBe('equalsUsername');
    expect(serverPasswordReason(['password_too_common'])).toBe('tooCommon');
  });

  it('takes the first known code and ignores unknown ones', () => {
    expect(
      serverPasswordReason(['something_new', 'password_too_common', 'password_too_short']),
    ).toBe('tooCommon');
  });

  it('knows nothing about no or only unknown codes', () => {
    expect(serverPasswordReason(undefined)).toBeNull();
    expect(serverPasswordReason([])).toBeNull();
    expect(serverPasswordReason(['The password is too weak.'])).toBeNull();
  });
});

describe('texts', () => {
  it('names the limits in the length messages', () => {
    expect(tm(passwordMsg('tooShort'))).toBe('The password needs at least 12 characters.');
    expect(tm(passwordMsg('tooLong'))).toBe('The password can have at most 256 characters.');
  });

  it('has a text for every reason', () => {
    expect(tm(passwordMsg('required'))).toBe('Enter a password.');
    expect(tm(passwordMsg('equalsUsername'))).toBe('The password must differ from the username.');
    expect(tm(passwordMsg('tooCommon'))).toBe(
      'This password is too common. Please choose another one.',
    );
    expect(tm(repeatMsg('required'))).toBe('Repeat the password.');
    expect(tm(repeatMsg('mismatch'))).toBe('The passwords do not match.');
  });
});

describe('validators', () => {
  it('passwordValidator reports the reason and reads the username when it checks', () => {
    let username = 'regie';
    const validate = passwordValidator(() => username);
    const control = new FormControl('regie-regie-regie');

    expect(validate(control)).toBeNull();
    control.setValue('short');
    expect(validate(control)).toEqual({ password: 'tooShort' });
    username = 'a-long-passphrase';
    control.setValue('A-Long-Passphrase');
    expect(validate(control)).toEqual({ password: 'equalsUsername' });
  });

  it('repeatValidator wants the repeat and compares it with the current password', () => {
    let password = 'a-long-passphrase';
    const validate = repeatValidator(() => password);
    const control = new FormControl('');

    expect(validate(control)).toEqual({ repeat: 'required' });
    control.setValue('a-long-passphrasX');
    expect(validate(control)).toEqual({ repeat: 'mismatch' });
    control.setValue('a-long-passphrase');
    expect(validate(control)).toBeNull();
    password = 'changed-passphrase';
    expect(validate(control)).toEqual({ repeat: 'mismatch' });
  });
});
