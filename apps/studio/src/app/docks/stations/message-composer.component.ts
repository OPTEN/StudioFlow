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
import { LIMITS, type DeviceDto } from '@flowstudio/scene-model';
import { IconComponent } from '../../core/ui/icon.component';
import { QUICK_MESSAGES, StationCommandsService } from './station-commands.service';

/**
 * Regie-Chat composer of a station (spec 4.6 «message»): a short text (1–140 characters) with a counter, «Senden»
 * and the quick picks «In 10 s live», «Bitte lächeln», «Pause», which send at once. The device shows the text as a
 * banner. Escape closes the composer. Sending is locked while a message is in flight.
 */
@Component({
  selector: 'fs-message-composer',
  imports: [IconComponent, ReactiveFormsModule],
  template: `
    <form class="c-composer" (submit)="send($event)">
      <div class="c-composer__row">
        <input
          class="c-input"
          type="text"
          autocomplete="off"
          placeholder="Kurze Nachricht an die Station"
          [attr.maxlength]="maxLength"
          [attr.aria-label]="'Nachricht an ' + device().name"
          [formControl]="control"
          (keydown.escape)="onEscape($event)"
        />
        <button class="c-btn c-btn--sm c-btn--fill" type="submit" [disabled]="busy() || !canSend()">
          <svg fsIcon="send" [size]="14"></svg>Senden
        </button>
      </div>
      <div class="c-composer__row">
        @for (text of quickMessages; track text) {
          <button
            class="c-btn c-btn--sm"
            type="button"
            [disabled]="busy()"
            [attr.aria-label]="'Schnell senden: ' + text"
            (click)="sendQuick(text)"
          >
            {{ text }}
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

  protected readonly maxLength = LIMITS.messageLength;
  protected readonly quickMessages = QUICK_MESSAGES;
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

  protected sendQuick(text: string): void {
    void this.commands.sendMessage(this.device(), text);
  }

  protected onEscape(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    this.closed.emit();
  }
}
