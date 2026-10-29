import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  inject,
  input,
  output,
  viewChild,
} from '@angular/core';

/**
 * A modal sheet: a native `<dialog>` opened with `showModal()` as soon as it is rendered, so the page behind is inert,
 * focus stays inside, Escape closes it and focus returns to the control that opened it. A bottom sheet on phones, a
 * centred card from 768 px (`.c-sheet`). The parent renders it with `@if` and removes it on `closed`; closing always
 * goes through the dialog (Escape, a tap on the backdrop or {@link close}).
 */
@Component({
  selector: 'sf-sheet',
  template: `
    <dialog
      class="c-sheet"
      #dialog
      [attr.aria-labelledby]="labelledBy()"
      [attr.aria-describedby]="describedBy()"
      [attr.data-testid]="testId()"
      (close)="onClose()"
      (click)="onClick($event)"
    >
      <div class="c-sheet__grabber" aria-hidden="true"></div>
      <ng-content />
    </dialog>
  `,
  styles: `
    :host {
      display: contents;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SheetComponent {
  /** Id of the heading that names the sheet. */
  readonly labelledBy = input.required<string>();
  /** Id of the text that describes the sheet, if any. */
  readonly describedBy = input<string | null>(null);
  /** `data-testid` of the dialog. */
  readonly testId = input<string | null>(null);
  /** The sheet was closed (Escape, backdrop, or {@link close}). */
  readonly closed = output<void>();

  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private opener: HTMLElement | null = null;
  private element: HTMLDialogElement | null = null;
  private open = false;

  constructor() {
    afterNextRender(() => this.show());
    inject(DestroyRef).onDestroy(() => {
      const element = this.element;
      if (this.open && element !== null) {
        this.open = false;
        this.dismiss(element);
        this.restoreFocus(element);
      }
    });
  }

  /** Closes the sheet; `closed` follows. */
  close(): void {
    const dialog = this.dialog().nativeElement;
    if (typeof dialog.close === 'function') {
      dialog.close();
    } else {
      dialog.removeAttribute('open');
      this.onClose();
    }
  }

  protected onClose(): void {
    if (!this.open) {
      return;
    }
    this.open = false;
    this.restoreFocus(this.dialog().nativeElement);
    this.closed.emit();
  }

  /** A tap on the backdrop (outside the sheet's box) closes it. */
  protected onClick(event: MouseEvent): void {
    const dialog = this.dialog().nativeElement;
    if (event.target !== dialog || (event.clientX === 0 && event.clientY === 0)) {
      return;
    }
    const box = dialog.getBoundingClientRect();
    const inside =
      event.clientX >= box.left &&
      event.clientX <= box.right &&
      event.clientY >= box.top &&
      event.clientY <= box.bottom;
    if (!inside) {
      this.close();
    }
  }

  private show(): void {
    const dialog = this.dialog().nativeElement;
    this.element = dialog;
    const active = dialog.ownerDocument.activeElement;
    this.opener = active instanceof HTMLElement ? active : null;
    this.open = true;
    if (typeof dialog.showModal === 'function') {
      try {
        dialog.showModal();
      } catch {
        dialog.setAttribute('open', '');
      }
    } else {
      dialog.setAttribute('open', '');
    }
    dialog.querySelector<HTMLElement>('[autofocus]')?.focus();
  }

  private dismiss(dialog: HTMLDialogElement): void {
    if (typeof dialog.close === 'function' && dialog.open) {
      dialog.close();
    } else {
      dialog.removeAttribute('open');
    }
  }

  /** Returns focus to the control that opened the sheet, unless the user already moved on. */
  private restoreFocus(dialog: HTMLDialogElement): void {
    const opener = this.opener;
    this.opener = null;
    const active = opener?.ownerDocument.activeElement ?? null;
    const lost = active === null || active === opener?.ownerDocument.body || dialog.contains(active);
    if (opener !== null && opener.isConnected && lost) {
      opener.focus();
    }
  }
}
