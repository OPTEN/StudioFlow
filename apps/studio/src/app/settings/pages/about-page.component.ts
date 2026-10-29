import { ChangeDetectionStrategy, Component, ElementRef, inject, viewChild } from '@angular/core';
import { t } from '@studioflow/i18n';
import { SystemInfoService } from '../../core/api/system-info.service';
import { ClipboardService } from '../../core/ui/clipboard.service';
import { IconComponent } from '../../core/ui/icon.component';
import { SettingsPageHeadComponent } from './settings-page-head.component';

/** Settings › About StudioFlow: the mark, the version the server runs (copyable for a problem report) and the sponsor. */
@Component({
  selector: 'sf-about-page',
  imports: [IconComponent, SettingsPageHeadComponent],
  template: `
    <div class="c-page">
      <sf-settings-page-head [title]="t('regie.settings.nav.about')" />
      <div class="c-page__body">
        <section class="c-about__hero" aria-hidden="true">
          <svg class="c-about__mark" sfIcon="mark"></svg>
          <span class="c-about__name">StudioFlow</span>
        </section>
        <section class="c-group" [attr.aria-label]="t('regie.settings.nav.about')">
          <div class="c-group__body">
            <div class="c-group__row">
              <span class="c-group__label">
                {{ t('regie.settings.about.version') }}
                <span class="c-group__sub">{{ t('regie.settings.about.versionSub') }}</span>
              </span>
              <span class="c-about__version">
                <span class="c-about__value" #version>{{ system.version() ?? '–' }}</span>
                @if (system.version()) {
                  <button
                    class="c-ibtn"
                    type="button"
                    [attr.aria-label]="t('regie.settings.about.copy')"
                    [attr.title]="t('regie.settings.about.copy')"
                    (click)="copyVersion()"
                  >
                    <svg sfIcon="copy"></svg>
                  </button>
                }
              </span>
            </div>
            <div class="c-group__row">
              <span class="c-group__label">
                {{ t('regie.settings.about.sponsor') }}
                <span class="c-group__sub">{{ t('regie.settings.about.sponsorSub') }}</span>
              </span>
              <a
                class="c-btn c-btn--plain c-about__sponsor"
                href="https://www.opten.ch"
                target="_blank"
                rel="noopener"
              >
                <svg sfIcon="opten"></svg>{{ t('regie.settings.about.sponsorLink') }}
                <svg sfIcon="external" [size]="13"></svg>
              </a>
            </div>
          </div>
        </section>
      </div>
    </div>
  `,
  styles: `
    @use 'mixins' as *;

    .c-about__hero {
      align-items: center;
      color: var(--text);
      display: grid;
      gap: 8px;
      justify-items: center;
      padding: 8px 0 4px;
    }

    .c-about__mark {
      height: 40px;
      width: 56px;
    }

    .c-about__name {
      font-family: var(--font-display);
      font-size: var(--fs-title-2);
      font-weight: 700;
      letter-spacing: -0.01em;
    }

    .c-about__version {
      align-items: center;
      display: inline-flex;
      gap: 4px;
    }

    .c-about__value {
      @include code;
      color: var(--text-2);
      font-size: 12.5px;
      user-select: text;
    }

    .c-about__sponsor {
      gap: 6px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AboutPageComponent {
  protected readonly system = inject(SystemInfoService);
  private readonly clipboard = inject(ClipboardService);
  private readonly version = viewChild<ElementRef<HTMLElement>>('version');
  protected readonly t = t;

  constructor() {
    this.system.ensureLoaded();
  }

  protected copyVersion(): void {
    const version = this.system.version();
    if (version) {
      void this.clipboard.copy(version, { selectElement: this.version()?.nativeElement ?? null });
    }
  }
}
