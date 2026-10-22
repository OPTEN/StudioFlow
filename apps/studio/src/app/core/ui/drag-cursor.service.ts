import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';

/** Cursors used while dragging UI chrome. */
export type DragCursor =
  'col-resize' | 'row-resize' | 'grabbing' | 'move' | 'nwse-resize' | 'nesw-resize';

/**
 * Keeps one cursor on the whole page and blocks text selection while a splitter, a dock or an element is dragged.
 * A transparent fixed layer (`.c-drag-cursor`) on top of everything carries the cursor; this replaces the prototype's
 * `body.is-…-resize * { cursor: … !important }`. Drags keep receiving their events through pointer capture or
 * document listeners; hit tests during a drag must use `elementsFromPoint` and skip {@link isLayer}.
 */
@Injectable({ providedIn: 'root' })
export class DragCursorService {
  private readonly document = inject(DOCUMENT);
  private layer: HTMLElement | null = null;

  /** Shows `cursor` everywhere until {@link end}. Calling it again just changes the cursor. */
  begin(cursor: DragCursor): void {
    if (!this.layer) {
      this.layer = this.document.createElement('div');
      this.layer.className = 'c-drag-cursor';
      this.layer.setAttribute('aria-hidden', 'true');
      this.document.body.appendChild(this.layer);
      this.document.body.classList.add('is-dragging-ui');
    }
    this.layer.style.cursor = cursor;
  }

  /** Removes the cursor layer. Idempotent. */
  end(): void {
    this.layer?.remove();
    this.layer = null;
    this.document.body.classList.remove('is-dragging-ui');
  }

  /** True while a drag cursor is shown. */
  get active(): boolean {
    return this.layer !== null;
  }

  /** True for the cursor layer itself (to skip it in hit tests). */
  isLayer(element: Element): boolean {
    return element === this.layer;
  }
}
