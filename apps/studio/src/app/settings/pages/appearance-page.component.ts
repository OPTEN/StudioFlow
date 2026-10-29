import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { t } from '@studioflow/i18n';
import { ConfirmBoxComponent } from '../../core/ui/confirm-box.component';
import { LanguageSelectComponent } from '../../core/ui/language-select.component';
import { ThemeSelectComponent } from '../../shell/header/theme-select.component';
import { DockLayoutService } from '../../shell/workspace/dock-layout.service';
import { SettingsPageHeadComponent } from './settings-page-head.component';

/**
 * Settings › Appearance and language: the choices of this browser. The appearance (Dark | Light | System, with the
 * appearance System resolves to right now) and the language apply at once (`studioflow.theme`, `studioflow.locale`);
 * "Reset dock layout…" puts the docks of the control room back after a confirmation that names the consequence.
 */
@Component({
  selector: 'sf-appearance-page',
  imports: [
    ConfirmBoxComponent,
    LanguageSelectComponent,
    SettingsPageHeadComponent,
    ThemeSelectComponent,
  ],
  template: `
    <div class="c-page">
      <sf-settings-page-head [title]="t('regie.settings.nav.appearance')" scope="browser" />
      <div class="c-page__body">
        <section class="c-group" aria-labelledby="look-heading">
          <h2 class="c-group__title" id="look-heading">{{ t('regie.settings.look.heading') }}</h2>
          <div class="c-group__body">
            <div class="c-group__row c-group__row--stack"><sf-theme-select variant="row" /></div>
            <div class="c-group__row c-group__row--stack">
              <sf-language-select variant="row" />
            </div>
          </div>
        </section>

        <section class="c-group" aria-labelledby="layout-heading">
          <h2 class="c-group__title" id="layout-heading">{{ t('regie.settings.layout.heading') }}</h2>
          <div class="c-group__body">
            <div class="c-group__row">
              <span class="c-group__label">
                {{ t('regie.settings.layout.resetLabel') }}
                <span class="c-group__sub">{{ t('regie.settings.layout.resetSub') }}</span>
              </span>
              <button
                class="c-btn"
                type="button"
                #resetButton
                aria-controls="layout-confirm"
                [attr.aria-expanded]="confirming()"
                (click)="confirming.set(true)"
              >
                {{ t('regie.settings.layout.reset') }}
              </button>
            </div>
            @if (confirming()) {
              <div class="c-group__row c-group__row--stack" id="layout-confirm">
                <sf-confirm-box
                  [flush]="true"
                  [message]="t('regie.settings.layout.confirm')"
                  [confirmLabel]="t('regie.settings.layout.confirmAction')"
                  (confirm)="reset()"
                  (cancel)="close()"
                />
              </div>
            }
          </div>
        </section>
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppearancePageComponent {
  private readonly layout = inject(DockLayoutService);
  private readonly injector = inject(Injector);
  private readonly resetButton = viewChild<ElementRef<HTMLButtonElement>>('resetButton');
  protected readonly t = t;
  protected readonly confirming = signal(false);

  protected reset(): void {
    this.layout.resetLayout();
    this.close();
  }

  /** Closes the confirmation and gives the focus back to the button that opened it. */
  protected close(): void {
    this.confirming.set(false);
    afterNextRender(() => this.resetButton()?.nativeElement.focus(), { injector: this.injector });
  }
}
