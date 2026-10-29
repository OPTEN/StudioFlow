import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { t } from '@studioflow/i18n';
import { ProductionStoreService } from '../../core/state/production-store.service';

/** Where the choices of a settings page apply (DESIGN.md "Settings": every page names its scope). */
export type SettingsScope = 'production' | 'browser' | 'server' | 'none';

/**
 * The head of a settings page: the large title and one line that says where its choices apply ("Applies to the
 * production “Demo webinar”.", "Saved in this browser only.", "Applies to the whole server …").
 */
@Component({
  selector: 'sf-settings-page-head',
  template: `
    <header class="c-page__head">
      <h1 class="c-page__title">{{ title() }}</h1>
      @if (lead(); as text) {
        <p class="c-page__lead">{{ text }}</p>
      }
    </header>
  `,
  styles: `
    :host {
      display: block;
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
  /** An extra sentence after the scope line. */
  readonly note = input<string | null>(null);

  protected readonly lead = computed(() => {
    const parts: string[] = [];
    switch (this.scope()) {
      case 'production': {
        const name = this.store.production()?.name;
        parts.push(
          name
            ? t('regie.settings.scope.production', { name })
            : t('regie.settings.scope.productionNone'),
        );
        break;
      }
      case 'browser':
        parts.push(t('regie.settings.scope.browser'));
        break;
      case 'server':
        parts.push(t('regie.settings.scope.server'));
        break;
      case 'none':
        break;
    }
    const note = this.note();
    if (note) {
      parts.push(note);
    }
    return parts.length > 0 ? parts.join(' ') : null;
  });
}
