import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { t } from '@studioflow/i18n';
import { formatCheckCode, type PairingRequestDto } from '@studioflow/scene-model';
import { IconComponent } from '../../core/ui/icon.component';
import { PairingRequestsService } from './pairing-requests.service';

/**
 * Knock card of a waiting laptop (prototype `knockCard`): "Laptop Mia wants to join", the check code "47 12" in
 * large mono, the question and "Allow" (go) / "Deny". Both buttons are disabled while an answer is in flight.
 */
@Component({
  selector: 'sf-knock-card',
  imports: [IconComponent],
  template: `
    <div class="c-knock" role="group" [attr.aria-label]="t('regie.pairing.knock.label')">
      <span class="c-knock__title">{{
        t('regie.pairing.knock.title', { name: request().name })
      }}</span>
      <span class="c-knock__code" [attr.aria-label]="codeLabel()">{{ code() }}</span>
      <span class="c-knock__question">{{ t('regie.pairing.knock.question') }}</span>
      <div class="c-knock__row">
        <button
          class="c-btn c-btn--go c-btn--sm"
          type="button"
          [disabled]="busy()"
          (click)="approve()"
        >
          <svg sfIcon="check" [size]="14"></svg>{{ t('regie.pairing.knock.allow') }}
        </button>
        <button class="c-btn c-btn--sm" type="button" [disabled]="busy()" (click)="deny()">
          {{ t('regie.pairing.knock.deny') }}
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

  protected readonly t = t;
  protected readonly code = computed(() => formatCheckCode(this.request().checkCode));
  /** "Check code 4 7 1 2", read digit by digit (prototype). */
  protected readonly codeLabel = computed(() =>
    t('regie.pairing.knock.codeLabel', {
      digits: this.request().checkCode.replace(/\s/g, '').split('').join(' '),
    }),
  );
  protected readonly busy = computed(() => this.requests.busy(this.request().id));

  protected approve(): void {
    void this.requests.approve(this.request());
  }

  protected deny(): void {
    void this.requests.deny(this.request());
  }
}
