import { DestroyRef, Directive, ElementRef, inject, input } from '@angular/core';
import { DragCursorService } from '../../core/ui/drag-cursor.service';

/** A running splitter drag: receives the pointer offset since the start. */
export interface SplitterDrag {
  move(dx: number, dy: number): void;
  end(): void;
}

/** What a splitter resizes. `begin` measures the start state; `reset` restores the default (double-click, Enter). */
export interface SplitterBehavior {
  begin(): SplitterDrag | null;
  reset(): void;
}

/** Keyboard steps (DESIGN.md: arrows 16 px, Shift 64 px). */
export const SPLITTER_STEP_PX = 16;
export const SPLITTER_STEP_LARGE_PX = 64;

/**
 * Makes an element a resize hairline (prototype `.split`): pointer drag with capture, arrow keys (16 px, Shift 64 px)
 * along its axis, Enter and double-click reset. `orientation="vertical"` is a vertical line that moves left/right
 * (col-resize), `horizontal` a horizontal line that moves up/down (row-resize). Pointer moves are handled with native
 * listeners outside Angular's template bindings; only the behaviour decides what to update.
 *
 * ```html
 * <div class="c-splitter" [sfSplitter]="behavior" orientation="vertical" aria-label="Grösse von Preview und Program"></div>
 * ```
 */
@Directive({
  selector: '[sfSplitter]',
  host: {
    role: 'separator',
    tabindex: '0',
    '[attr.aria-orientation]': 'orientation()',
    '(pointerdown)': 'onPointerDown($event)',
    '(dblclick)': 'onReset($event)',
    '(keydown)': 'onKeyDown($event)',
  },
})
export class SplitterDirective {
  /** What the splitter resizes. */
  readonly sfSplitter = input.required<SplitterBehavior>();
  /** `vertical`: moves along x; `horizontal`: moves along y. */
  readonly orientation = input<'vertical' | 'horizontal'>('vertical');
  /** Disables pointer and keyboard resizing (e.g. on stacked layouts). */
  readonly splitterDisabled = input(false);

  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly cursor = inject(DragCursorService);
  private drag: {
    readonly pointerId: number;
    readonly x: number;
    readonly y: number;
    readonly run: SplitterDrag;
  } | null = null;
  private readonly onMove = (event: PointerEvent): void => {
    if (this.drag && event.pointerId === this.drag.pointerId) {
      this.drag.run.move(event.clientX - this.drag.x, event.clientY - this.drag.y);
    }
  };
  private readonly onEnd = (event: PointerEvent): void => {
    if (this.drag && event.pointerId === this.drag.pointerId) {
      this.finish();
    }
  };

  constructor() {
    inject(DestroyRef).onDestroy(() => this.finish());
  }

  protected onPointerDown(event: PointerEvent): void {
    if (event.button !== 0 || this.splitterDisabled() || this.drag) {
      return;
    }
    const run = this.sfSplitter().begin();
    if (!run) {
      return;
    }
    event.preventDefault();
    try {
      this.element.setPointerCapture(event.pointerId);
    } catch {
      // Without capture the document listeners below still follow the pointer.
    }
    this.drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, run };
    this.element.classList.add('is-drag');
    this.cursor.begin(this.orientation() === 'vertical' ? 'col-resize' : 'row-resize');
    this.element.addEventListener('pointermove', this.onMove);
    this.element.addEventListener('pointerup', this.onEnd);
    this.element.addEventListener('pointercancel', this.onEnd);
    this.element.addEventListener('lostpointercapture', this.onEnd);
  }

  protected onReset(event: MouseEvent): void {
    if (this.splitterDisabled()) {
      return;
    }
    event.preventDefault();
    this.sfSplitter().reset();
  }

  protected onKeyDown(event: KeyboardEvent): void {
    if (this.splitterDisabled()) {
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      this.sfSplitter().reset();
      return;
    }
    const step = event.shiftKey ? SPLITTER_STEP_LARGE_PX : SPLITTER_STEP_PX;
    const vertical = this.orientation() === 'vertical';
    const delta = vertical
      ? { ArrowLeft: -step, ArrowRight: step }[event.key]
      : { ArrowUp: -step, ArrowDown: step }[event.key];
    if (delta === undefined) {
      return;
    }
    event.preventDefault();
    const run = this.sfSplitter().begin();
    if (!run) {
      return;
    }
    run.move(vertical ? delta : 0, vertical ? 0 : delta);
    run.end();
  }

  private finish(): void {
    const drag = this.drag;
    if (!drag) {
      return;
    }
    this.drag = null;
    this.element.removeEventListener('pointermove', this.onMove);
    this.element.removeEventListener('pointerup', this.onEnd);
    this.element.removeEventListener('pointercancel', this.onEnd);
    this.element.removeEventListener('lostpointercapture', this.onEnd);
    this.element.classList.remove('is-drag');
    this.cursor.end();
    try {
      if (this.element.hasPointerCapture?.(drag.pointerId)) {
        this.element.releasePointerCapture(drag.pointerId);
      }
    } catch {
      // Already released.
    }
    drag.run.end();
  }
}
