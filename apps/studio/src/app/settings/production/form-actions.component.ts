import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { t } from '@studioflow/i18n';

let nextId = 0;

/**
 * The save bar of a production settings form: the state of the form in words ("No changes", "Unsaved changes",
 * "Saving…"), "Discard changes" while something changed, and the specific save action ("Save slates"). The save button
 * stays disabled while nothing changed; the state text says why and describes the button. With `submit` the button
 * submits the surrounding form (Enter in a field saves too); otherwise it reports `save`.
 */
@Component({
  selector: 'sf-form-actions',
  template: `
    <span class="c-form-actions__state" [class.is-dirty]="dirty() && !busy()" [id]="stateId">
      @if (busy()) {
        {{ t('regie.production.form.saving') }}
      } @else if (dirty()) {
        {{ t('regie.production.form.unsaved') }}
      } @else {
        {{ t('regie.production.form.clean') }}
      }
    </span>
    @if (dirty()) {
      <button class="c-btn" type="button" [disabled]="busy()" (click)="discard.emit()">
        {{ t('regie.production.form.discard') }}
      </button>
    }
    <button
      class="c-btn c-btn--fill"
      [attr.type]="submit() ? 'submit' : 'button'"
      [disabled]="!dirty() || busy()"
      [attr.aria-describedby]="stateId"
      (click)="submit() ? null : save.emit()"
    >
      {{ saveLabel() }}
    </button>
  `,
  styles: `
    :host {
      align-items: center;
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      justify-content: flex-end;
    }

    .c-form-actions__state {
      color: var(--muted);
      font-size: 12px;
      margin-right: auto;

      &.is-dirty {
        align-items: center;
        color: var(--text-2);
        display: inline-flex;
        gap: 6px;

        &::before {
          background: currentColor;
          border-radius: 50%;
          content: '';
          height: 6px;
          width: 6px;
        }
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FormActionsComponent {
  /** Something differs from what is saved. */
  readonly dirty = input.required<boolean>();
  /** The save request runs. */
  readonly busy = input(false);
  /** The specific label of the save action ("Save slates"). */
  readonly saveLabel = input.required<string>();
  /** The button submits the surrounding form instead of reporting `save`. */
  readonly submit = input(false);

  /** Save was pressed (only without `submit`). */
  readonly save = output<void>();
  /** "Discard changes" was pressed. */
  readonly discard = output<void>();

  protected readonly t = t;
  protected readonly stateId = `sf-form-state-${++nextId}`;
}
