import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { t } from '@studioflow/i18n';
import { ProductionStoreService } from '../../core/state/production-store.service';

/** Where the choices of a settings page apply (DESIGN.md "Settings": every page names its scope). */
export type SettingsScope = 'production' | 'browser' | 'server' | 'none';

/**
 * The head of a settings page: the large title and one line that says where its choices apply ("Applies to the
 * production “Demo webinar”.", "Saved in this browser only.", "Applies to the whole server …") followed by an optional
 * sentence about the page, in one paragraph. Content projected into it (a live status line) follows below the lead.
 */
@Component({
  selector: 'sf-settings-page-head',
  template: `
    <header class="c-page__head">
      <h1 class="c-page__title">{{ title() }}</h1>
      @if (scopeLine() || note()) {
        <p class="c-page__lead">
          @if (scopeLine(); as text) {
            <span class="c-page__scope">{{ text }}</span>
          }
          @if (scopeLine() && note()) {
            {{ ' ' }}
          }
          {{ note() }}
        </p>
      }
      <ng-content />
    </header>
  `,
  styles: `
    :host {
      display: block;
    }

    .c-page__scope {
      color: var(--text-2);
      font-weight: 500;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsPageHeadComponent {
  private readonly store = inject(ProductionStoreService);

  /** The page title. */
  readonly title = input.required<string>();
  /** The scope line under the title. */
  readonly scope = input<SettingsScope>('none');
  /** A sentence about the page after the scope line. */
  readonly note = input<string | null>(null);

  protected readonly scopeLine = computed(() => {
    switch (this.scope()) {
      case 'production': {
        const name = this.store.production()?.name;
        return name
          ? t('regie.settings.scope.production', { name })
          : t('regie.settings.scope.productionNone');
      }
      case 'browser':
        return t('regie.settings.scope.browser');
      case 'server':
        return t('regie.settings.scope.server');
      case 'none':
        return null;
    }
  });
}
