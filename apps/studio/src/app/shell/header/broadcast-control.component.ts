import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { t, type PlainMessageKey } from '@studioflow/i18n';
import { formatRuntime } from '@studioflow/scene-model';
import { StudioApiService } from '../../core/api/studio-api.service';
import { ProductionStoreService } from '../../core/state/production-store.service';
import { ClockService } from '../../core/ui/clock.service';
import { IconComponent } from '../../core/ui/icon.component';
import {
  PopoverDirective,
  PopoverService,
  PopoverTriggerDirective,
} from '../../core/ui/popover.directive';
import { ToastService } from '../../core/ui/toast.service';

/** Id of the "Start broadcast" confirmation popover (with the pre-flight checks). */
export const BROADCAST_START_POPOVER = 'broadcast-start';
/** Id of the "End broadcast" confirmation popover. */
export const BROADCAST_END_POPOVER = 'broadcast-end';

/** One line of the pre-flight check before going on air. */
interface Check {
  readonly id: string;
  readonly ok: boolean;
  readonly text: string;
  readonly hint: string | null;
}

/**
 * The broadcast capsule in the centre of the toolbar (spec 4.2, 9.1): the state in a word ("Off air", "On air" with the
 * runtime, "Ended") and the one action that moves it on. Going on air and ending both ask first in a small popover that
 * names the consequence; "Start broadcast" also shows a pre-flight check (is an output connected, are issues open,
 * which scene is on Program), so nobody goes live into an empty proxy by accident. After the end, "Back to standby"
 * shows the slate from before the broadcast again and "Start again…" restarts.
 *
 * While a request runs the confirm button says "Starting…" or "Ending…"; while the control room has no connection the
 * buttons are disabled and the capsule says why in its tooltip.
 */
@Component({
  selector: 'sf-broadcast-control',
  imports: [IconComponent, NgTemplateOutlet, PopoverTriggerDirective, PopoverDirective],
  template: `
    <div
      class="c-broadcast"
      [class.is-live]="broadcast() === 'live'"
      [class.is-ended]="broadcast() === 'ended'"
      [attr.title]="unavailable() ? t('regie.header.broadcast.offline') : null"
    >
      @switch (broadcast()) {
        @case ('live') {
          <span class="c-live" [title]="t('regie.header.broadcast.sinceStart')">
            <span class="c-live__dot" aria-hidden="true"></span>
            <b>{{ t('regie.header.broadcast.onAir') }}</b>
            <span class="u-mono c-live__time">{{ runtime() }}</span>
          </span>
          <div class="c-pop-wrap">
            <button
              class="c-btn c-btn--sm c-btn--danger"
              type="button"
              aria-haspopup="dialog"
              [sfPopoverTrigger]="endPopover"
              [disabled]="busy() || unavailable()"
            >
              {{ t('regie.header.broadcast.end') }}
            </button>
            @if (popovers.isOpen(endPopover)) {
              <div
                class="c-pop c-broadcast__pop"
                role="dialog"
                aria-labelledby="sf-broadcast-end-title"
                aria-describedby="sf-broadcast-end-text"
                [sfPopover]="endPopover"
              >
                <h2 class="c-broadcast__title" id="sf-broadcast-end-title">
                  {{ t('regie.header.broadcast.endHeading') }}
                </h2>
                <p class="c-broadcast__text" id="sf-broadcast-end-text">{{ endMessage() }}</p>
                <div class="c-broadcast__actions">
                  <button
                    class="c-btn"
                    type="button"
                    [disabled]="busy()"
                    (click)="popovers.close(endPopover)"
                  >
                    {{ t('common.cancel') }}
                  </button>
                  <button
                    class="c-btn c-btn--danger-fill"
                    type="button"
                    [disabled]="busy()"
                    (click)="end()"
                  >
                    {{
                      busy() ? t('regie.header.broadcast.ending') : t('regie.header.broadcast.end')
                    }}
                  </button>
                </div>
              </div>
            }
          </div>
        }
        @case ('ended') {
          <span class="c-live is-quiet" [title]="endedTitle()">
            <svg sfIcon="stop" [size]="13"></svg>
            <b>{{ t('regie.header.broadcast.ended') }}</b>
          </span>
          <button
            class="c-btn c-btn--sm c-btn--primary"
            type="button"
            [title]="t('regie.header.broadcast.resetTitle')"
            [disabled]="busy() || unavailable()"
            (click)="reset()"
          >
            {{ t('regie.header.broadcast.reset') }}
          </button>
          <ng-container *ngTemplateOutlet="startTrigger" />
        }
        @default {
          <span class="c-live is-quiet" [title]="t('regie.header.broadcast.offAirTitle')">
            <span class="c-live__dot is-off" aria-hidden="true"></span>
            <b>{{ t('regie.header.broadcast.offAir') }}</b>
          </span>
          <ng-container *ngTemplateOutlet="startTrigger" />
        }
      }
    </div>

    <ng-template #startTrigger>
      <div class="c-pop-wrap">
        <button
          type="button"
          aria-haspopup="dialog"
          [class]="
            broadcast() === 'ended'
              ? 'c-btn c-btn--sm c-btn--plain'
              : 'c-btn c-btn--sm c-btn--primary'
          "
          [sfPopoverTrigger]="startPopover"
          [disabled]="busy() || unavailable() || !store.state()"
        >
          {{
            broadcast() === 'ended'
              ? t('regie.header.broadcast.restart')
              : t('regie.header.broadcast.start')
          }}
        </button>
        @if (popovers.isOpen(startPopover)) {
          <div
            class="c-pop c-broadcast__pop"
            role="dialog"
            aria-labelledby="sf-broadcast-start-title"
            aria-describedby="sf-broadcast-start-text"
            [sfPopover]="startPopover"
          >
            <h2 class="c-broadcast__title" id="sf-broadcast-start-title">
              {{ t('regie.header.broadcast.startHeading') }}
            </h2>
            <p class="c-broadcast__text" id="sf-broadcast-start-text">
              {{ t('regie.header.broadcast.startConfirm') }}
            </p>
            <ul class="c-broadcast__checks">
              @for (check of checks(); track check.id) {
                <li class="c-broadcast__check" [class.is-warn]="!check.ok">
                  <svg [sfIcon]="check.ok ? 'circle-check' : 'alert'" [size]="15"></svg>
                  <span>
                    {{ check.text }}
                    @if (check.hint) {
                      <span class="c-broadcast__hint">{{ check.hint }}</span>
                    }
                  </span>
                </li>
              }
            </ul>
            <div class="c-broadcast__actions">
              <button
                class="c-btn"
                type="button"
                [disabled]="busy()"
                (click)="popovers.close(startPopover)"
              >
                {{ t('common.cancel') }}
              </button>
              <button class="c-btn c-btn--fill" type="button" [disabled]="busy()" (click)="start()">
                {{
                  busy() ? t('regie.header.broadcast.starting') : t('regie.header.broadcast.start')
                }}
              </button>
            </div>
          </div>
        }
      </div>
    </ng-template>
  `,
  styleUrl: './broadcast-control.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BroadcastControlComponent {
  protected readonly store = inject(ProductionStoreService);
  protected readonly popovers = inject(PopoverService);
  private readonly api = inject(StudioApiService);
  private readonly toasts = inject(ToastService);
  private readonly clock = inject(ClockService);

  protected readonly t = t;
  protected readonly startPopover = BROADCAST_START_POPOVER;
  protected readonly endPopover = BROADCAST_END_POPOVER;
  protected readonly busy = signal(false);
  protected readonly broadcast = this.store.broadcast;
  /** Commands need a live connection and a loaded production. */
  protected readonly unavailable = computed(() => !this.store.canCommand());

  /** On-air runtime "hh:mm:ss" since `liveSince` (server time). */
  protected readonly runtime = computed(() =>
    formatRuntime(this.store.elapsedSince(this.store.production()?.liveSince, this.clock.now())),
  );
  protected readonly endMessage = computed(() => {
    const title = this.store.production()?.endSlate.title;
    return title
      ? t('regie.header.broadcast.endConfirm', { title })
      : t('regie.header.broadcast.endConfirmNoTitle');
  });
  protected readonly endedTitle = computed(() =>
    this.store.production()?.endedAt ? t('regie.header.broadcast.endedTitle') : '',
  );

  /** Pre-flight before going on air: output, open issues, the scene on Program. */
  protected readonly checks = computed<readonly Check[]>(() => {
    const output = this.store.outputStatus()?.state === 'connected';
    const issues = this.store.openIncidents().length;
    const program = this.store.programScene();
    return [
      {
        id: 'output',
        ok: output,
        text: output ? t('regie.header.check.outputOk') : t('regie.header.check.outputNone'),
        hint: output ? null : t('regie.header.check.outputNoneHint'),
      },
      {
        id: 'issues',
        ok: issues === 0,
        text:
          issues === 0
            ? t('regie.header.check.issuesNone')
            : t('regie.header.check.issues', { count: issues }),
        hint: null,
      },
      {
        id: 'program',
        ok: program !== null,
        text: program
          ? t('regie.header.check.program', { scene: program.name })
          : t('regie.header.check.programNone'),
        hint: null,
      },
    ];
  });

  protected async start(): Promise<void> {
    await this.run((id) => this.api.startBroadcast(id), 'regie.header.broadcast.startDone');
    this.popovers.close(this.startPopover);
  }

  protected async end(): Promise<void> {
    await this.run((id) => this.api.endBroadcast(id), 'regie.header.broadcast.endDone');
    this.popovers.close(this.endPopover);
  }

  protected reset(): Promise<void> {
    return this.run((id) => this.api.resetBroadcast(id), 'regie.header.broadcast.resetDone');
  }

  private async run(
    request: (productionId: string) => Promise<unknown>,
    done: PlainMessageKey,
  ): Promise<void> {
    const productionId = this.store.productionId();
    if (!productionId || this.busy()) {
      return;
    }
    this.busy.set(true);
    try {
      await request(productionId);
      this.toasts.success(t(done));
    } catch (error) {
      this.toasts.error(error);
    } finally {
      this.busy.set(false);
    }
  }
}
