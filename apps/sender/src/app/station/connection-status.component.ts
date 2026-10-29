import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { t } from '@studioflow/i18n';
import { formatDuration } from '@studioflow/scene-model';
import type { ConnectionView } from './device-session.service';

/** Lamp state per connection view (orange = reconnecting, red = down). */
const LAMPS: Readonly<Record<ConnectionView, string>> = {
  connected: '',
  connecting: 'is-idle',
  reconnecting: 'is-warn',
  offline: 'is-warn',
  blocked: 'is-bad',
  replaced: 'is-idle',
  removed: 'is-bad',
};

/**
 * The connection line: lamp, state word and the outage timer (“Reconnecting… 00:12”). It is not a live region:
 * a flapping connection would repeat itself; the offline and unreachable banners are announced instead.
 */
@Component({
  selector: 'sf-connection-status',
  template: `
    <span class="c-connection" data-testid="connection-state" [attr.data-state]="view()">
      <span class="c-lamp" [class]="lampClass()" aria-hidden="true"></span>
      <span class="c-connection__label">{{ label() }}</span>
      @if (timer(); as time) {
        <span class="c-connection__timer u-mono">{{ time }}</span>
      }
    </span>
  `,
  styles: `
    :host {
      display: inline-flex;
      min-width: 0;
    }

    .c-connection {
      align-items: center;
      display: inline-flex;
      font-size: var(--fs-subhead);
      font-weight: 500;
      gap: 8px;
      min-width: 0;
      white-space: nowrap;
    }

    .c-connection__label {
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .c-connection__timer {
      color: var(--text-2);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConnectionStatusComponent {
  readonly view = input.required<ConnectionView>();
  readonly since = input<number | null>(null);
  readonly now = input<number>(Date.now());

  protected readonly label = computed(() => t(`sender.station.connection.${this.view()}`));
  protected readonly lampClass = computed(() => `c-lamp ${LAMPS[this.view()]}`.trim());
  protected readonly timer = computed(() => {
    const since = this.since();
    const view = this.view();
    return since === null || (view !== 'reconnecting' && view !== 'offline')
      ? null
      : formatDuration(Math.max(0, this.now() - since));
  });
}
