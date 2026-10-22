import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { formatCheckCode, type PairingRequestDto } from '@flowstudio/scene-model';
import { IconComponent } from '../../core/ui/icon.component';
import { PairingRequestsService } from './pairing-requests.service';

/**
 * Knock card of a waiting laptop (prototype `knockCard`): «Laptop Mia möchte beitreten», the check code «47 12» in
 * large mono, the question and «Zulassen» (go) / «Ablehnen». Both buttons are disabled while an answer is in flight.
 */
@Component({
  selector: 'fs-knock-card',
  imports: [IconComponent],
  template: `
    <div class="c-knock" role="group" aria-label="Kopplungsanfrage">
      <span class="c-knock__title">{{ request().name }} möchte beitreten</span>
      <span class="c-knock__code" [attr.aria-label]="codeLabel()">{{ code() }}</span>
      <span class="c-knock__question">Steht derselbe Prüfcode auf dem Laptop? Dann zulassen.</span>
      <div class="c-knock__row">
        <button
          class="c-btn c-btn--go c-btn--sm"
          type="button"
          [disabled]="busy()"
          (click)="approve()"
        >
          <svg fsIcon="check" [size]="14"></svg>Zulassen
        </button>
        <button class="c-btn c-btn--sm" type="button" [disabled]="busy()" (click)="deny()">
          Ablehnen
        </button>
      </div>
    </div>
  `,
  styles: `
    :host {
      display: block;
    }

    .c-knock {
      background: var(--blue-wash);
      border-bottom: 1px solid var(--seam);
      display: grid;
      gap: 8px;
      padding: 12px 14px;
    }

    // In the pairing dock the card spans the side column (prototype .pair-side .knock).
    :host(.c-knock-card--side) .c-knock {
      border-top: 1px solid var(--seam);
      margin-inline: -14px;
    }

    .c-knock__title {
      font-size: 14px;
      font-weight: 600;
    }

    .c-knock__code {
      color: var(--text);
      font: 600 24px / 1 var(--font-mono);
      letter-spacing: 0.14em;
    }

    .c-knock__question {
      color: var(--text-2);
      font-size: 12.5px;
    }

    .c-knock__row {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class KnockCardComponent {
  /** The waiting request. */
  readonly request = input.required<PairingRequestDto>();

  private readonly requests = inject(PairingRequestsService);

  protected readonly code = computed(() => formatCheckCode(this.request().checkCode));
  /** «Prüfcode 4 7 1 2», read digit by digit (prototype). */
  protected readonly codeLabel = computed(
    () => `Prüfcode ${this.request().checkCode.replace(/\s/g, '').split('').join(' ')}`,
  );
  protected readonly busy = computed(() => this.requests.busy(this.request().id));

  protected approve(): void {
    void this.requests.approve(this.request());
  }

  protected deny(): void {
    void this.requests.deny(this.request());
  }
}
