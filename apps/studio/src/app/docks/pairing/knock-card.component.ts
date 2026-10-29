import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { t } from '@studioflow/i18n';
import { formatCheckCode, type PairingRequestDto } from '@studioflow/scene-model';
import { ClockService } from '../../core/ui/clock.service';
import { IconComponent, type IconName } from '../../core/ui/icon.component';
import { ProductionStoreService } from '../../core/state/production-store.service';
import { expiryText } from './link-tab.component';
import { PairingRequestsService } from './pairing-requests.service';

/** Icon of the kind of device that knocks. */
const KIND_ICON: Readonly<Record<PairingRequestDto['kind'], IconName>> = {
  phone: 'phone',
  laptop: 'laptop',
  audioStation: 'mic',
};

/**
 * Knock card of a waiting device (prototype `knockCard`): its kind icon, "Laptop Mia wants to join", the kind,
 * platform and expiry, then the check code "47 12" large in mono next to the question "Same code on the device?" and
 * "Deny" / "Allow". Allow is the last button, as the default action of a dialog, so the eye passes the code first.
 * Both buttons are disabled while an answer is in flight.
 */
@Component({
  selector: 'sf-knock-card',
  imports: [IconComponent],
  template: `
    <div class="c-knock" role="group" [attr.aria-label]="t('regie.pairing.knock.label')">
      <span class="c-knock__icon" aria-hidden="true"><svg [sfIcon]="icon()" [size]="16"></svg></span>
      <span class="c-knock__head">
        <span class="c-knock__title">{{
          t('regie.pairing.knock.title', { name: request().name })
        }}</span>
        <span class="c-knock__meta">{{ meta() }}</span>
      </span>
      <span class="c-knock__check">
        <span class="c-knock__code" [attr.aria-label]="codeLabel()">{{ code() }}</span>
        <span class="c-knock__question">{{ t('regie.pairing.knock.question') }}</span>
      </span>
      <span class="c-knock__row">
        <button class="c-btn c-btn--sm" type="button" [disabled]="busy()" (click)="deny()">
          {{ t('regie.pairing.knock.deny') }}
        </button>
        <button
          class="c-btn c-btn--go c-btn--sm"
          type="button"
          [disabled]="busy()"
          (click)="approve()"
        >
          <svg sfIcon="check" [size]="14"></svg>{{ t('regie.pairing.knock.allow') }}
        </button>
      </span>
    </div>
  `,
  styles: `
    :host {
      display: block;
    }

    .c-knock {
      align-items: center;
      background: var(--blue-wash);
      border-radius: var(--radius-lg);
      column-gap: 10px;
      display: grid;
      grid-template-areas:
        'icon head'
        'icon check'
        'row row';
      grid-template-columns: 32px minmax(0, 1fr);
      padding: 12px;
      row-gap: 8px;
    }

    .c-knock__icon {
      align-self: start;
      background: var(--float);
      border-radius: 50%;
      box-shadow: var(--shadow-raise);
      color: var(--blue);
      display: grid;
      grid-area: icon;
      height: 32px;
      place-items: center;
      width: 32px;
    }

    .c-knock__head {
      display: grid;
      gap: 1px;
      grid-area: head;
      min-width: 0;
    }

    .c-knock__title {
      color: var(--text);
      font-size: var(--fs-body);
      font-weight: 600;
      overflow-wrap: anywhere;
    }

    .c-knock__meta {
      color: var(--muted);
      font-size: var(--fs-footnote);
    }

    .c-knock__check {
      align-items: baseline;
      display: flex;
      flex-wrap: wrap;
      gap: 4px 12px;
      grid-area: check;
    }

    .c-knock__code {
      color: var(--text);
      font: 600 22px / 1.1 var(--font-mono);
      letter-spacing: 0.12em;
      white-space: nowrap;
    }

    .c-knock__question {
      color: var(--text-2);
      font-size: var(--fs-footnote);
    }

    .c-knock__row {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      grid-area: row;
      justify-content: flex-end;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class KnockCardComponent {
  /** The waiting request. */
  readonly request = input.required<PairingRequestDto>();

  private readonly requests = inject(PairingRequestsService);
  private readonly store = inject(ProductionStoreService);
  private readonly clock = inject(ClockService);

  protected readonly t = t;
  protected readonly icon = computed(() => KIND_ICON[this.request().kind] ?? 'laptop');
  protected readonly code = computed(() => formatCheckCode(this.request().checkCode));
  /** "Laptop · Windows · Chrome · expires in 9 minutes". */
  protected readonly meta = computed(() => {
    const request = this.request();
    const remaining =
      Date.parse(request.expiresAt) - this.store.serverNow(this.clock.now());
    return [this.kindText(request.kind), request.platform, expiryText(remaining)]
      .filter((part) => !!part)
      .join(' · ');
  });
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

  private kindText(kind: PairingRequestDto['kind']): string {
    switch (kind) {
      case 'phone':
        return t('regie.stations.kind.phone');
      case 'laptop':
        return t('regie.stations.kind.laptop');
      case 'audioStation':
        return t('regie.stations.kind.audioStation');
      default:
        return '';
    }
  }
}
