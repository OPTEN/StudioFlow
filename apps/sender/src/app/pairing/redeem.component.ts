import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  signal,
  type OnInit,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { CredentialsService } from '../core/credentials.service';
import { DeviceApiService } from '../core/device-api.service';
import { DEVICE_ENVIRONMENT, detectDeviceKind } from '../core/device-environment';
import { BrandMarkComponent } from '../shared/brand-mark.component';
import { IconComponent } from '../shared/icon.component';
import { RedeemService } from './redeem.service';

/** Screen state of the redeem page. */
type RedeemState = 'redeeming' | 'already' | 'expired' | 'failed';

/**
 * `/join/i/:token`: redeems a QR code (phones) or invite link (laptops) right away, without a name – the server
 * names the device («Handy 3»), the Regie can rename it. On success the token leaves the address bar (replaceUrl).
 */
@Component({
  selector: 'sf-redeem',
  imports: [RouterLink, BrandMarkComponent, IconComponent],
  templateUrl: './redeem.component.html',
  styleUrl: './redeem.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RedeemComponent implements OnInit {
  /** Invite token from the route. */
  readonly token = input.required<string>();

  private readonly router = inject(Router);
  private readonly redeemer = inject(RedeemService);
  private readonly credentials = inject(CredentialsService);
  private readonly api = inject(DeviceApiService);
  private readonly environment = inject(DEVICE_ENVIRONMENT);

  protected readonly state = signal<RedeemState>('redeeming');
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly isPhone = computed(() => detectDeviceKind(this.environment) === 'phone');

  ngOnInit(): void {
    if (this.credentials.paired()) {
      this.state.set('already');
      return;
    }
    void this.redeem();
  }

  /** Redeems (again); used by «Erneut versuchen». */
  protected async redeem(): Promise<void> {
    if (this.busy()) {
      return;
    }
    this.busy.set(true);
    this.state.set('redeeming');
    this.errorMessage.set(null);
    const outcome = await this.redeemer.redeem(
      this.token(),
      detectDeviceKind(this.environment),
      this.environment.platform(),
    );
    this.busy.set(false);
    switch (outcome.kind) {
      case 'paired':
        await this.router.navigate(['/station'], { replaceUrl: true });
        return;
      case 'expired':
        this.state.set('expired');
        return;
      default:
        this.errorMessage.set(outcome.error.userMessage);
        this.state.set('failed');
    }
  }

  /** «Neu koppeln» on an already paired browser: the old device removes itself (best effort), then redeem. */
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
