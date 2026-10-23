import { DOCUMENT } from '@angular/common';
import { Directive, ElementRef, effect, inject, input, output } from '@angular/core';

/**
 * Numeric inspector field (prototype `#insp` number inputs): `<input type="number" [sfNumberField]="item.x"
 * (numberChange)="setX($event)" (editStart)="…" (editEnd)="…">`.
 *
 * - Commits on every `input` event with a finite number (empty or partial input such as «-» is ignored).
 * - Shows the model value, but never overwrites the field while it has the focus (prototype
 *   `syncInspectorNumbers`), so typing is not disturbed by clamping or by live updates from a drag on the monitor;
 *   on blur the field shows the (clamped) model value again.
 * - `editStart`/`editEnd` fire on focus/blur, so the owner can wrap one editing session into one undo step.
 */
@Directive({
  selector: 'input[sfNumberField]',
  host: {
    '(input)': 'onInput()',
    '(focus)': 'editStart.emit()',
    '(blur)': 'onBlur()',
  },
})
export class NumberFieldDirective {
  /** The model value shown in the field. */
  readonly sfNumberField = input.required<number>();
  /** Decimals shown (0 = integers). */
  readonly fractionDigits = input(0);

  /** A new finite value typed by the user. */
  readonly numberChange = output<number>();
  /** The field got the focus. */
  readonly editStart = output<void>();
  /** The field lost the focus. */
  readonly editEnd = output<void>();

  private readonly element = inject<ElementRef<HTMLInputElement>>(ElementRef).nativeElement;
  private readonly document = inject(DOCUMENT);

  constructor() {
    effect(() => {
      const text = this.format(this.sfNumberField());
      if (this.document.activeElement !== this.element) {
        this.element.value = text;
      }
    });
  }

  protected onInput(): void {
    const typed = this.element.valueAsNumber;
    const value = Number.isFinite(typed) ? typed : Number.parseFloat(this.element.value);
    if (Number.isFinite(value)) {
      this.numberChange.emit(value);
    }
  }

  protected onBlur(): void {
    this.element.value = this.format(this.sfNumberField());
    this.editEnd.emit();
  }

  private format(value: number): string {
    if (!Number.isFinite(value)) {
      return '';
    }
    const digits = this.fractionDigits();
    const factor = 10 ** digits;
    return String(Math.round(value * factor) / factor);
  }
}
