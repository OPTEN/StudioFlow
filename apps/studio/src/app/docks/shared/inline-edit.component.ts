import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterNextRender,
  inject,
  input,
  output,
  type OnInit,
} from '@angular/core';
import {
  FormControl,
  ReactiveFormsModule,
  type AbstractControl,
  type ValidationErrors,
} from '@angular/forms';

/**
 * Inline rename field (scene names, station names, media names): a text input that takes the focus with the text
 * selected. Enter or leaving the field saves (trimmed, 1…`maxLength` characters), Escape cancels. An unchanged
 * name counts as cancel. The parent shows it in place of the name and removes it on `save` or `cancel`.
 *
 * ```html
 * <fs-inline-edit label="Name der Szene" [value]="scene.name" [maxLength]="80"
 *   (save)="rename($event)" (cancel)="renaming.set(false)" />
 * ```
 */
@Component({
  selector: 'fs-inline-edit',
  imports: [ReactiveFormsModule],
  template: `
    <input
      class="c-input c-inline-edit__input"
      type="text"
      autocomplete="off"
      spellcheck="false"
      [attr.aria-label]="label()"
      [attr.maxlength]="maxLength()"
      [class.is-invalid]="control.invalid && control.dirty"
      [formControl]="control"
      (keydown)="onKeyDown($event)"
      (blur)="commit(false)"
    />
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }

    .c-inline-edit__input {
      height: 28px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InlineEditComponent implements OnInit {
  /** The current name. */
  readonly value = input.required<string>();
  /** Accessible name of the field, e.g. «Name der Szene». */
  readonly label = input.required<string>();
  /** Maximum length after trimming. */
  readonly maxLength = input(80);

  /** The new, trimmed and changed name. */
  readonly save = output<string>();
  /** Editing ended without a change (Escape, unchanged or invalid on blur). */
  readonly cancel = output<void>();

  protected readonly control = new FormControl('', {
    nonNullable: true,
    validators: [(control: AbstractControl<string>) => this.validate(control)],
  });

  private finished = false;

  constructor() {
    const element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    afterNextRender(() => {
      const field = element.querySelector('input');
      field?.focus();
      field?.select();
    });
  }

  ngOnInit(): void {
    this.control.setValue(this.value());
  }

  protected onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      this.commit(true);
    } else if (event.key === 'Escape') {
      // Consumed here: the global Escape layers (popover, pairing, selection) must not react as well.
      event.preventDefault();
      event.stopPropagation();
      this.finish(null);
    }
  }

  /** Saves the name; an invalid name keeps the field open on Enter and cancels on blur. */
  protected commit(fromEnter: boolean): void {
    if (this.finished) {
      return;
    }
    const name = this.control.value.trim();
    if (this.control.invalid) {
      if (fromEnter) {
        this.control.markAsDirty();
        return;
      }
      this.finish(null);
      return;
    }
    this.finish(name === this.value().trim() ? null : name);
  }

  private finish(name: string | null): void {
    if (this.finished) {
      return;
    }
    this.finished = true;
    if (name === null) {
      this.cancel.emit();
    } else {
      this.save.emit(name);
    }
  }

  private validate(control: AbstractControl<string>): ValidationErrors | null {
    const length = control.value.trim().length;
    if (length === 0) {
      return { required: true };
    }
    return length > this.maxLength() ? { maxlength: true } : null;
  }
}
