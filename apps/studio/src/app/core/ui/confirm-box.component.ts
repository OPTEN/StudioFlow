import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterNextRender,
  inject,
  input,
  output,
} from '@angular/core';
import { t } from '@studioflow/i18n';

/**
 * Dashed red confirmation box for risky actions (DESIGN.md "Danger"): message, a solid red confirm button and
 * "Cancel". The focus moves to "Cancel" when the box appears, so a second Enter never confirms by accident.
 * `[busy]` disables both buttons while the request runs.
 *
 * ```html
 * <sf-confirm-box [message]="t('regie.header.output.regenerateMessage')"
 *   [confirmLabel]="t('regie.header.output.regenerateConfirm')" [busy]="regenerating()" (confirm)="regenerate()" (cancel)="asking.set(false)" />
 * ```
 */
@Component({
  selector: 'sf-confirm-box',
  template: `
    <div
      class="c-confirm"
      [class.c-confirm--flush]="flush()"
      role="group"
      [attr.aria-label]="label() ?? t('regie.core.confirm.label')"
    >
      <span>{{ message() }}</span>
      <div class="c-confirm__row">
        <button
          class="c-btn c-btn--sm c-btn--danger-fill"
          type="button"
          [disabled]="busy()"
          (click)="confirm.emit()"
        >
          {{ confirmLabel() }}
        </button>
        <button
          class="c-btn c-btn--sm"
          type="button"
          data-cancel
          [disabled]="busy()"
          (click)="cancel.emit()"
        >
          {{ t('common.cancel') }}
        </button>
      </div>
    </div>
  `,
  host: { style: 'display: contents' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConfirmBoxComponent {
  protected readonly t = t;

  /** The consequence, in one or two sentences. */
  readonly message = input.required<string>();
  /** Label of the final action, e.g. "Block now". */
  readonly confirmLabel = input.required<string>();
  /** Accessible name of the group (default "Confirmation"). */
  readonly label = input<string | null>(null);
  /** Without the outer margin, for danger zones (prototype `style="margin:0;flex:1 1 100%"`). */
  readonly flush = input(false);
  /** Disables the buttons while the action runs. */
  readonly busy = input(false);
  /** Focus "Cancel" when shown (default true). */
  readonly autofocus = input(true);

  /** The user confirmed. */
  readonly confirm = output<void>();
  /** The user cancelled. */
  readonly cancel = output<void>();

  constructor() {
    const element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    afterNextRender(() => {
      if (this.autofocus()) {
        element.querySelector<HTMLButtonElement>('[data-cancel]')?.focus();
      }
    });
  }
}
