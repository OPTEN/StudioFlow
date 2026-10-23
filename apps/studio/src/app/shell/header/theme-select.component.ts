import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { t } from '@studioflow/i18n';
import { THEME_SETTINGS } from '../../core/ui/preferences.service';
import { ThemeService } from '../../core/ui/theme.service';

/**
 * The appearance setting as a segmented control: "Dark | Light | System". A choice applies at once, without a
 * reload, and is stored for the next visit (`studioflow.theme`).
 */
@Component({
  selector: 'sf-theme-select',
  template: `
    <div class="c-theme">
      <span class="c-theme__label" [id]="labelId">{{ t('regie.settings.theme.label') }}</span>
      <div class="c-seg" role="group" [attr.aria-labelledby]="labelId">
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
    .c-theme {
      display: grid;
      gap: 6px;
    }

    .c-theme__label {
      color: var(--muted);
      font-size: 12.5px;
    }

    .c-seg {
      display: grid;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ThemeSelectComponent {
  protected readonly theme = inject(ThemeService);
  protected readonly options = computed(() =>
    THEME_SETTINGS.map((setting) => ({ setting, label: t(`regie.settings.theme.${setting}`) })),
  );
  protected readonly labelId = 'sf-theme-label';
  protected readonly t = t;
}
