import { ChangeDetectionStrategy, Component } from '@angular/core';
import { parseLocaleSetting, t } from '@studioflow/i18n';
import { injectI18n } from '@studioflow/i18n/angular';

/**
 * The language setting as a native select: "Automatic (browser language)", "English" and "Deutsch (Schweiz)".
 * The language names are written in their own language and never translated. A change applies at once, without a
 * reload, and is stored for the next visit (`studioflow.locale`, shared with the Regie on the same origin). The
 * visible label is the accessible name (WCAG 2.5.3 label in name).
 */
@Component({
  selector: 'sf-language-select',
  template: `
    <label class="c-field">
      <span class="c-field__label">{{ t('common.language') }}</span>
      <select class="c-select" (change)="choose($event)">
        <option value="auto" [selected]="i18n.setting() === 'auto'">{{ t('locale.auto') }}</option>
        @for (info of i18n.locales; track info.tag) {
          <option [value]="info.tag" [selected]="i18n.setting() === info.tag">
            {{ info.nativeName }}
          </option>
        }
      </select>
    </label>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LanguageSelectComponent {
  protected readonly i18n = injectI18n();
  protected readonly t = t;

  protected choose(event: Event): void {
    const setting = parseLocaleSetting((event.target as HTMLSelectElement).value);
    if (setting !== null) {
      this.i18n.setSetting(setting);
    }
  }
}
