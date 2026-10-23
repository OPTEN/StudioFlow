import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';
import { t } from '@studioflow/i18n';
import { ToastService } from './toast.service';

/** Options of {@link ClipboardService.copy}. */
export interface CopyOptions {
  /** Element whose text is selected when the Clipboard API fails. Omit to handle the fallback yourself. */
  readonly selectElement?: HTMLElement | null;
  /** Text shown in the toast "Copied: …" instead of the copied text (never show secrets such as the output key). */
  readonly label?: string;
}

/**
 * Copies links like the prototype `copyText`: through the Clipboard API with the toast "Copied: …"; where that is not
 * available (plain http in the LAN, denied permission) the visible text is selected instead and the toast says
 * "Selected. Press Ctrl+C to copy.".
 */
@Injectable({ providedIn: 'root' })
export class ClipboardService {
  private readonly document = inject(DOCUMENT);
  private readonly toasts = inject(ToastService);

  /**
   * Copies `text`. Resolves true when it reached the clipboard, false when the fallback was used (the element of
   * `selectElement` is then selected). Never rejects.
   */
  async copy(text: string, options: CopyOptions = {}): Promise<boolean> {
    const clipboard = this.document.defaultView?.navigator.clipboard;
    if (clipboard?.writeText) {
      try {
        await clipboard.writeText(text);
        this.toasts.show(t('regie.core.clipboard.copied', { text: options.label ?? text }));
        return true;
      } catch {
        // Fall through to the selection fallback.
      }
    }
    if (options.selectElement !== undefined) {
      this.selectContents(options.selectElement);
    }
    return false;
  }

  /** Selects the text of an element and asks the user to press Ctrl+C (fallback of {@link copy}). */
  selectContents(element: HTMLElement | null): void {
    const selection = this.document.defaultView?.getSelection();
    if (element && selection) {
      const range = this.document.createRange();
      range.selectNodeContents(element);
      selection.removeAllRanges();
      selection.addRange(range);
      this.toasts.show(t('regie.core.clipboard.selected'));
      return;
    }
    this.toasts.show(t('regie.core.clipboard.unavailable'));
  }
}
