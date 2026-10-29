import { Directive, ElementRef, afterNextRender, inject, output } from '@angular/core';

/** Targets that handle Enter themselves: a button presses itself, a field submits or chooses. */
const OWN_ENTER = 'button, a[href], input, select, textarea, summary, [contenteditable="true"]';

/**
 * Keys of a confirmation (an inline `.c-confirm` box or the body of a confirm sheet): Enter confirms and Escape cancels,
 * the way a system alert does. The box takes the focus when it appears (it gets `tabindex="-1"`), so Enter works at once
 * without first tabbing to a button; Tab then reaches “Cancel” and the confirming button as usual. Enter on a focused
 * button still presses that button. The keys only act while the focus is inside the box, so they never reach a
 * presentation in another window.
 */
@Directive({
  selector: '[sfConfirmKeys]',
  host: {
    tabindex: '-1',
    '(keydown)': 'onKey($event)',
  },
})
export class ConfirmKeysDirective {
  /** Enter was pressed outside a button. */
  readonly confirmKey = output<void>();
  /** Escape was pressed. */
  readonly cancelKey = output<void>();

  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  constructor() {
    // Inside a sheet the dialog focuses its `[autofocus]` element once it is open; inline boxes focus themselves.
    afterNextRender(() => {
      if (this.element.closest('dialog') === null) {
        this.element.focus();
      }
    });
  }

  protected onKey(event: KeyboardEvent): void {
    if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.cancelKey.emit();
      return;
    }
    const target = event.target as Element | null;
    if (event.key === 'Enter' && (target === null || target.closest(OWN_ENTER) === null)) {
      event.preventDefault();
      this.confirmKey.emit();
    }
  }
}
