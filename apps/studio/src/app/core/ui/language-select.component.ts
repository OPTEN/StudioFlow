import { ChangeDetectionStrategy, Component } from '@angular/core';
import { parseLocaleSetting, t } from '@studioflow/i18n';
import { injectI18n } from '@studioflow/i18n/angular';

/**
 * The language setting as a native select: "Automatic (browser language)", "English" and "Deutsch (Schweiz)".
 * The language names are written in their own language and never translated. A change applies at once, without a
 * reload, and is stored for the next visit (`studioflow.locale`).
 */
@Component({
  selector: 'sf-language-select',
  template: `
    <label class="c-lang">
      <span class="c-lang__label">{{ t('common.language') }}</span>
      <select
        class="c-input c-lang__select"
        [attr.aria-label]="t('locale.label')"
        (change)="choose($event)"
      >
        <option value="auto" [selected]="i18n.setting() === 'auto'">{{ t('locale.auto') }}</option>
        @for (info of i18n.locales; track info.tag) {
          <option [value]="info.tag" [selected]="i18n.setting() === info.tag">
            {{ info.nativeName }}
          </option>
        }
      </select>
    </label>
  `,
  styles: `
    .c-lang {
      display: grid;
      gap: 6px;
    }

    .c-lang__label {
      color: var(--muted);
      font-size: 12.5px;
    }
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
