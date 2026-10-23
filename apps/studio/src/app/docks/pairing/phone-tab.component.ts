import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { formatDuration, type InviteDto } from '@studioflow/scene-model';
import { toGermanMessage } from '../../core/api/api-error';
import { StudioApiService } from '../../core/api/studio-api.service';
import { ProductionStoreService } from '../../core/state/production-store.service';
import { ClockService } from '../../core/ui/clock.service';
import { IconComponent } from '../../core/ui/icon.component';
import { ToastService } from '../../core/ui/toast.service';
import { DockCommandService } from '../shared/dock-command.service';
import { QrCodeComponent } from './qr-code.component';

/** The newest phone invite (QR) of a list, or null. */
export function latestPhoneInvite(invites: readonly InviteDto[]): InviteDto | null {
  let latest: InviteDto | null = null;
  for (const invite of invites) {
    if (invite.kind !== 'phoneQr') {
      continue;
    }
    if (!latest || Date.parse(invite.createdAt) > Date.parse(latest.createdAt)) {
      latest = invite;
    }
  }
  return latest;
}

/**
 * «Handy» tab of the pairing dock (prototype `renderPair` phone): the QR code of the current phone invite
 * (`GET …/pairing/phone-invite` creates one when missing) with its remaining time, and «Neuen Code erzeugen». The
 * server replaces a redeemed or renewed invite at once and announces it, so the code shown is always the newest one;
 * an expired code is replaced automatically.
 */
@Component({
  selector: 'sf-phone-tab',
  imports: [IconComponent, QrCodeComponent],
  template: `
    <h3 class="c-pair__title">Handy als Kamera</h3>
    <p class="c-pair__text">
      Mit der Kamera-App scannen. Das Handy öffnet StudioFlow und erscheint danach unter Stationen.
    </p>
    <div class="c-pair__qr-wrap">
      @if (invite(); as invite) {
        <sf-qr-code [value]="invite.url" label="QR-Code zum Koppeln eines Handys" />
      } @else {
        <div class="c-pair__qr-empty" role="status">
          {{ error() ?? 'QR-Code wird erzeugt …' }}
        </div>
      }
      <div class="c-pair__qr-side">
        @if (invite()) {
          <span class="c-hint">
            Gilt einmal, noch <span class="u-mono">{{ remainingText() }}</span> min.
          </span>
        } @else if (error()) {
          <button class="c-btn c-btn--sm" type="button" (click)="load()">Nochmals versuchen</button>
        }
        <button
          class="c-btn c-btn--sm"
          type="button"
          [disabled]="commands.blocked('pairing:renew') || loading()"
          (click)="renew()"
        >
          <svg sfIcon="refresh" [size]="14"></svg>Neuen Code erzeugen
        </button>
      </div>
    </div>
  `,
  styleUrl: './pairing-tab.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PhoneTabComponent {
  protected readonly commands = inject(DockCommandService);
  private readonly api = inject(StudioApiService);
  private readonly store = inject(ProductionStoreService);
  private readonly clock = inject(ClockService);
  private readonly toasts = inject(ToastService);

  private readonly fetched = signal<InviteDto | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  /** Invite whose expiry already triggered a reload (no reload loop). */
  private reloadedFor: string | null = null;

  /** The newest valid phone invite: from the store (events), else the one fetched by this tab. */
  protected readonly invite = computed<InviteDto | null>(() => {
    const now = this.store.serverNow(this.clock.now());
    const candidates = [latestPhoneInvite(this.store.invites()), this.fetched()].filter(
      (invite): invite is InviteDto => invite !== null && Date.parse(invite.expiresAt) > now,
    );
    return latestPhoneInvite(candidates);
  });
  private readonly remainingMs = computed(() => {
    const invite = this.invite() ?? this.fetched();
    return invite
      ? Math.max(0, Date.parse(invite.expiresAt) - this.store.serverNow(this.clock.now()))
      : 0;
  });
  protected readonly remainingText = computed(() => formatDuration(this.remainingMs()));

  constructor() {
    void this.load();
    // No valid invite (expired, redeemed without an event yet): fetch the current one, once per invite.
    effect(() => {
      const invite = this.invite();
      const key = this.fetched()?.id ?? 'none';
      if (invite || this.loading() || this.error() || !this.store.canCommand()) {
        return;
      }
      if (this.reloadedFor !== key) {
        this.reloadedFor = key;
        untracked(() => void this.load());
      }
    });
  }

  /** Loads the valid phone invite (the server creates one when needed). */
  async load(): Promise<void> {
    const productionId = this.store.productionId();
    if (!productionId || this.loading()) {
      return;
    }
    this.loading.set(true);
    this.error.set(null);
    try {
      this.fetched.set(await this.api.getPhoneInvite(productionId));
    } catch (error) {
      this.error.set(toGermanMessage(error));
    } finally {
      this.loading.set(false);
    }
  }

  /** «Neuen Code erzeugen»: the old code stops working at once. */
  protected async renew(): Promise<void> {
    const invite = await this.commands.run('pairing:renew', (productionId) =>
      this.api.renewPhoneInvite(productionId),
    );
    if (invite) {
      this.fetched.set(invite);
      this.error.set(null);
      this.toasts.show('Neuer QR-Code, der alte gilt nicht mehr');
    }
  }
}
