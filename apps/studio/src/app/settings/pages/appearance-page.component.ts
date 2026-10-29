import { ChangeDetectionStrategy, Component } from '@angular/core';
import { t } from '@studioflow/i18n';
import { LanguageSelectComponent } from '../../core/ui/language-select.component';
import { ThemeSelectComponent } from '../../shell/header/theme-select.component';
import { SettingsPageHeadComponent } from './settings-page-head.component';

/** Settings › Appearance and language: the two choices of this browser (`studioflow.locale`, `studioflow.theme`). */
@Component({
  selector: 'sf-appearance-page',
  imports: [LanguageSelectComponent, SettingsPageHeadComponent, ThemeSelectComponent],
  template: `
    <div class="c-page">
      <sf-settings-page-head [title]="t('regie.settings.nav.appearance')" scope="browser" />
      <div class="c-page__body">
        <section class="c-group">
          <div class="c-group__body">
            <div class="c-group__row c-group__row--stack"><sf-theme-select /></div>
            <div class="c-group__row c-group__row--stack"><sf-language-select /></div>
          </div>
        </section>
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppearancePageComponent {
  protected readonly t = t;
}
