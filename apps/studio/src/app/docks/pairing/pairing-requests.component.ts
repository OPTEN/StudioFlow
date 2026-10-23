import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { t } from '@studioflow/i18n';
import { KnockCardComponent } from './knock-card.component';
import { PairingRequestsService } from './pairing-requests.service';

/**
 * Side column of the Laptop and Link tabs (prototype `requestsHtml`): "Waiting requests" with a knock card per
 * waiting laptop, or the hint that nobody knocked yet.
 */
@Component({
  selector: 'sf-pairing-requests',
  imports: [KnockCardComponent],
  template: `
    <span class="c-label">{{ t('regie.pairing.requests.title') }}</span>
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
      gap: 12px;
    }

    .c-pair-requests__hint {
      color: var(--muted);
      font-size: 12.5px;
      margin: 0;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PairingRequestsComponent {
  protected readonly t = t;
  protected readonly requests = inject(PairingRequestsService);
}
