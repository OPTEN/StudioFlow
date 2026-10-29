import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { tm } from '@studioflow/i18n';
import { IconComponent } from '../core/ui/icon.component';
import type { ServerProblem } from './apply-messages';
import { TechnicalDetailsComponent } from './technical-details.component';

/**
 * A problem of a server form, next to the action that failed: the operator's sentence with an alert icon on a red wash,
 * and below it the closed "Technical details" for whoever runs the server. `role="alert"`, so it is read out when it
 * appears. `quiet` turns it into a neutral notice (`role="status"`: saved, but a service picks it up later).
 */
@Component({
  selector: 'sf-server-problem',
  imports: [IconComponent, TechnicalDetailsComponent],
  template: `
    @if (problem(); as current) {
      <div
        class="c-problem"
        [class.c-problem--quiet]="quiet()"
        [attr.role]="quiet() ? 'status' : 'alert'"
      >
        <p class="c-problem__text">
          <svg [sfIcon]="quiet() ? 'info' : 'alert'" [size]="15"></svg>
          <span>{{ text() }}</span>
        </p>
        <sf-technical-details
          class="c-problem__details"
          [command]="current.command"
          [detail]="current.detail"
        />
      </div>
    }
  `,
  styles: `
    :host {
      display: block;
    }

    .c-problem {
      background: var(--red-wash);
      border-radius: var(--radius-lg);
      display: grid;
      gap: 6px;
      padding: 10px 14px;
    }

    .c-problem--quiet {
      background: var(--fill);
    }

    .c-problem__text {
      align-items: flex-start;
      color: var(--text);
      display: flex;
      font-size: 13px;
      gap: 8px;
      line-height: 1.45;

      .c-icon {
        color: var(--red);
        margin-top: 2px;
      }
    }

    .c-problem--quiet .c-problem__text .c-icon {
      color: var(--muted);
    }

    .c-problem__details {
      padding-left: 23px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ServerProblemComponent {
  /** The problem; nothing is shown while null. */
  readonly problem = input<ServerProblem | null>(null);
  /** A notice rather than a failure. */
  readonly quiet = input(false);

  protected readonly text = computed(() => tm(this.problem()?.message ?? null));
}
