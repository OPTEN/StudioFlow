import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { t } from '@studioflow/i18n';
import { formatCheckCode, formatDuration, formatHm } from '@studioflow/scene-model';
import { BrandMarkComponent } from '../shared/brand-mark.component';
import { IconComponent } from '../shared/icon.component';
import { LanguageSelectComponent } from '../shared/language-select.component';
import { KnockService } from './knock.service';

/** The expiry turns into a countdown this long before the request runs out. */
const COUNTDOWN_MS = 2 * 60_000;

/**
 * `/join/waiting`: the check code “47 12” while the Regie decides (plan step 2). The code is the hero, with what to do
 * right under it. Polls through {@link KnockService}, survives reloads, shows a denial or expiry with “New request”,
 * and opens the station once approved. The expiry is a quiet “Valid until 14:32” until the last two minutes, which
 * count down in orange.
 */
@Component({
  selector: 'sf-waiting',
  imports: [BrandMarkComponent, IconComponent, LanguageSelectComponent],
  templateUrl: './waiting.component.html',
  styleUrl: './waiting.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WaitingComponent {
  private readonly router = inject(Router);
  protected readonly t = t;
  protected readonly knock = inject(KnockService);

  protected readonly phase = this.knock.phase;
  protected readonly trouble = this.knock.connectionTrouble;
  protected readonly code = computed(() => {
    const knock = this.knock.knock();
    return knock === null ? '' : formatCheckCode(knock.checkCode);
  });
  protected readonly name = computed(
    () => this.knock.knock()?.name ?? this.knock.lastRequest()?.name ?? '',
  );

  private readonly now = signal(Date.now());

  /** “Valid until 14:32”, or “Expires in 01:12” (soon) in the last two minutes. */
  protected readonly expiry = computed(() => {
    const expiresAt = Date.parse(this.knock.knock()?.expiresAt ?? '');
    if (Number.isNaN(expiresAt)) {
      return null;
    }
    const left = Math.max(0, expiresAt - this.now());
    return left > COUNTDOWN_MS
      ? {
          soon: false,
          text: t('sender.pairing.waiting.validUntil', { time: formatHm(new Date(expiresAt)) }),
        }
      : {
          soon: true,
          text: t('sender.pairing.waiting.expiresIn', { time: formatDuration(left) }),
        };
  });

  constructor() {
    this.knock.resume();
    const timer = setInterval(() => this.now.set(Date.now()), 1000);
    inject(DestroyRef).onDestroy(() => {
      clearInterval(timer);
      this.knock.stopPolling();
    });
    effect(() => {
      if (this.phase() === 'approved') {
        void this.router.navigate(['/station'], { replaceUrl: true });
      }
    });
  }

  protected async cancel(): Promise<void> {
    await this.knock.cancel();
    await this.router.navigate(['/'], { replaceUrl: true });
  }

  protected async again(): Promise<void> {
    this.knock.reset();
    await this.router.navigate(['/'], { replaceUrl: true });
  }
}
