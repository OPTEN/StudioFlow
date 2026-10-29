import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { t } from '@studioflow/i18n';
import { KnockCardComponent } from './knock-card.component';
import { PairingRequestsService } from './pairing-requests.service';

/**
 * The waiting requests of the pairing dock's side column (prototype `requestsHtml`): "Waiting requests" with a knock
 * card per waiting device, or the hint that nobody knocked yet.
 */
@Component({
  selector: 'sf-pairing-requests',
  imports: [KnockCardComponent],
  template: `
    <h3 class="c-pair-requests__title">{{ t('regie.pairing.requests.title') }}</h3>
    @for (request of requests.pending(); track request.id) {
      <sf-knock-card class="c-knock-card--side" [request]="request" />
    } @empty {
      <p class="c-pair-requests__hint">
        {{ t('regie.pairing.requests.empty') }}
      </p>
    }
  `,
  styles: `
    :host {
      align-content: start;
      display: grid;
      gap: 8px;
    }

    .c-pair-requests__title {
      color: var(--text);
      font-size: var(--fs-body);
      font-weight: 600;
      letter-spacing: 0;
    }

    .c-pair-requests__hint {
      color: var(--muted);
      font-size: var(--fs-footnote);
      line-height: 1.45;
      margin: 0;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PairingRequestsComponent {
  protected readonly t = t;
  protected readonly requests = inject(PairingRequestsService);
}
