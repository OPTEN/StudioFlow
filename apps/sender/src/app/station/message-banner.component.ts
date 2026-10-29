import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { t } from '@studioflow/i18n';
import { formatHm } from '@studioflow/scene-model';
import { IconComponent } from '../shared/icon.component';
import type { RegieMessage } from './device-session.service';

/**
 * A message from the Regie (Regie-Chat): large text with the time, on the floating surface, until the person dismisses
 * it. It never disappears by itself, so an unattended phone or a speaker in another window still sees it later.
 */
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
      <span class="c-message__icon"><sf-icon name="message" /></span>
      <div class="c-message__body">
        <h2 class="c-message__title" id="regie-message-title">
          {{ t('sender.station.message.title') }}
          <span class="c-message__time u-mono">{{ time() }}</span>
        </h2>
        <p class="c-message__text">{{ message().text }}</p>
      </div>
      <button class="c-btn c-btn--fill c-message__dismiss" type="button" (click)="dismiss.emit()">
        {{ t('sender.station.message.dismiss') }}
      </button>
    </section>
  `,
  styles: `
    :host {
      display: block;
    }

    .c-message {
      align-items: center;
      background: var(--float);
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow-pop);
      display: grid;
      gap: 10px 14px;
      grid-template-areas: 'icon body action';
      grid-template-columns: auto minmax(0, 1fr) auto;
      padding: 14px 14px 14px 16px;
    }

    .c-message__icon {
      --icon-size: 20px;
      align-items: center;
      align-self: start;
      background: var(--blue-wash);
      border-radius: 50%;
      color: var(--blue);
      display: inline-flex;
      grid-area: icon;
      height: 38px;
      justify-content: center;
      width: 38px;
    }

    .c-message__body {
      display: grid;
      gap: 4px;
      grid-area: body;
      min-width: 0;
    }

    .c-message__title {
      color: var(--text-2);
      font-size: var(--fs-subhead);
      font-weight: 600;
      letter-spacing: 0;
    }

    .c-message__time {
      color: var(--muted);
      font-weight: 500;
      margin-left: 6px;
    }

    .c-message__text {
      font-size: var(--fs-title-3);
      font-weight: 600;
      line-height: 1.3;
      overflow-wrap: anywhere;
    }

    .c-message__dismiss {
      grid-area: action;
    }

    @media (max-width: 479px) {
      .c-message {
        grid-template-areas:
          'icon body'
          'action action';
        grid-template-columns: auto minmax(0, 1fr);
      }

      .c-message__dismiss {
        width: 100%;
      }
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
