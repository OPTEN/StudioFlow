import { DOCUMENT, NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  Directive,
  ElementRef,
  Injector,
  TemplateRef,
  afterNextRender,
  computed,
  contentChild,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { t } from '@studioflow/i18n';
import { IconComponent } from '../../core/ui/icon.component';
import { KeyboardService } from '../../core/ui/keyboard.service';
import { LiveAnnouncerService } from '../../core/ui/live-announcer.service';
import { moveEntry, sameOrder, stepTarget, type ReorderStep } from '../../core/ui/reorder';
import { dropIndex, edgeScrollSpeed, heldLayout, type Slot } from './sortable-geometry';

/** What the item template receives: the entry's id and its position in the list. */
export interface SortableItemContext {
  readonly $implicit: string;
  readonly index: number;
}

/** Marks the `<ng-template>` that renders one entry of a {@link SortableListComponent}. */
@Directive({ selector: 'ng-template[sfSortableItem]' })
export class SortableItemDirective {
  readonly template = inject<TemplateRef<SortableItemContext>>(TemplateRef);

  static ngTemplateContextGuard(
    _directive: SortableItemDirective,
    _context: unknown,
  ): _context is SortableItemContext {
    return true;
  }
}

/** Pixels the pointer must move before a press on a row becomes a drag (a click stays a click). */
const DRAG_THRESHOLD_PX = 4;
/** How long a finger rests on a row before the row can be dragged (so that swiping still scrolls the list). */
const LONG_PRESS_MS = 350;
/** How far a resting finger may drift during the long press. */
const LONG_PRESS_SLOP_PX = 8;
/** Distance from the edge of the scroll area where a drag starts to scroll it. */
const EDGE_ZONE_PX = 36;
/** Fastest auto-scroll, px per frame. */
const MAX_SCROLL_SPEED_PX = 14;
/** How far outside the visible list a drop still counts as a drop on the list. */
const OUTSIDE_MARGIN_PX = 40;

/** Elements that keep their own pointer behaviour unless marked `data-sortable-grab`. */
const CONTROLS = 'button, a, input, textarea, select, [contenteditable], [role="menu"]';

type Axis = 'x' | 'y';
type Message = 'picked' | 'moved' | 'dropped' | 'cancelled';
interface Point {
  readonly x: number;
  readonly y: number;
}

/** A press on a row that may still turn into a drag. */
interface Press {
  readonly id: string;
  readonly pointerId: number;
  readonly pointerType: string;
  readonly start: Point;
  /** The press started on the handle: no long press needed, even for a finger. */
  readonly onHandle: boolean;
  longPress: ReturnType<typeof setTimeout> | null;
}

/** The scrolling area of the list along its axis. */
interface Scroller {
  position(): number;
  scrollBy(delta: number): void;
  /** Visible extent (viewport coordinates). */
  bounds(): Slot;
}

/** One row being held, by pointer or keyboard. */
interface Held {
  readonly mode: 'pointer' | 'keyboard';
  /** The order when the row was picked up. */
  readonly ids: readonly string[];
  readonly origin: number;
  readonly axis: Axis;
  /** Extent of every entry along the axis when the row was picked up (viewport coordinates). */
  readonly slots: readonly Slot[];
  /** Extent of the list across the axis. */
  readonly cross: Slot;
  readonly scroller: Scroller;
  readonly scrollStart: number;
  readonly pointerStart: Point;
  pointer: Point;
  /** Position the row would take now. */
  target: number;
  frame: number | null;
  readonly cleanups: (() => void)[];
}

/** What the template shows while a row is held. */
interface HeldView {
  readonly id: string;
  readonly ids: readonly string[];
  readonly mode: 'pointer' | 'keyboard';
  readonly axis: Axis;
  readonly shifts: readonly number[];
  readonly offset: number;
  readonly line: { left: number; top: number; width: number; height: number } | null;
}

/**
 * A list whose entries are reordered by dragging, used by the Sources dock (items, front to back) and the Scenes
 * dock (scenes). The list does not own the order: it shows `ids`, and a finished move is emitted as the new complete
 * order through `reorder`; the parent applies it (optimistic) and sends it. Entries are rendered by the
 * `sfSortableItem` template, next to a grip handle.
 *
 * Mouse and pen: press anywhere on a row (not on its small buttons) and move a few pixels, or use the handle. Touch:
 * the handle drags at once; elsewhere a press-and-hold does, so that swiping still scrolls the list. The held row
 * follows the pointer, the others make room, a blue line marks the insertion point and the list scrolls near its
 * edges. Escape, a cancelled pointer and a drop away from the list restore the order. The click that ends a drag
 * never reaches the row, so dragging does not select it. Built on pointer events only, so the HTML5 file drop of the
 * Sources dock is unaffected.
 *
 * Keyboard: Space or Enter on the handle picks the row up, the arrow keys (Home/End) move it, Space or Enter drops
 * it, Escape or leaving the handle cancels. Alt+Up/Down anywhere in a row moves it one place at once, with Shift to
 * the very start or end. Every step is announced ("K1 moved to position 2 of 5").
 *
 * The list is the host element: style it as grid or flex (the direction decides the axis), the rows are its
 * children. Buttons inside a row start a drag only with the attribute `data-sortable-grab`.
 */
@Component({
  selector: 'sf-sortable-list',
  imports: [IconComponent, NgTemplateOutlet],
  templateUrl: './sortable-list.component.html',
  styleUrl: './sortable-list.component.scss',
  host: {
    role: 'list',
    '[attr.aria-label]': 'label()',
    '[class.is-sorting]': 'held() !== null',
    '(pointerdown)': 'onPointerDown($event)',
    '(keydown)': 'onKeyDown($event)',
  },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SortableListComponent {
  /** Ids of the entries in list order (top to bottom, or left to right). */
  readonly ids = input.required<readonly string[]>();
  /** Accessible name of the list. */
  readonly label = input.required<string>();
  /** Name of an entry for the handle and the announcements ("K1 Phone stage left", the scene name). */
  readonly nameOf = input.required<(id: string) => string>();
  /** The complete new order after a move (never emitted for a move that changes nothing). */
  readonly reorder = output<readonly string[]>();

  private readonly item = contentChild.required(SortableItemDirective);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);
  private readonly keyboard = inject(KeyboardService);
  private readonly announcer = inject(LiveAnnouncerService);

  protected readonly t = t;
  protected readonly held = signal<HeldView | null>(null);
  protected readonly itemTemplate = computed(() => this.item().template);
  /** Transform per entry while a row is held: the held row follows the pointer, the others make room. */
  protected readonly transforms = computed(() => {
    const held = this.held();
    const transforms = new Map<string, string>();
    if (held) {
      const move = held.axis === 'y' ? 'translateY' : 'translateX';
      held.ids.forEach((id, index) => {
        const distance = id === held.id ? held.offset : held.shifts[index];
        if (distance !== 0) {
          transforms.set(id, `${move}(${distance}px)`);
        }
      });
    }
    return transforms;
  });

  private press: Press | null = null;
  private session: Held | null = null;
  private readonly pressCleanups: (() => void)[] = [];
  private suppressClick = false;

  constructor() {
    // The list changed under a held row (another Regie tab edited it): drop the move instead of applying it to an
    // order that no longer exists.
    effect(() => {
      const ids = this.ids();
      untracked(() => {
        if (this.session && !sameOrder(this.session.ids, ids)) {
          this.finish('abandon');
        }
        if (this.press && !ids.includes(this.press.id)) {
          this.endPress();
        }
      });
    });
    // A drag ends with a click on the row that was grabbed; swallow it so the row is not selected.
    const swallowClick = (event: Event): void => {
      if (this.suppressClick) {
        this.suppressClick = false;
        event.stopPropagation();
        event.preventDefault();
      }
    };
    this.host.addEventListener('click', swallowClick, true);
    inject(DestroyRef).onDestroy(() => {
      this.host.removeEventListener('click', swallowClick, true);
      this.finish('abandon');
      this.endPress();
    });
  }

  protected lifted(id: string): boolean {
    return this.held()?.id === id;
  }

  // ---------------------------------------------------------------- Pointer

  protected onPointerDown(event: PointerEvent): void {
    const target = event.target;
    if (!(target instanceof Element) || this.session) {
      return;
    }
    if (event.pointerType === 'mouse' && event.button !== 0) {
      return;
    }
    const row = target.closest<HTMLElement>('[data-sortable-id]');
    const id = row?.dataset['sortableId'];
    if (!id || !this.host.contains(row)) {
      return;
    }
    const onHandle = target.closest('.c-sortable__handle') !== null;
    const control = target.closest(CONTROLS);
    if (!onHandle && control && !control.matches('[data-sortable-grab]')) {
      return;
    }
    this.endPress();
    const press: Press = {
      id,
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      start: { x: event.clientX, y: event.clientY },
      onHandle,
      longPress: null,
    };
    this.press = press;
    if (event.pointerType === 'touch' && !onHandle) {
      press.longPress = setTimeout(() => {
        press.longPress = null;
        this.beginDrag(press, press.start);
      }, LONG_PRESS_MS);
    }
    const cleanups = this.pressCleanups;
    this.listen(
      this.document,
      'pointermove',
      (e) => this.onPointerMove(e as PointerEvent),
      cleanups,
    );
    this.listen(this.document, 'pointerup', (e) => this.onPointerUp(e as PointerEvent), cleanups);
    this.listen(this.document, 'pointercancel', () => this.onPointerCancel(), cleanups);
  }

  private onPointerMove(event: PointerEvent): void {
    const press = this.press;
    if (!press || event.pointerId !== press.pointerId) {
      return;
    }
    const point = { x: event.clientX, y: event.clientY };
    if (this.session) {
      this.session.pointer = point;
      this.refresh();
      return;
    }
    const distance = Math.hypot(point.x - press.start.x, point.y - press.start.y);
    if (press.pointerType === 'touch' && !press.onHandle) {
      // A swipe before the long press is over: the browser scrolls, this is not a drag.
      if (distance > LONG_PRESS_SLOP_PX) {
        this.endPress();
      }
    } else if (distance >= DRAG_THRESHOLD_PX) {
      this.beginDrag(press, point);
    }
  }

  private onPointerUp(event: PointerEvent): void {
    if (!this.press || event.pointerId !== this.press.pointerId) {
      return;
    }
    if (this.session) {
      this.session.pointer = { x: event.clientX, y: event.clientY };
      this.refresh();
      this.suppressClick = true;
      setTimeout(() => (this.suppressClick = false));
      this.finish('drop');
    }
    this.endPress();
  }

  private onPointerCancel(): void {
    this.finish('cancel');
    this.endPress();
  }

  /** The press became a drag. */
  private beginDrag(press: Press, pointer: Point): void {
    const session = this.pickUp(press.id, 'pointer', press.start);
    if (!session) {
      return;
    }
    session.pointer = pointer;
    try {
      this.rowElement(press.id)?.setPointerCapture(press.pointerId);
    } catch {
      // The pointer is already gone; the document listeners end the drag.
    }
    const prevent = (event: Event): void => event.preventDefault();
    // A finger that long-pressed must not scroll the list or open the context menu while the row is dragged.
    this.listen(this.document, 'touchmove', prevent, session.cleanups, { passive: false });
    this.listen(this.document, 'contextmenu', prevent, session.cleanups);
    this.listen(this.document, 'selectstart', prevent, session.cleanups);
    this.listen(this.window, 'blur', () => this.finish('cancel'), session.cleanups);
    this.refresh();
    this.scrollWhileNearEdge(session);
  }

  private endPress(): void {
    if (this.press?.longPress) {
      clearTimeout(this.press.longPress);
    }
    this.press = null;
    this.pressCleanups.splice(0).forEach((cleanup) => cleanup());
  }

  /** Scrolls the list while the pointer rests near its edge, and updates the target as the content moves. */
  private scrollWhileNearEdge(session: Held): void {
    const tick = (): void => {
      if (this.session !== session) {
        return;
      }
      const { start, end } = session.scroller.bounds();
      const pointer = session.axis === 'y' ? session.pointer.y : session.pointer.x;
      const speed = edgeScrollSpeed(pointer, start, end, EDGE_ZONE_PX, MAX_SCROLL_SPEED_PX);
      const before = session.scroller.position();
      if (speed !== 0) {
        session.scroller.scrollBy(speed);
        if (session.scroller.position() !== before) {
          this.refresh();
        }
      }
      session.frame = this.window.requestAnimationFrame(tick);
    };
    session.frame = this.window.requestAnimationFrame(tick);
  }

  // ---------------------------------------------------------------- Keyboard

  protected onHandleKeyDown(event: KeyboardEvent, id: string): void {
    const session = this.session;
    if (session?.mode === 'keyboard') {
      this.moveHeld(event, session);
    } else if (!session && (event.key === ' ' || event.key === 'Enter')) {
      event.preventDefault();
      const picked = this.pickUp(id, 'keyboard', null);
      if (picked) {
        this.refresh();
        this.announce('picked', picked.ids, picked.origin);
      }
    }
  }

  /** Leaving the handle cancels the move, so a lifted row never stays lifted unnoticed. */
  protected onHandleBlur(id: string): void {
    const session = this.session;
    if (session?.mode === 'keyboard' && session.ids[session.origin] === id) {
      this.finish('cancel');
    }
  }

  /** Alt+Up/Down in a row moves it at once, Shift to the very start or end. */
  protected onKeyDown(event: KeyboardEvent): void {
    const up = event.key === 'ArrowUp';
    if (
      this.session ||
      !event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      (!up && event.key !== 'ArrowDown')
    ) {
      return;
    }
    const id = (event.target as Element).closest<HTMLElement>('[data-sortable-id]')?.dataset[
      'sortableId'
    ];
    if (!id) {
      return;
    }
    event.preventDefault();
    const ids = this.ids();
    const index = ids.indexOf(id);
    const step: ReorderStep = up
      ? event.shiftKey
        ? 'first'
        : 'earlier'
      : event.shiftKey
        ? 'last'
        : 'later';
    const target = stepTarget(index, ids.length, step);
    if (index >= 0 && target !== index) {
      this.emit(ids, id, target, 'moved');
    }
  }

  private moveHeld(event: KeyboardEvent, session: Held): void {
    const count = session.ids.length;
    const steps: Readonly<Record<string, ReorderStep>> = {
      ArrowUp: 'earlier',
      ArrowLeft: 'earlier',
      ArrowDown: 'later',
      ArrowRight: 'later',
      Home: 'first',
      End: 'last',
    };
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      this.finish('drop');
    } else if (steps[event.key]) {
      event.preventDefault();
      session.target = stepTarget(session.target, count, steps[event.key]);
      this.refresh();
      this.rowElement(session.ids[session.origin])?.scrollIntoView?.({
        block: 'nearest',
        inline: 'nearest',
      });
      this.announce('moved', session.ids, session.target, session.origin);
    }
  }

  // ---------------------------------------------------------------- Holding a row

  /** Measures the list and holds the row `id`; null when the entry is not (or no longer) in the list. */
  private pickUp(id: string, mode: Held['mode'], pointerStart: Point | null): Held | null {
    const rows = this.rowElements();
    const ids = rows.map((row) => row.dataset['sortableId'] as string);
    const origin = ids.indexOf(id);
    if (origin < 0 || !sameOrder(ids, this.ids())) {
      return null;
    }
    const rects = rows.map((row) => row.getBoundingClientRect());
    const axis: Axis =
      rects.length > 1 &&
      Math.abs(rects[1].left - rects[0].left) > Math.abs(rects[1].top - rects[0].top)
        ? 'x'
        : 'y';
    const along = (rect: DOMRect): Slot =>
      axis === 'y' ? { start: rect.top, end: rect.bottom } : { start: rect.left, end: rect.right };
    const across = (rect: DOMRect): Slot =>
      axis === 'y' ? { start: rect.left, end: rect.right } : { start: rect.top, end: rect.bottom };
    const scroller = this.scrollerOf(axis);
    const start = pointerStart ?? { x: 0, y: 0 };
    const session: Held = {
      mode,
      ids,
      origin,
      axis,
      slots: rects.map(along),
      cross: {
        start: Math.min(...rects.map((rect) => across(rect).start)),
        end: Math.max(...rects.map((rect) => across(rect).end)),
      },
      scroller,
      scrollStart: scroller.position(),
      pointerStart: start,
      pointer: start,
      target: origin,
      frame: null,
      cleanups: [this.keyboard.registerEscape('listDrag', () => this.finish('cancel'))],
    };
    this.session = session;
    return session;
  }

  /** Recomputes the target, the shifts and the line from the pointer (or from the keyboard target). */
  private refresh(): void {
    const session = this.session;
    if (!session) {
      return;
    }
    const { slots, origin } = session;
    const scrolled = session.scroller.position() - session.scrollStart;
    const layoutOf = (target: number) => heldLayout(slots, origin, target);
    let offset: number;
    if (session.mode === 'pointer') {
      const along =
        session.axis === 'y'
          ? session.pointer.y - session.pointerStart.y
          : session.pointer.x - session.pointerStart.x;
      const moved = along + scrolled;
      // The row stays within the list, but the target follows the pointer all the way to the ends.
      const lowest = slots[0].start - slots[origin].start;
      const highest = slots[slots.length - 1].end - slots[origin].end;
      offset = Math.min(Math.max(moved, lowest), highest);
      const center = (slots[origin].start + slots[origin].end) / 2 + moved;
      session.target = this.pointerAway(session) ? origin : dropIndex(slots, origin, center);
    } else {
      offset = layoutOf(session.target).shifts[origin];
    }
    const layout = layoutOf(session.target);
    this.held.set({
      id: session.ids[origin],
      ids: session.ids,
      mode: session.mode,
      axis: session.axis,
      shifts: layout.shifts,
      offset,
      line: layout.line === null ? null : this.lineBox(session, layout.line - scrolled),
    });
  }

  private lineBox(session: Held, position: number): HeldView['line'] {
    const { start, end } = session.scroller.bounds();
    if (position < start || position > end) {
      return null;
    }
    const length = session.cross.end - session.cross.start;
    return session.axis === 'y'
      ? { left: session.cross.start, top: position - 1, width: length, height: 2 }
      : { left: position - 1, top: session.cross.start, width: 2, height: length };
  }

  /**
   * Ends the held row. `drop` applies the target, `cancel` restores the order and says so, `abandon` just lets go
   * (the list changed, the component goes away).
   */
  private finish(outcome: 'drop' | 'cancel' | 'abandon'): boolean {
    const session = this.session;
    if (!session) {
      return false;
    }
    this.session = null;
    if (session.frame !== null) {
      this.window.cancelAnimationFrame(session.frame);
    }
    session.cleanups.splice(0).forEach((cleanup) => cleanup());
    if (session.mode === 'pointer') {
      this.endPress();
    }
    this.held.set(null);
    const id = session.ids[session.origin];
    if (outcome === 'drop' && session.target !== session.origin) {
      this.emit(session.ids, id, session.target, session.mode === 'keyboard' ? 'dropped' : 'moved');
    } else if (outcome !== 'abandon' && session.mode === 'keyboard') {
      this.announce(outcome === 'drop' ? 'dropped' : 'cancelled', session.ids, session.origin);
    }
    return true;
  }

  /** Emits the order after moving `id` to `target` and keeps the focus where it was. */
  private emit(ids: readonly string[], id: string, target: number, message: Message): void {
    this.keepFocus();
    this.reorder.emit(moveEntry(ids, id, target));
    this.announce(message, ids, target, ids.indexOf(id));
  }

  /** Announces the entry at `index` (the entry of the order `ids`, or `entry` when it is not the one at `index`). */
  private announce(message: Message, ids: readonly string[], index: number, entry = index): void {
    this.announcer.announce(
      t(`regie.docks.sortable.${message}`, {
        name: this.nameOf()(ids[entry]),
        position: index + 1,
        count: ids.length,
      }),
    );
  }

  /** Moving a row in the DOM can drop the focus in some browsers: put it back on the same control afterwards. */
  private keepFocus(): void {
    const active = this.document.activeElement;
    const row = active?.closest<HTMLElement>('[data-sortable-id]');
    const id = row?.dataset['sortableId'];
    if (!active || !row || !id || !this.host.contains(row)) {
      return;
    }
    const position = this.focusables(row).indexOf(active as HTMLElement);
    afterNextRender(
      () => {
        const moved = this.rowElement(id);
        const control = moved ? this.focusables(moved)[position] : undefined;
        if (control && this.document.activeElement !== control) {
          control.focus();
        }
      },
      { injector: this.injector },
    );
  }

  private focusables(row: HTMLElement): HTMLElement[] {
    return Array.from(
      row.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, [tabindex]'),
    );
  }

  // ---------------------------------------------------------------- Measuring

  private get window(): Window {
    return this.document.defaultView as Window;
  }

  private rowElements(): HTMLElement[] {
    return Array.from(this.host.querySelectorAll<HTMLElement>(':scope > [data-sortable-id]'));
  }

  private rowElement(id: string): HTMLElement | undefined {
    return this.rowElements().find((row) => row.dataset['sortableId'] === id);
  }

  /** The nearest ancestor that scrolls along the axis, else the page. */
  private scrollerOf(axis: Axis): Scroller {
    for (let element: HTMLElement | null = this.host; element; element = element.parentElement) {
      const style = this.window.getComputedStyle(element);
      const overflow = axis === 'y' ? style.overflowY : style.overflowX;
      const overflowing =
        axis === 'y'
          ? element.scrollHeight > element.clientHeight
          : element.scrollWidth > element.clientWidth;
      if ((overflow === 'auto' || overflow === 'scroll') && overflowing) {
        const scrolling = element;
        return {
          position: () => (axis === 'y' ? scrolling.scrollTop : scrolling.scrollLeft),
          scrollBy: (delta) =>
            axis === 'y' ? (scrolling.scrollTop += delta) : (scrolling.scrollLeft += delta),
          bounds: () => {
            const rect = scrolling.getBoundingClientRect();
            return axis === 'y'
              ? { start: rect.top, end: rect.bottom }
              : { start: rect.left, end: rect.right };
          },
        };
      }
    }
    const page = this.document.scrollingElement ?? this.document.documentElement;
    return {
      position: () => (axis === 'y' ? page.scrollTop : page.scrollLeft),
      scrollBy: (delta) => (axis === 'y' ? (page.scrollTop += delta) : (page.scrollLeft += delta)),
      bounds: () => ({
        start: 0,
        end: axis === 'y' ? this.window.innerHeight : this.window.innerWidth,
      }),
    };
  }

  /** The pointer is well away from the visible list: dropping now cancels. */
  private pointerAway(session: Held): boolean {
    const { start, end } = session.scroller.bounds();
    const along = session.axis === 'y' ? session.pointer.y : session.pointer.x;
    const across = session.axis === 'y' ? session.pointer.x : session.pointer.y;
    return (
      along < start - OUTSIDE_MARGIN_PX ||
      along > end + OUTSIDE_MARGIN_PX ||
      across < session.cross.start - OUTSIDE_MARGIN_PX ||
      across > session.cross.end + OUTSIDE_MARGIN_PX
    );
  }

  private listen(
    target: EventTarget,
    type: string,
    handler: (event: Event) => void,
    cleanups: (() => void)[],
    options?: AddEventListenerOptions,
  ): void {
    target.addEventListener(type, handler, options);
    cleanups.push(() => target.removeEventListener(type, handler, options));
  }
}
