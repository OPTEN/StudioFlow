import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  signal,
  type OnInit,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { t } from '@studioflow/i18n';
import type { ApiError } from '../core/api-error';
import { CredentialsService } from '../core/credentials.service';
import { DeviceApiService } from '../core/device-api.service';
import { DEVICE_ENVIRONMENT, detectDeviceKind } from '../core/device-environment';
import { BrandMarkComponent } from '../shared/brand-mark.component';
import { ConfirmKeysDirective } from '../shared/confirm-keys.directive';
import { IconComponent } from '../shared/icon.component';
import { LanguageSelectComponent } from '../shared/language-select.component';
import { RedeemService } from './redeem.service';

/** Screen state of the redeem page. */
type RedeemState = 'redeeming' | 'already' | 'expired' | 'failed';

/** “The server does not answer yet” after this long without an outcome (the service keeps retrying). */
const SLOW_MS = 8000;

/**
 * `/join/i/:token`: redeems a QR code (phones) or invite link (laptops) right away, without a name – the server
 * names the device (“Phone 3”), the Regie can rename it. On success the token leaves the address bar (replaceUrl).
 * A browser that is already paired carries on by default; pairing it again removes the old device in the control room
 * and asks first.
 */
@Component({
  selector: 'sf-redeem',
  imports: [
    RouterLink,
    BrandMarkComponent,
    ConfirmKeysDirective,
    IconComponent,
    LanguageSelectComponent,
  ],
  templateUrl: './redeem.component.html',
  styleUrl: './redeem.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RedeemComponent implements OnInit {
  /** Invite token from the route. */
  readonly token = input.required<string>();
  /**
   * `?station=audio` on a laptop link: the person at the mixing desk pairs this laptop as the audio station (the server
   * honours it only for a laptop link).
   */
  readonly station = input<string | undefined>(undefined);

  private readonly router = inject(Router);
  private readonly redeemer = inject(RedeemService);
  private readonly credentials = inject(CredentialsService);
  private readonly api = inject(DeviceApiService);
  private readonly environment = inject(DEVICE_ENVIRONMENT);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly state = signal<RedeemState>('redeeming');
  protected readonly t = t;
  /** The failure of the last attempt; its text is read when it is shown, so it follows the language. */
  protected readonly error = signal<ApiError | null>(null);
  protected readonly busy = signal(false);
  /** The redeem takes longer than usual (the server is restarting or not reachable yet). */
  protected readonly slow = signal(false);
  /** “Pair again…” was pressed: the consequence is shown with the final button. */
  protected readonly confirming = signal(false);
  protected readonly isPhone = computed(() => detectDeviceKind(this.environment) === 'phone');

  ngOnInit(): void {
    if (this.credentials.paired()) {
      this.state.set('already');
      return;
    }
    void this.redeem();
  }

  /** Redeems (again); used by “Try again”. */
  protected async redeem(): Promise<void> {
    if (this.busy()) {
      return;
    }
    this.busy.set(true);
    this.state.set('redeeming');
    this.error.set(null);
    this.slow.set(false);
    const slowTimer = setTimeout(() => this.slow.set(true), SLOW_MS);
    this.destroyRef.onDestroy(() => clearTimeout(slowTimer));
    const detected = detectDeviceKind(this.environment);
    const outcome = await this.redeemer.redeem(
      this.token(),
      detected === 'laptop' && this.station() === 'audio' ? 'audioStation' : detected,
      this.environment.platform(),
    );
    clearTimeout(slowTimer);
    this.busy.set(false);
    switch (outcome.kind) {
      case 'paired':
        await this.router.navigate(['/station'], { replaceUrl: true });
        return;
      case 'expired':
        this.state.set('expired');
        return;
      default:
        this.error.set(outcome.error);
        this.state.set('failed');
    }
  }

  /** “Pair again” on an already paired browser: the old device removes itself (best effort), then redeem. */
  protected async repair(): Promise<void> {
    this.busy.set(true);
    await this.api.unpair().catch(() => undefined);
    this.credentials.clear();
    this.busy.set(false);
    await this.redeem();
  }

  protected async toStation(): Promise<void> {
    await this.router.navigate(['/station'], { replaceUrl: true });
  }
}
