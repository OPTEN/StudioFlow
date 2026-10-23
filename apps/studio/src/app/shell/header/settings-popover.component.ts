import { ChangeDetectionStrategy, Component } from '@angular/core';
import { t } from '@studioflow/i18n';
import { LanguageSelectComponent } from '../../core/ui/language-select.component';
import { PopoverDirective } from '../../core/ui/popover.directive';

/** Id of the settings popover. */
export const SETTINGS_POPOVER = 'settings';

/**
 * The settings of this browser, opened by the gear button of the header. It holds the language; later settings (the
 * colour theme) are added as further rows. Rendered by the header inside its popover wrapper while open.
 */
@Component({
  selector: 'sf-settings-popover',
  imports: [LanguageSelectComponent, PopoverDirective],
  template: `
    <div
      class="c-pop"
      role="dialog"
      [attr.aria-label]="t('regie.settings.title')"
      [sfPopover]="popoverId"
    >
      <div class="c-pop-h">{{ t('regie.settings.title') }}</div>
      <sf-language-select />
    </div>
  `,
  styles: `
    .c-pop {
      display: grid;
      gap: 10px;
      width: 260px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsPopoverComponent {
  protected readonly popoverId = SETTINGS_POPOVER;
  protected readonly t = t;
}
