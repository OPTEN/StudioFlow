import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { t } from '@studioflow/i18n';
import { THEME_SETTINGS } from '../../core/ui/preferences.service';
import { ThemeService } from '../../core/ui/theme.service';

/**
 * The appearance setting as a segmented control: "Dark | Light | System". A choice applies at once, without a
 * reload, and is stored for the next visit (`studioflow.theme`). While "System" is chosen, a note says which appearance
 * the system gives right now. `row` lays label and note out on the left of a settings row, the control on the right;
 * `stacked` puts the label above the control.
 */
@Component({
  selector: 'sf-theme-select',
  template: `
    <div class="c-theme" [class.c-theme--row]="variant() === 'row'">
      <span class="c-theme__text">
        <span class="c-theme__label" [id]="labelId">{{ t('regie.settings.theme.label') }}</span>
        @if (resolvedNote(); as note) {
          <span class="c-theme__note" id="sf-theme-note">{{ note }}</span>
        }
      </span>
      <div
        class="c-seg"
        role="group"
        [attr.aria-labelledby]="labelId"
        [attr.aria-describedby]="resolvedNote() ? 'sf-theme-note' : null"
      >
        @for (option of options(); track option.setting) {
          <button
            type="button"
            [attr.aria-pressed]="theme.setting() === option.setting"
            (click)="theme.choose(option.setting)"
          >
            {{ option.label }}
          </button>
        }
      </div>
    </div>
  `,
  styles: `
    :host {
      display: block;
    }

    .c-theme {
      display: grid;
      gap: 6px;
    }

    .c-theme__text {
      display: grid;
      gap: 2px;
    }

    .c-theme__label {
      color: var(--muted);
      font-size: 12.5px;
    }

    .c-theme__note {
      color: var(--muted);
      font-size: 12px;
      line-height: 1.4;
    }

    .c-seg {
      display: grid;
    }

    .c-theme--row {
      align-items: center;
      gap: 4px 16px;
      grid-template-columns: minmax(0, 1fr) auto;

      .c-theme__label {
        color: var(--text);
        font-size: 13px;
      }

      .c-seg {
        min-width: 220px;
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ThemeSelectComponent {
  protected readonly theme = inject(ThemeService);
  protected readonly options = computed(() =>
    THEME_SETTINGS.map((setting) => ({ setting, label: t(`regie.settings.theme.${setting}`) })),
  );
  /** "Follows the system, which is dark right now." while System is chosen. */
  protected readonly resolvedNote = computed(() =>
    this.theme.setting() === 'system'
      ? t(
          this.theme.resolved() === 'dark'
            ? 'regie.settings.theme.systemDark'
            : 'regie.settings.theme.systemLight',
        )
      : null,
  );
  protected readonly labelId = 'sf-theme-label';
  protected readonly t = t;

  /** The layout; `stacked` by default. */
  readonly variant = input<'stacked' | 'row'>('stacked');
}
