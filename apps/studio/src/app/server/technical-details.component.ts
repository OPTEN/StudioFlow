import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { t } from '@studioflow/i18n';

/**
 * "Technical details": a closed disclosure for whoever runs the server, with the reason a service gave (English, from
 * the API) and the command that shows more. Operators read the plain sentence next to it and can ignore this.
 */
@Component({
  selector: 'sf-technical-details',
  template: `
    @if (command() || detail()) {
      <details class="c-details">
        <summary>{{ t('regie.server.details.summary') }}</summary>
        @if (detail(); as text) {
          <p class="c-details__text">{{ text }}</p>
        }
        @if (command(); as text) {
          <p class="c-details__text">{{ t('regie.server.details.run') }}</p>
          <code class="c-details__command">{{ text }}</code>
        }
      </details>
    }
  `,
  styles: `
    @use 'mixins' as *;

    :host {
      display: block;
    }

    .c-details {
      font-size: 12px;

      summary {
        border-radius: var(--radius-xs);
        color: var(--blue);
        cursor: pointer;
        width: fit-content;
      }

      &[open] summary {
        margin-bottom: 6px;
      }
    }

    .c-details__text {
      color: var(--text-2);
      line-height: 1.45;
    }

    .c-details__command {
      @include code;
      background: var(--fill);
      border-radius: var(--radius-sm);
      color: var(--text);
      display: block;
      font-size: 12px;
      margin-top: 4px;
      overflow-wrap: anywhere;
      padding: 6px 8px;
      user-select: all;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TechnicalDetailsComponent {
  /** The command that shows more on the server. */
  readonly command = input<string | null | undefined>(null);
  /** The reason the service gave. */
  readonly detail = input<string | null | undefined>(null);

  protected readonly t = t;
}
