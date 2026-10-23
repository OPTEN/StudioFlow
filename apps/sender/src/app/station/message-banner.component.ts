import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { t } from '@studioflow/i18n';
import { formatHm } from '@studioflow/scene-model';
import { IconComponent } from '../shared/icon.component';
import type { RegieMessage } from './device-session.service';

/** A message from the Regie (Regie-Chat), prominent, with time and “OK”. */
@Component({
  selector: 'sf-message-banner',
  imports: [IconComponent],
  template: `
    <section
      class="c-message"
      data-testid="message-banner"
      role="alert"
      aria-labelledby="regie-message-title"
    >
      <sf-icon class="c-message__icon" name="message" />
      <div class="c-message__body">
        <h2 class="c-message__title" id="regie-message-title">
          {{ t('sender.station.message.title') }}
          <span class="c-message__time u-mono">{{ time() }}</span>
        </h2>
        <p class="c-message__text">{{ message().text }}</p>
      </div>
      <button class="c-button c-button--fill c-message__ok" type="button" (click)="dismiss.emit()">
        {{ t('common.ok') }}
      </button>
    </section>
  `,
  styles: `
    :host {
      display: block;
    }

    .c-message {
      align-items: center;
      background: var(--raised-2);
      border: 1px solid var(--seam-strong);
      border-radius: 6px;
      box-shadow: var(--shadow-pop);
      display: grid;
      gap: 12px;
      grid-template-columns: auto minmax(0, 1fr) auto;
      padding: 12px 12px 12px 16px;
    }

    .c-message__icon {
      --icon-size: 24px;
      align-self: start;
      color: var(--text);
      margin-top: 2px;
    }

    .c-message__body {
      display: grid;
      gap: 4px;
      min-width: 0;
    }

    .c-message__title {
      color: var(--text-2);
      font-size: 14px;
      font-weight: 700;
    }

    .c-message__time {
      color: var(--muted);
      font-weight: 500;
      margin-left: 6px;
    }

    .c-message__text {
      font-size: 20px;
      font-weight: 700;
      line-height: 1.25;
      overflow-wrap: anywhere;
    }

    .c-message__ok {
      min-width: 64px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MessageBannerComponent {
  readonly message = input.required<RegieMessage>();
  readonly dismiss = output<void>();

  protected readonly t = t;

  protected readonly time = computed(() => formatHm(this.message().at));
}
