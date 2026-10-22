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
import { formatCheckCode, formatDuration } from '@flowstudio/scene-model';
import { BrandMarkComponent } from '../shared/brand-mark.component';
import { IconComponent } from '../shared/icon.component';
import { KnockService } from './knock.service';

/**
 * `/join/warten`: the check code «47 12» while the Regie decides (plan step 2). Polls through {@link KnockService},
 * survives reloads, shows a denial or expiry with «Neue Anfrage», and opens the station once approved.
 */
@Component({
  selector: 'fs-waiting',
  imports: [BrandMarkComponent, IconComponent],
  templateUrl: './waiting.component.html',
  styleUrl: './waiting.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WaitingComponent {
  private readonly router = inject(Router);
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

  /** «Gilt noch 09:41» until the request expires. */
  protected readonly remaining = computed(() => {
    const expiresAt = Date.parse(this.knock.knock()?.expiresAt ?? '');
    if (Number.isNaN(expiresAt)) {
      return null;
    }
    return formatDuration(Math.max(0, expiresAt - this.now()));
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
