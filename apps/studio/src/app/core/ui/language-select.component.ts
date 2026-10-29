import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { parseLocaleSetting, t } from '@studioflow/i18n';
import { injectI18n } from '@studioflow/i18n/angular';
import { IconComponent } from './icon.component';

/** How the select sits on its page. */
export type LanguageSelectVariant = 'stacked' | 'row' | 'inline';

/**
 * The language setting as a native select: "Automatic (browser language)", "English" and "Deutsch (Schweiz)".
 * The language names are written in their own language and never translated. A change applies at once, without a
 * reload, and is stored for the next visit (`studioflow.locale`). Three layouts: the label above the select
 * (`stacked`), label and note on the left of a settings row with the select on the right (`row`), and a globe with the
 * select for the footer of the standalone pages (`inline`). The accessible name is always "Interface language".
 */
@Component({
  selector: 'sf-language-select',
  imports: [IconComponent],
  template: `
    <label
      class="c-lang"
      [class.c-lang--row]="variant() === 'row'"
      [class.c-lang--inline]="variant() === 'inline'"
    >
      @if (variant() === 'inline') {
        <svg sfIcon="globe" [size]="14"></svg>
        <span class="u-sr-only">{{ t('common.language') }}</span>
      } @else {
        <span class="c-lang__label">
          {{ t('common.language') }}
          @if (variant() === 'row') {
            <span class="c-lang__sub">{{ t('regie.settings.look.languageSub') }}</span>
          }
        </span>
      }
      <select
        class="c-select c-lang__select"
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
    :host {
      display: block;
    }

    .c-lang {
      display: grid;
      gap: 6px;
    }

    .c-lang__label {
      color: var(--muted);
      font-size: 12.5px;
    }

    .c-lang--row {
      align-items: center;
      gap: 4px 16px;
      grid-template-columns: minmax(0, 1fr) auto;

      .c-lang__label {
        color: var(--text);
        font-size: 13px;
      }

      .c-lang__select {
        width: 220px;
      }
    }

    .c-lang__sub {
      color: var(--muted);
      display: block;
      font-size: 12px;
      line-height: 1.4;
      margin-top: 2px;
    }

    .c-lang--inline {
      align-items: center;
      color: var(--muted);
      gap: 6px;
      grid-template-columns: auto auto;

      .c-lang__select {
        background-color: transparent;
        border-color: transparent;
        color: var(--text-2);
        font-size: 12px;
        height: var(--control-h-sm);
        width: auto;

        &:hover {
          background-color: var(--fill);
        }
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LanguageSelectComponent {
  protected readonly i18n = injectI18n();
  protected readonly t = t;

  /** The layout; `stacked` by default. */
  readonly variant = input<LanguageSelectVariant>('stacked');

  protected choose(event: Event): void {
    const setting = parseLocaleSetting((event.target as HTMLSelectElement).value);
    if (setting !== null) {
      this.i18n.setSetting(setting);
    }
  }
}
