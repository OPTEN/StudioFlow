import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { KnockCardComponent } from './knock-card.component';
import { PairingRequestsService } from './pairing-requests.service';

/**
 * Side column of the Laptop and Link tabs (prototype `requestsHtml`): «Wartende Anfragen» with a knock card per
 * waiting laptop, or the hint that nobody knocked yet.
 */
@Component({
  selector: 'fs-pairing-requests',
  imports: [KnockCardComponent],
  template: `
    <span class="c-label">Wartende Anfragen</span>
    @for (request of requests.pending(); track request.id) {
      <fs-knock-card class="c-knock-card--side" [request]="request" />
    } @empty {
      <p class="c-pair-requests__hint">
        Noch keine Anfrage. Sobald jemand die Adresse öffnet und einen Namen eingibt, erscheint sie
        hier mit Prüfcode.
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
  protected readonly requests = inject(PairingRequestsService);
}
