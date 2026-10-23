import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { formatRuntime } from '@studioflow/scene-model';
import { StudioApiService } from '../../core/api/studio-api.service';
import { ProductionStoreService } from '../../core/state/production-store.service';
import { ClockService } from '../../core/ui/clock.service';
import { ConfirmBoxComponent } from '../../core/ui/confirm-box.component';
import {
  PopoverDirective,
  PopoverService,
  PopoverTriggerDirective,
} from '../../core/ui/popover.directive';
import { ToastService } from '../../core/ui/toast.service';

/** Id of the «Sendung beenden» confirmation popover. */
export const BROADCAST_END_POPOVER = 'broadcast-end';

/**
 * Broadcast state in the header (spec 4.2, 9.1): «BEREIT» with «Sendung starten»; while live the red LIVE dot with
 * the mono runtime and «Sendung beenden» (confirmation in a dashed red box); after the end «BEENDET» with «Zurück auf
 * Bereit» and «Sendung starten». Buttons are disabled while a request runs or the Regie is offline.
 */
@Component({
  selector: 'sf-broadcast-control',
  imports: [ConfirmBoxComponent, PopoverTriggerDirective, PopoverDirective],
  template: `
    @switch (broadcast()) {
      @case ('live') {
        <span class="c-live" title="Seit Start der Sendung">
          <span class="c-live__dot" aria-hidden="true"></span><b>LIVE</b>
          <span class="u-mono c-live__time">{{ runtime() }}</span>
        </span>
        <div class="c-pop-wrap">
          <button
            class="c-btn c-btn--sm"
            type="button"
            aria-haspopup="dialog"
            [sfPopoverTrigger]="endPopover"
            [disabled]="busy() || !store.canCommand()"
          >
            Sendung beenden
          </button>
          @if (popovers.isOpen(endPopover)) {
            <div
              class="c-pop c-broadcast__pop"
              role="dialog"
              aria-label="Sendung beenden"
              [sfPopover]="endPopover"
            >
              <sf-confirm-box
                label="Sendung beenden"
                confirmLabel="Sendung beenden"
                [message]="endMessage()"
                [busy]="busy()"
                (confirm)="end()"
                (cancel)="popovers.close(endPopover)"
              />
            </div>
          }
        </div>
      }
      @case ('ended') {
        <span class="c-live is-quiet" [title]="endedTitle()"><b>BEENDET</b></span>
        <button
          class="c-btn c-btn--sm"
          type="button"
          [disabled]="busy() || !store.canCommand()"
          (click)="reset()"
        >
          Zurück auf Bereit
        </button>
        <button
          class="c-btn c-btn--sm c-btn--primary"
          type="button"
          [disabled]="busy() || !store.canCommand()"
          (click)="start()"
        >
          Sendung starten
        </button>
      }
      @default {
        <span class="c-live is-quiet" title="Der Output zeigt die Slate vor der Sendung"
          ><b>BEREIT</b></span
        >
        <button
          class="c-btn c-btn--sm c-btn--primary"
          type="button"
          [disabled]="busy() || !store.canCommand() || !store.state()"
          (click)="start()"
        >
          Sendung starten
        </button>
      }
    }
  `,
  styles: `
    :host {
      align-items: center;
      display: inline-flex;
      gap: 6px;
      white-space: nowrap;
    }

    .c-live {
      align-items: center;
      display: inline-flex;
      gap: 8px;
      padding: 0 8px;
      white-space: nowrap;

      b {
        font-size: 13px;
        font-weight: 700;
        letter-spacing: 0.06em;
      }

      &.is-quiet b {
        color: var(--muted);
      }
    }

    .c-live__dot {
      background: var(--red);
      border-radius: 50%;
      height: 8px;
      width: 8px;
    }

    .c-live__time {
      font-size: 13px;
      font-weight: 600;
    }

    .c-broadcast__pop {
      min-width: 300px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BroadcastControlComponent {
  protected readonly store = inject(ProductionStoreService);
  protected readonly popovers = inject(PopoverService);
  private readonly api = inject(StudioApiService);
  private readonly toasts = inject(ToastService);
  private readonly clock = inject(ClockService);

  protected readonly endPopover = BROADCAST_END_POPOVER;
  protected readonly busy = signal(false);
  protected readonly broadcast = this.store.broadcast;

  /** LIVE runtime «hh:mm:ss» since `liveSince` (server time). */
  protected readonly runtime = computed(() =>
    formatRuntime(this.store.elapsedSince(this.store.production()?.liveSince, this.clock.now())),
  );
  protected readonly endMessage = computed(() => {
    const title = this.store.production()?.endSlate.title;
    return title
      ? `Die Sendung wird beendet. Der Output zeigt danach «${title}».`
      : 'Die Sendung wird beendet. Der Output zeigt danach die Schluss-Slate.';
  });
  protected readonly endedTitle = computed(() =>
    this.store.production()?.endedAt
      ? 'Die Sendung ist beendet; der Output zeigt die Schluss-Slate'
      : '',
  );

  protected start(): Promise<void> {
    return this.run((id) => this.api.startBroadcast(id), 'Die Sendung läuft');
  }

  protected async end(): Promise<void> {
    await this.run((id) => this.api.endBroadcast(id), 'Sendung beendet');
    this.popovers.close(this.endPopover);
  }

  protected reset(): Promise<void> {
    return this.run((id) => this.api.resetBroadcast(id), 'Zurück auf Bereit');
  }

  private async run(
    request: (productionId: string) => Promise<unknown>,
    done: string,
  ): Promise<void> {
    const productionId = this.store.productionId();
    if (!productionId || this.busy()) {
      return;
    }
    this.busy.set(true);
    try {
      await request(productionId);
      this.toasts.show(done);
    } catch (error) {
      this.toasts.error(error);
    } finally {
      this.busy.set(false);
    }
  }
}
