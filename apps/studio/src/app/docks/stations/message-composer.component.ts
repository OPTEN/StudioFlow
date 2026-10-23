import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  input,
  output,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { t } from '@studioflow/i18n';
import { LIMITS, type DeviceDto } from '@studioflow/scene-model';
import { IconComponent } from '../../core/ui/icon.component';
import { QUICK_MESSAGE_KEYS, StationCommandsService } from './station-commands.service';

/**
 * Control room chat composer of a station (spec 4.6 "message"): a short text (1–140 characters) with a counter, "Send"
 * and the quick picks "Live in 10 s", "Please smile", "Break", which send at once. The device shows the text as a
 * banner. Escape closes the composer. Sending is locked while a message is in flight.
 */
@Component({
  selector: 'sf-message-composer',
  imports: [IconComponent, ReactiveFormsModule],
  template: `
    <form class="c-composer" (submit)="send($event)">
      <div class="c-composer__row">
        <input
          class="c-input"
          type="text"
          autocomplete="off"
          [attr.placeholder]="t('regie.stations.composer.placeholder')"
          [attr.maxlength]="maxLength"
          [attr.aria-label]="t('regie.stations.composer.label', { name: device().name })"
          [formControl]="control"
          (keydown.escape)="onEscape($event)"
        />
        <button class="c-btn c-btn--sm c-btn--fill" type="submit" [disabled]="busy() || !canSend()">
          <svg sfIcon="send" [size]="14"></svg>{{ t('regie.stations.composer.send') }}
        </button>
      </div>
      <div class="c-composer__row">
        @for (quick of quickMessages; track quick) {
          <button
            class="c-btn c-btn--sm"
            type="button"
            [disabled]="busy()"
            [attr.aria-label]="t('regie.stations.composer.quick', { text: t(quick) })"
            (click)="sendQuick(quick)"
          >
            {{ t(quick) }}
          </button>
        }
        <span class="c-composer__count" aria-live="polite">{{ length() }}/{{ maxLength }}</span>
      </div>
    </form>
  `,
  styles: `
    .c-composer {
      display: grid;
      gap: 6px;
    }

    .c-composer__row {
      align-items: center;
      display: flex;
      flex-wrap: wrap;
      gap: 6px;

      .c-input {
        flex: 1 1 160px;
        height: 28px;
        min-width: 0;
      }
    }

    .c-composer__count {
      color: var(--muted);
      font: 500 11px var(--font-mono);
      margin-left: auto;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MessageComposerComponent {
  /** Recipient. */
  readonly device = input.required<DeviceDto>();
  /** Escape: the row closes the composer. */
  readonly closed = output<void>();

  private readonly commands = inject(StationCommandsService);

  protected readonly t = t;
  protected readonly maxLength = LIMITS.messageLength;
  protected readonly quickMessages = QUICK_MESSAGE_KEYS;
  protected readonly control = new FormControl('', {
    nonNullable: true,
    validators: [Validators.maxLength(LIMITS.messageLength), Validators.pattern(/\S/)],
  });
  private readonly value = toSignal(this.control.valueChanges, { initialValue: '' });
  protected readonly length = computed(() => this.value().trim().length);
  protected readonly canSend = computed(
    () => this.length() > 0 && this.length() <= LIMITS.messageLength,
  );
  protected readonly busy = computed(() => this.commands.blocked(this.device().id, 'message'));

  constructor() {
    const element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    afterNextRender(() => element.querySelector<HTMLInputElement>('input')?.focus());
  }

  protected async send(event: Event): Promise<void> {
    event.preventDefault();
    if (!this.canSend() || this.busy()) {
      return;
    }
    if (await this.commands.sendMessage(this.device(), this.control.value)) {
      this.control.reset('');
    }
  }

  protected sendQuick(quick: (typeof QUICK_MESSAGE_KEYS)[number]): void {
    void this.commands.sendMessage(this.device(), t(quick));
  }

  protected onEscape(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    this.closed.emit();
  }
}
