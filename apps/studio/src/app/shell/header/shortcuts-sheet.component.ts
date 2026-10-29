import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  effect,
  inject,
  input,
  output,
  viewChild,
} from '@angular/core';
import { t } from '@studioflow/i18n';
import { IconComponent } from '../../core/ui/icon.component';
import { KeyboardService } from '../../core/ui/keyboard.service';
import { SHORTCUT_GROUPS, keycapText } from '../../core/ui/shortcuts';

/**
 * The keyboard shortcuts of the control room as a modal sheet (`<dialog>`), opened from "Layout" › "Keyboard shortcuts"
 * or with the ? key. Renders {@link SHORTCUT_GROUPS} (core/ui/shortcuts.ts), the one list of every shortcut, in two
 * columns where the window is wide enough. Escape, the close button and a click on the backdrop close it (`closed`).
 */
@Component({
  selector: 'sf-shortcuts-sheet',
  imports: [IconComponent],
  template: `
    <dialog
      #dialog
      class="c-sheet"
      aria-labelledby="sf-keys-title"
      (cancel)="onCancel($event)"
      (click)="onBackdrop($event)"
    >
      <div class="c-sheet__body">
        <div class="c-sheet__head">
          <h2 class="c-sheet__title" id="sf-keys-title">{{ t('regie.header.keys.title') }}</h2>
          <button
            class="c-ibtn"
            type="button"
            [attr.aria-label]="t('common.close')"
            [title]="t('common.close')"
            (click)="closed.emit()"
          >
            <svg sfIcon="close"></svg>
          </button>
        </div>
        <div class="c-sheet__groups">
          @for (group of groups; track group.labelKey) {
            <section class="c-keys" [attr.aria-labelledby]="'sf-keys-' + $index">
              <h3 class="c-keys__label" [id]="'sf-keys-' + $index">{{ t(group.labelKey) }}</h3>
              <dl class="c-keys__list">
                @for (shortcut of group.shortcuts; track shortcut.textKey) {
                  <div class="c-keys__row">
                    <dt class="c-keys__combo">
                      @for (combo of shortcut.combos; track $index) {
                        @if (!$first) {
                          <span class="c-keys__or">{{ t('regie.header.keys.or') }}</span>
                        }
                        @for (key of combo; track $index) {
                          <kbd class="c-keys__cap">{{ cap(key) }}</kbd>
                        }
                      }
                    </dt>
                    <dd class="c-keys__text">{{ t(shortcut.textKey) }}</dd>
                  </div>
                }
              </dl>
            </section>
          }
        </div>
        <p class="c-sheet__note">{{ t('regie.header.keys.typing') }}</p>
      </div>
    </dialog>
  `,
  styleUrl: './shortcuts-sheet.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ShortcutsSheetComponent {
  /** The sheet is shown. */
  readonly open = input(false);
  /** The user closed the sheet (Escape, the close button, the backdrop). */
  readonly closed = output<void>();

  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  protected readonly t = t;

  protected readonly groups = SHORTCUT_GROUPS;
  protected readonly cap = keycapText;

  constructor() {
    effect(() => {
      const dialog = this.dialog().nativeElement;
      const shown = dialog.hasAttribute('open');
      if (this.open() && !shown) {
        if (typeof dialog.showModal === 'function') {
          dialog.showModal();
        } else {
          dialog.setAttribute('open', '');
        }
      } else if (!this.open() && shown) {
        if (typeof dialog.close === 'function') {
          dialog.close();
        } else {
          dialog.removeAttribute('open');
        }
      }
    });
    // Escape goes through the global keyboard layer first, so it never also clears a selection behind the sheet.
    const unregister = inject(KeyboardService).registerEscape('sheet', () => {
      if (!this.open()) {
        return false;
      }
      this.closed.emit();
      return true;
    });
    inject(DestroyRef).onDestroy(unregister);
  }

  /** The browser's own Escape handling: keep the dialog under the control of `open`. */
  protected onCancel(event: Event): void {
    event.preventDefault();
    this.closed.emit();
  }

  /** A click on the backdrop (the dialog element itself, outside its body) closes the sheet. */
  protected onBackdrop(event: MouseEvent): void {
    if (event.target === this.dialog().nativeElement) {
      this.closed.emit();
    }
  }
}
