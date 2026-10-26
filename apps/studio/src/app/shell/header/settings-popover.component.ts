import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { t } from '@studioflow/i18n';
import { SystemInfoService } from '../../core/api/system-info.service';
import { LanguageSelectComponent } from '../../core/ui/language-select.component';
import { PopoverDirective } from '../../core/ui/popover.directive';
import { ThemeSelectComponent } from './theme-select.component';

/** Id of the settings popover. */
export const SETTINGS_POPOVER = 'settings';

/**
 * The settings of this browser, opened by the gear button of the header: the language and the appearance, and below
 * them the version the server runs (`0.1.0+1a2b3c4`, from `GET /api/system/info`), so that a report of a problem can
 * name it. Rendered by the header inside its popover wrapper while open.
 */
@Component({
  selector: 'sf-settings-popover',
  imports: [LanguageSelectComponent, PopoverDirective, ThemeSelectComponent],
  template: `
    <div
      class="c-pop"
      role="dialog"
      [attr.aria-label]="t('regie.settings.title')"
      [sfPopover]="popoverId"
    >
      <div class="c-pop-h">{{ t('regie.settings.title') }}</div>
      <sf-language-select />
      <sf-theme-select />
      @if (system.version(); as version) {
        <div class="c-version">
          <span class="c-version__label">{{ t('regie.settings.version.label') }}</span>
          <span class="c-version__value u-mono">{{ version }}</span>
        </div>
      }
    </div>
  `,
  styles: `
    .c-pop {
      display: grid;
      gap: 10px;
      width: 260px;
    }

    .c-version {
      align-items: baseline;
      border-top: 1px solid var(--seam);
      display: flex;
      font-size: 12.5px;
      gap: 8px;
      justify-content: space-between;
      padding-top: 8px;
    }

    .c-version__label {
      color: var(--muted);
    }

    .c-version__value {
      color: var(--text-2);
      overflow-wrap: anywhere;
      user-select: text;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsPopoverComponent {
  protected readonly system = inject(SystemInfoService);
  protected readonly popoverId = SETTINGS_POPOVER;
  protected readonly t = t;

  constructor() {
    this.system.ensureLoaded();
  }
}
