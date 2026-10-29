import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { t } from '@studioflow/i18n';
import { toUserMessage } from '../../core/api/api-error';
import { AuthService } from '../../core/auth/auth.service';
import { ProductionStoreService } from '../../core/state/production-store.service';
import { ConfirmBoxComponent } from '../../core/ui/confirm-box.component';
import { IconComponent } from '../../core/ui/icon.component';
import { ToastService } from '../../core/ui/toast.service';
import { ChangePasswordFormComponent } from '../../shell/header/change-password-form.component';
import { SettingsPageHeadComponent } from './settings-page-head.component';

/**
 * Settings › Account: who is signed in, "Sign out" (with a confirmation that names the consequence while the broadcast
 * is on air) and the password change, whose consequence for the other sessions is stated before its button.
 */
@Component({
  selector: 'sf-account-page',
  imports: [
    ChangePasswordFormComponent,
    ConfirmBoxComponent,
    IconComponent,
    SettingsPageHeadComponent,
  ],
  template: `
    <div class="c-page">
      <sf-settings-page-head [title]="t('regie.settings.nav.account')" />
      <div class="c-page__body">
        <section class="c-group" aria-labelledby="account-heading">
          <h2 class="c-group__title" id="account-heading">
            {{ t('regie.settings.account.heading') }}
          </h2>
          <div class="c-group__body">
            <div class="c-group__row c-account__user">
              <span class="c-account__avatar" aria-hidden="true">
                <svg sfIcon="user" [size]="18"></svg>
              </span>
              <span class="c-group__label">
                <span class="u-sr-only">{{ t('regie.settings.account.user') }}:</span>
                <span class="c-account__name">{{ username() }}</span>
                <span class="c-group__sub">{{ t('regie.settings.account.userSub') }}</span>
              </span>
              <button
                class="c-btn"
                type="button"
                #signOutButton
                [disabled]="signingOut()"
                [attr.aria-expanded]="onAir() ? confirming() : null"
                (click)="signOut()"
              >
                <svg sfIcon="logout"></svg>{{ t('regie.settings.account.signOut') }}
              </button>
            </div>
            @if (confirming()) {
              <div class="c-group__row c-group__row--stack">
                <sf-confirm-box
                  [flush]="true"
                  [busy]="signingOut()"
                  [message]="t('regie.settings.account.signOutLive')"
                  [confirmLabel]="t('regie.settings.account.signOutConfirm')"
                  (confirm)="logout()"
                  (cancel)="closeConfirm()"
                />
              </div>
            }
          </div>
        </section>

        <section class="c-group" aria-labelledby="password-heading">
          <h2 class="c-group__title" id="password-heading">{{ t('regie.account.change.menu') }}</h2>
          <sf-change-password-form layout="page" />
        </section>
      </div>
    </div>
  `,
  styles: `
    .c-account__user {
      grid-template-columns: auto minmax(0, 1fr) auto;
    }

    .c-account__avatar {
      align-items: center;
      background: var(--fill);
      border-radius: 50%;
      color: var(--text-2);
      display: inline-flex;
      height: 34px;
      justify-content: center;
      width: 34px;
    }

    .c-account__name {
      font-weight: 600;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AccountPageComponent {
  private readonly auth = inject(AuthService);
  private readonly store = inject(ProductionStoreService);
  private readonly toasts = inject(ToastService);
  private readonly injector = inject(Injector);
  private readonly signOutButton = viewChild<ElementRef<HTMLButtonElement>>('signOutButton');
  protected readonly t = t;
  protected readonly username = computed(() => this.auth.session()?.username ?? '');
  protected readonly onAir = computed(() => this.store.broadcast() === 'live');
  protected readonly confirming = signal(false);
  protected readonly signingOut = signal(false);

  /** Signs out at once, or asks first while the broadcast is on air. */
  protected signOut(): void {
    if (this.onAir()) {
      this.confirming.set(true);
      return;
    }
    void this.logout();
  }

  protected closeConfirm(): void {
    this.confirming.set(false);
    afterNextRender(() => this.signOutButton()?.nativeElement.focus(), { injector: this.injector });
  }

  protected async logout(): Promise<void> {
    this.signingOut.set(true);
    try {
      await this.auth.logout();
    } catch (error) {
      // A refused logout keeps the session (see AuthService.logout): say so instead of pretending.
      this.toasts.show(
        t('regie.settings.account.signOutFailed', { reason: toUserMessage(error) }),
      );
    } finally {
      this.signingOut.set(false);
      this.confirming.set(false);
    }
  }
}
