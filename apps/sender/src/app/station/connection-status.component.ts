import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { formatDuration } from '@flowstudio/scene-model';
import type { ConnectionView } from './device-session.service';

/** Lamp class per connection view (amber = reconnecting, red = down, DESIGN «Lamps»). */
const LAMPS: Readonly<Record<ConnectionView, string>> = {
  connected: '',
  connecting: 'c-lamp--idle',
  reconnecting: 'c-lamp--warn',
  offline: 'c-lamp--warn',
  blocked: 'c-lamp--bad',
  replaced: 'c-lamp--idle',
  removed: 'c-lamp--bad',
};

const LABELS: Readonly<Record<ConnectionView, string>> = {
  connected: 'Verbunden',
  connecting: 'Verbindet …',
  reconnecting: 'Verbindet neu …',
  offline: 'Offline',
  blocked: 'Gesperrt',
  replaced: 'In einem anderen Tab geöffnet',
  removed: 'Nicht mehr gekoppelt',
};

/** The connection line: lamp, state word and the outage timer («Verbindet neu … 00:12»). */
@Component({
  selector: 'fs-connection-status',
  template: `
    <span class="c-connection" data-testid="connection-state" [attr.data-state]="view()">
      <span class="c-lamp" [class]="lampClass()" aria-hidden="true"></span>
      <span class="c-connection__label" role="status">{{ label() }}</span>
      @if (timer(); as time) {
        <span class="c-connection__timer u-mono" aria-hidden="true">{{ time }}</span>
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
      font-size: 15px;
      font-weight: 600;
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
      font-size: 14px;
      font-weight: 500;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConnectionStatusComponent {
  readonly view = input.required<ConnectionView>();
  readonly since = input<number | null>(null);
  readonly now = input<number>(Date.now());

  protected readonly label = computed(() => LABELS[this.view()]);
  protected readonly lampClass = computed(() => `c-lamp ${LAMPS[this.view()]}`.trim());
  protected readonly timer = computed(() => {
    const since = this.since();
    const view = this.view();
    return since === null || (view !== 'reconnecting' && view !== 'offline')
      ? null
      : formatDuration(Math.max(0, this.now() - since));
  });
}
