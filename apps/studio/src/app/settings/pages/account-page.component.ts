import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { t } from '@studioflow/i18n';
import { toUserMessage } from '../../core/api/api-error';
import { AuthService } from '../../core/auth/auth.service';
import { IconComponent } from '../../core/ui/icon.component';
import { ToastService } from '../../core/ui/toast.service';
import { ChangePasswordFormComponent } from '../../shell/header/change-password-form.component';
import { SettingsPageHeadComponent } from './settings-page-head.component';

/** Settings › Account: who is signed in, the password change and sign out. */
@Component({
  selector: 'sf-account-page',
  imports: [ChangePasswordFormComponent, IconComponent, SettingsPageHeadComponent],
  template: `
    <div class="c-page">
      <sf-settings-page-head [title]="t('regie.settings.nav.account')" />
      <div class="c-page__body">
        <section class="c-group">
          <div class="c-group__body">
            <div class="c-group__row">
              <span class="c-group__label">{{ auth.session()?.username }}</span>
              <button class="c-btn" type="button" (click)="logout()">
                <svg sfIcon="logout"></svg>{{ t('regie.header.production.signOut') }}
              </button>
            </div>
          </div>
        </section>
        <section class="c-group">
          <h2 class="c-group__title">{{ t('regie.account.change.menu') }}</h2>
          <div class="c-group__body">
            <div class="c-group__row c-group__row--stack"><sf-change-password-form /></div>
          </div>
        </section>
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AccountPageComponent {
  protected readonly auth = inject(AuthService);
  private readonly toasts = inject(ToastService);
  protected readonly t = t;

  protected logout(): void {
    // A refused logout keeps the session (see AuthService.logout): say so instead of pretending.
    this.auth
      .logout()
      .catch((error: unknown) =>
        this.toasts.show(
          t('regie.header.production.signOutFailed', { reason: toUserMessage(error) }),
        ),
      );
  }
}
