import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { t, type PlainMessageKey } from '@studioflow/i18n';
import { formatClock, type ApplyStatusDto } from '@studioflow/scene-model';
import { StudioApiService } from '../core/api/studio-api.service';
import type { ApplyTarget } from '../core/state/server-settings.service';
import type { LampTone } from '../docks/shared/source-view';
import { SERVICE_COMMANDS } from './apply-messages';
import { TechnicalDetailsComponent } from './technical-details.component';

/** How often the state of the service is read while its page is open. */
export const SERVICE_STATUS_REFRESH_MS = 10_000;

/** What the status line says. */
export type ServiceState = 'ok' | 'pending' | 'failed' | 'unknown';

const NAME_KEYS = {
  caddy: 'regie.server.status.caddy',
  liveKit: 'regie.server.status.liveKit',
  backup: 'regie.server.status.backup',
} as const satisfies Record<ApplyTarget, PlainMessageKey>;

const STATE_KEYS = {
  ok: 'regie.server.status.ok',
  pending: 'regie.server.status.pending',
  failed: 'regie.server.status.failed',
  unknown: 'regie.server.status.unknown',
} as const satisfies Record<ServiceState, PlainMessageKey>;

const STATE_LAMP: Readonly<Record<ServiceState, LampTone>> = {
  ok: '',
  pending: 'is-warn',
  failed: 'is-bad',
  unknown: 'is-idle',
};

/**
 * The service a server page configures, at the top of the page: its name, whether it runs the saved settings (in plain
 * words with a lamp, never colour alone) and when that was checked. It reads `/api/settings/status` every
 * {@link SERVICE_STATUS_REFRESH_MS} and after every save ({@link refresh}). A service that refused the settings offers
 * the technical details for whoever runs the server.
 */
@Component({
  selector: 'sf-service-status',
  imports: [TechnicalDetailsComponent],
  template: `
    <section class="c-group" [attr.aria-label]="t('regie.server.status.label')">
      <div class="c-group__body">
        <div class="c-group__row c-service" [attr.data-state]="state()">
          <span class="c-lamp" aria-hidden="true" [class]="lamp()"></span>
          <span class="c-group__label">
            <span class="c-service__name">{{ name() }}</span>
            <span class="c-group__sub" role="status">{{ stateText() }}</span>
          </span>
          @if (checkedAt(); as time) {
            <span class="c-service__time">{{ t('regie.server.status.checked', { time }) }}</span>
          }
        </div>
        @if (state() === 'failed') {
          <div class="c-group__row c-group__row--stack">
            <sf-technical-details [command]="command()" [detail]="reason()" />
          </div>
        }
      </div>
    </section>
  `,
  styles: `
    @use 'mixins' as *;

    :host {
      display: block;
    }

    .c-service {
      grid-template-columns: auto minmax(0, 1fr) auto;
    }

    .c-service__name {
      font-weight: 600;
    }

    .c-service__time {
      @include mono;
      color: var(--muted);
      font-size: 12px;
      white-space: nowrap;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ServiceStatusComponent {
  private readonly api = inject(StudioApiService);

  /** The service of the page. */
  readonly service = input.required<ApplyTarget>();

  protected readonly t = t;
  private readonly status = signal<ApplyStatusDto | null>(null);
  private readonly unreachable = signal(false);
  private readonly checkedAtMs = signal<number | null>(null);

  protected readonly name = computed(() => t(NAME_KEYS[this.service()]));
  /** The state of the service (exposed for the page: Test connection waits for a running media server). */
  readonly state = computed<ServiceState>(() => {
    const target = this.status()?.[this.service()];
    if (!target) {
      return 'unknown';
    }
    return target.applied ? 'ok' : target.error ? 'failed' : 'pending';
  });
  protected readonly lamp = computed(() => STATE_LAMP[this.state()]);
  protected readonly stateText = computed(() =>
    this.unreachable() && this.status() === null
      ? t('regie.server.status.unreachable')
      : t(STATE_KEYS[this.state()]),
  );
  protected readonly checkedAt = computed(() => {
    const at = this.checkedAtMs();
    return at === null ? null : formatClock(new Date(at));
  });
  protected readonly command = computed(() => SERVICE_COMMANDS[this.service()]);
  protected readonly reason = computed(() => this.status()?.[this.service()].error ?? null);

  constructor() {
    void this.refresh();
    const timer = setInterval(() => void this.refresh(), SERVICE_STATUS_REFRESH_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  /** Reads the status now (after a save). */
  async refresh(): Promise<void> {
    try {
      this.status.set(await this.api.getServerSettingsStatus());
      this.unreachable.set(false);
      this.checkedAtMs.set(Date.now());
    } catch {
      // A moment without an answer (the API or the proxy restarts) is normal; the next look tries again.
      this.unreachable.set(true);
    }
  }
}
