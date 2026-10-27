import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { t } from '@studioflow/i18n';
import type { SourceDto } from '@studioflow/scene-model';
import { ProductionStoreService } from '../../core/state/production-store.service';
import { IconComponent } from '../../core/ui/icon.component';
import { PlaceholderCommandsService } from '../sources/placeholder-commands.service';
import { placeholderOffers, type PlaceholderOffer } from '../sources/placeholder-view';

/** Offers shown in a station row; more are assigned from "Missing sources" in the Sources dock. */
const MAX_OFFERS = 4;

/**
 * "Use as K1 · Stage phone" (issue #14): in a copied production a newly paired camera or screen that no scene uses yet
 * can take the place of a placeholder of the same kind with one click. The offer sits in the station row (below the
 * row, like the "Seen" strip) and disappears as soon as the station is used. The new station gets the code of the
 * placeholder, so the scenes show it where the original device was.
 */
@Component({
  selector: 'sf-placeholder-offer',
  imports: [IconComponent],
  template: `
    @if (offers().length > 0) {
      <div class="c-st-offer" role="group" [attr.aria-label]="t('regie.placeholders.offer.text')">
        <span class="c-st-offer__head">
          <svg sfIcon="link" [size]="14"></svg>
          <span>{{ t('regie.placeholders.offer.text') }}</span>
        </span>
        <span class="c-st-offer__actions">
          @for (offer of shown(); track offer.placeholder.id + offer.source.id) {
            <button
              class="c-btn c-btn--sm c-btn--primary"
              type="button"
              [attr.data-placeholder]="offer.placeholder.code"
              [disabled]="commands.blocked(offer.placeholder.id)"
              (click)="use(offer)"
            >
              {{ t('regie.placeholders.offer.useAs', { name: offer.name }) }}
            </button>
          }
          @if (more() > 0) {
            <span class="c-st-offer__more">{{
              t('regie.placeholders.offer.more', { count: more() })
            }}</span>
          }
        </span>
      </div>
    }
  `,
  styles: `
    .c-st-offer {
      align-items: center;
      color: var(--text-2);
      display: flex;
      flex-wrap: wrap;
      font-size: 12.5px;
      gap: 6px 10px;
      padding: 0 12px 10px 34px;
    }

    .c-st-offer__head {
      align-items: flex-start;
      display: flex;
      flex: 1 1 100%;
      gap: 6px;
    }

    .c-st-offer__head .c-icon {
      color: var(--blue);
      margin-top: 2px;
    }

    .c-st-offer__actions {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }

    .c-st-offer__more {
      align-self: center;
      color: var(--muted);
    }
  `,
  host: { style: 'display: contents' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlaceholderOfferComponent {
  /** The sources of the station. */
  readonly sources = input.required<readonly SourceDto[]>();

  protected readonly commands = inject(PlaceholderCommandsService);
  private readonly store = inject(ProductionStoreService);

  protected readonly t = t;
  protected readonly offers = computed(() =>
    placeholderOffers(this.sources(), this.store.placeholders(), (id) =>
      this.store.isSourceUsed(id),
    ),
  );
  protected readonly shown = computed(() => this.offers().slice(0, MAX_OFFERS));
  protected readonly more = computed(() => Math.max(0, this.offers().length - MAX_OFFERS));

  protected use(offer: PlaceholderOffer): void {
    void this.commands.assign(offer.placeholder, offer.source);
  }
}
