import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { t, type PlainMessageKey } from '@studioflow/i18n';
import { IconComponent } from '../core/ui/icon.component';

/** The steps of the first run: the account (`/setup`), then the wizard of the server (`/setup/server`). */
export type SetupStep = 'account' | 'media' | 'address' | 'embedding' | 'done';

const STEPS: readonly { readonly id: SetupStep; readonly label: PlainMessageKey }[] = [
  { id: 'account', label: 'regie.server.wizard.stepsAccount' },
  { id: 'media', label: 'regie.server.wizard.stepsMedia' },
  { id: 'address', label: 'regie.server.wizard.stepsAddress' },
  { id: 'embedding', label: 'regie.server.wizard.stepsEmbedding' },
  { id: 'done', label: 'regie.server.wizard.stepsDone' },
];

/**
 * The labelled progress of the first run (Account → Media server → Address → Embedding → Done), the same on the setup
 * page and in the wizard, so the two read as one flow. An ordered list: finished steps carry a check and the word
 * "completed" for screen readers, the current one `aria-current="step"`.
 */
@Component({
  selector: 'sf-setup-steps',
  imports: [IconComponent],
  template: `
    <ol class="c-steps" [attr.aria-label]="t('regie.server.wizard.steps')">
      @for (step of steps; track step.id; let index = $index) {
        <li
          class="c-steps__item"
          [class.is-done]="index < currentIndex()"
          [class.is-current]="index === currentIndex()"
          [attr.aria-current]="index === currentIndex() ? 'step' : null"
        >
          <span class="c-steps__dot" aria-hidden="true">
            @if (index < currentIndex() || step.id === 'done') {
              <svg sfIcon="check" [size]="11"></svg>
            } @else {
              {{ index + 1 }}
            }
          </span>
          <span class="c-steps__label">{{ t(step.label) }}</span>
          @if (index < currentIndex()) {
            <span class="u-sr-only">({{ t('regie.server.wizard.stepDone') }})</span>
          }
        </li>
      }
    </ol>
  `,
  styles: `
    @use 'mixins' as *;

    :host {
      display: block;
    }

    .c-steps {
      display: grid;
      grid-auto-columns: minmax(0, 1fr);
      grid-auto-flow: column;
      list-style: none;
      margin: 0;
      padding: 0;
    }

    // A dot per step joined by a hairline to the previous one; the label below.
    .c-steps__item {
      color: var(--muted);
      display: grid;
      font-size: 11px;
      gap: 5px;
      justify-items: center;
      position: relative;
      text-align: center;

      & + &::before {
        background: var(--seam-strong);
        content: '';
        height: 1px;
        left: calc(-50% + 13px);
        position: absolute;
        right: calc(50% + 13px);
        top: 10px;
      }

      &.is-done + &::before,
      &.is-current::before {
        background: var(--blue);
      }
    }

    .c-steps__dot {
      @include mono;
      @include state-transition(background-color, color, box-shadow);
      align-items: center;
      border-radius: 50%;
      box-shadow: inset 0 0 0 1px var(--seam-strong);
      display: inline-flex;
      font-size: 11px;
      font-weight: 600;
      height: 21px;
      justify-content: center;
      width: 21px;
    }

    .is-done .c-steps__dot {
      background: var(--blue-wash);
      box-shadow: none;
      color: var(--blue);
    }

    .is-current .c-steps__dot {
      background: var(--blue-fill);
      box-shadow: none;
      color: var(--on-fill);
    }

    .c-steps__label {
      line-height: 1.25;
    }

    .is-current .c-steps__label {
      color: var(--text);
      font-weight: 600;
    }

    // Narrow windows: only the current step keeps its label; the dots still show the progress.
    @include narrow {
      .c-steps__item:not(.is-current) .c-steps__label {
        @include ellipsis;
        max-width: 100%;
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SetupStepsComponent {
  /** The step on screen. */
  readonly current = input.required<SetupStep>();

  protected readonly t = t;
  protected readonly steps = STEPS;
  protected readonly currentIndex = computed(() =>
    STEPS.findIndex((step) => step.id === this.current()),
  );
}
