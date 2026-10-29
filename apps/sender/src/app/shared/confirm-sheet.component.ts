import { ChangeDetectionStrategy, Component, input, output, viewChild } from '@angular/core';
import { t } from '@studioflow/i18n';
import { ConfirmKeysDirective } from './confirm-keys.directive';
import { SheetComponent } from './sheet.component';

/**
 * Confirmation of a consequential action as a modal sheet (“Switch the camera while live?”): the title asks, the text
 * names the consequence, the filled red button does it and “Cancel” keeps everything as it is. Like a system alert,
 * Enter confirms and Escape cancels (the keys show as chips on a laptop); a tap on the backdrop cancels too.
 */
@Component({
  selector: 'sf-confirm-sheet',
  imports: [ConfirmKeysDirective, SheetComponent],
  template: `
    <sf-sheet
      labelledBy="confirm-sheet-title"
      describedBy="confirm-sheet-text"
      testId="confirm-sheet"
      (closed)="closed()"
    >
      <div class="c-sheet__head">
        <h2 class="c-sheet__title" id="confirm-sheet-title">{{ title() }}</h2>
      </div>
      <div
        class="c-sheet__body c-sheet__body--keys"
        autofocus
        sfConfirmKeys
        (confirmKey)="ok()"
        (cancelKey)="sheet().close()"
      >
        <p class="c-sheet__text" id="confirm-sheet-text">{{ text() }}</p>
        <div class="c-sheet__actions">
          <button
            class="c-btn c-btn--danger-fill c-btn--lg"
            type="button"
            data-testid="confirm-sheet-ok"
            aria-keyshortcuts="Enter"
            (click)="ok()"
          >
            {{ confirmLabel() }}
            <kbd class="c-btn__key" aria-hidden="true">↵</kbd>
          </button>
          <button
            class="c-btn c-btn--lg"
            type="button"
            aria-keyshortcuts="Escape"
            (click)="sheet().close()"
          >
            {{ t('common.cancel') }}
            <kbd class="c-btn__key" aria-hidden="true">esc</kbd>
          </button>
        </div>
      </div>
    </sf-sheet>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConfirmSheetComponent {
  readonly title = input.required<string>();
  readonly text = input.required<string>();
  /** Label of the confirming button: the action itself (“Switch camera”), never “OK”. */
  readonly confirmLabel = input.required<string>();
  /** The person confirmed; the sheet closes. */
  readonly confirmed = output<void>();
  /** The sheet closed without a confirmation. */
  readonly cancelled = output<void>();

  protected readonly t = t;
  protected readonly sheet = viewChild.required(SheetComponent);
  private done = false;

  protected ok(): void {
    this.done = true;
    this.confirmed.emit();
    this.sheet().close();
  }

  protected closed(): void {
    if (!this.done) {
      this.cancelled.emit();
    }
  }
}
