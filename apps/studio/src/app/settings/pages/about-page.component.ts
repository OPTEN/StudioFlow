import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { t } from '@studioflow/i18n';
import { SystemInfoService } from '../../core/api/system-info.service';
import { IconComponent } from '../../core/ui/icon.component';
import { SettingsPageHeadComponent } from './settings-page-head.component';

/** Settings › About StudioFlow: the version the server runs (for problem reports) and the sponsor. */
@Component({
  selector: 'sf-about-page',
  imports: [IconComponent, SettingsPageHeadComponent],
  template: `
    <div class="c-page">
      <sf-settings-page-head [title]="t('regie.settings.nav.about')" />
      <div class="c-page__body">
        <section class="c-group">
          <div class="c-group__body">
            <div class="c-group__row">
              <span class="c-group__label">{{ t('regie.settings.version.label') }}</span>
              <span class="u-mono c-about__version">{{ system.version() ?? '–' }}</span>
            </div>
            <div class="c-group__row">
              <span class="c-group__label">{{ t('regie.header.sponsor.prefix') }}</span>
              <a
                class="c-about__sponsor"
                href="https://www.opten.ch"
                target="_blank"
                rel="noopener"
              >
                <svg sfIcon="opten"></svg>OPTEN
              </a>
            </div>
          </div>
        </section>
      </div>
    </div>
  `,
  styles: `
    .c-about__version {
      color: var(--text-2);
      user-select: text;
    }

    .c-about__sponsor {
      align-items: center;
      display: inline-flex;
      gap: 6px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AboutPageComponent {
  protected readonly system = inject(SystemInfoService);
  protected readonly t = t;

  constructor() {
    this.system.ensureLoaded();
  }
}
