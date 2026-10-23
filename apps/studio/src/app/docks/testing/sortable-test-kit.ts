/**
 * Test helpers for reordering rows in a `SortableListComponent`. jsdom has no layout, so the rows get fixed
 * rectangles; the pointer events are dispatched by hand. Test-only.
 */

/** Distance from one row to the next: rows are 40 px high with a 2 px gap in a 300 px wide list. */
export const PITCH = 42;
export const ROW_HEIGHT = 40;

/** The vertical centre of the row at list position `index`. */
export function centre(index: number): number {
  return index * PITCH + ROW_HEIGHT / 2;
}

/** Gives every `[data-sortable-id]` row the rectangle of its position among its siblings. Restore with `vi.restoreAllMocks()`. */
export function stubRowLayout(): void {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const index = this.hasAttribute('data-sortable-id')
      ? Array.from(this.parentElement?.children ?? [])
          .filter((child) => child.hasAttribute('data-sortable-id'))
          .indexOf(this)
      : 0;
    const top = index * PITCH;
    return {
      x: 0,
      y: top,
      left: 0,
      right: 300,
      top,
      bottom: top + ROW_HEIGHT,
      width: 300,
      height: ROW_HEIGHT,
      toJSON: () => ({}),
    } as DOMRect;
  });
}

/** Dispatches a pointer event (a mouse by default) at (x, y). */
export function pointer(
  type: string,
  target: EventTarget,
  x: number,
  y: number,
  init: PointerEventInit = {},
): void {
  target.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      pointerId: 1,
      pointerType: 'mouse',
      button: 0,
      ...init,
    }),
  );
}

/** Presses on `target`, a row at list position `from`, and moves to the vertical position `toY`. */
export function dragRow(target: Element, from: number, toY: number, release = true): void {
  pointer('pointerdown', target, 100, centre(from));
  pointer('pointermove', document, 100, centre(from) + 10);
  pointer('pointermove', document, 100, toY);
  if (release) {
    pointer('pointerup', document, 100, toY);
  }
}

/** Dispatches a keydown that bubbles to the document. */
export function pressKey(
  target: EventTarget,
  key: string,
  init: KeyboardEventInit = {},
): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}
