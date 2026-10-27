import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { PITCH, centre, pointer, pressKey, stubRowLayout } from '../testing/sortable-test-kit';
import { SortableItemDirective, SortableListComponent } from './sortable-list.component';

@Component({
  imports: [SortableListComponent, SortableItemDirective],
  template: `
    <sf-sortable-list [ids]="ids()" label="Things" [nameOf]="nameOf" (reorder)="onReorder($event)">
      <ng-template sfSortableItem let-id>
        <div class="row" (click)="clicked.push(id)">
          <button class="pick" type="button" data-sortable-grab>{{ id }}</button>
          <button class="small" type="button">x</button>
        </div>
      </ng-template>
    </sf-sortable-list>
  `,
})
class HostComponent {
  readonly ids = signal(['a', 'b', 'c', 'd', 'e']);
  readonly reorders: string[][] = [];
  readonly clicked: string[] = [];
  readonly nameOf = (id: string): string => id.toUpperCase();

  onReorder(order: readonly string[]): void {
    this.reorders.push([...order]);
  }
}

describe('SortableListComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  let list: HTMLElement;
  let frames: FrameRequestCallback[];
  let scrollTop: number;

  async function render(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  async function setup(ids?: string[]): Promise<void> {
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    if (ids) {
      host.ids.set(ids);
    }
    document.body.append(fixture.nativeElement);
    list = fixture.nativeElement.querySelector('sf-sortable-list') as HTMLElement;
    await render();
  }

  function rows(): HTMLElement[] {
    return Array.from(list.querySelectorAll<HTMLElement>(':scope > [data-sortable-id]'));
  }

  function order(): string[] {
    return rows().map((row) => row.dataset['sortableId'] as string);
  }

  function row(id: string): HTMLElement {
    return rows().find((entry) => entry.dataset['sortableId'] === id) as HTMLElement;
  }

  function handle(id: string): HTMLButtonElement {
    return row(id).querySelector('.c-sortable__handle') as HTMLButtonElement;
  }

  function pick(id: string): HTMLButtonElement {
    return row(id).querySelector('.pick') as HTMLButtonElement;
  }

  /** Presses on `target` at the centre of list position `from` and moves to the centre of position `to`. */
  async function dragTo(target: Element, from: number, toY: number, up = true): Promise<void> {
    pointer('pointerdown', target, 100, centre(from));
    pointer('pointermove', document, 100, centre(from) + 10);
    pointer('pointermove', document, 100, toY);
    await render();
    if (up) {
      pointer('pointerup', document, 100, toY);
      await render();
    }
  }

  const key = pressKey;

  function announced(): string {
    vi.advanceTimersByTime(50);
    return document.body.querySelector('[aria-live="assertive"]')?.textContent ?? '';
  }

  function flushFrame(): void {
    const run = frames;
    frames = [];
    run.forEach((callback) => callback(0));
  }

  function transformOf(id: string): string {
    return row(id).style.transform;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    frames = [];
    scrollTop = 0;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
    stubRowLayout();
    Object.defineProperty(document.documentElement, 'scrollTop', {
      configurable: true,
      get: () => scrollTop,
      set: (value: number) => {
        scrollTop = value;
      },
    });
  });

  afterEach(() => {
    fixture?.nativeElement.remove();
    document.body.querySelector('[aria-live]')?.remove();
    delete (document.documentElement as { scrollTop?: number }).scrollTop;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('markup', () => {
    it('is a labelled list of rows, each with a reorder handle named after the entry', async () => {
      await setup();
      expect(list.getAttribute('role')).toBe('list');
      expect(list.getAttribute('aria-label')).toBe('Things');
      expect(rows()).toHaveLength(5);
      expect(rows().every((entry) => entry.getAttribute('role') === 'listitem')).toBe(true);
      expect(handle('c').getAttribute('aria-label')).toBe('Reorder C');
      expect(handle('c').getAttribute('aria-pressed')).toBe('false');
    });
  });

  describe('mouse', () => {
    it('drags a row from its main button to a new position and emits the order once', async () => {
      await setup();
      await dragTo(pick('a'), 0, centre(2) + 5);
      expect(host.reorders).toEqual([['b', 'c', 'a', 'd', 'e']]);
    });

    it('drags from the handle as well', async () => {
      await setup();
      await dragTo(handle('d'), 3, centre(0) - 5);
      expect(host.reorders).toEqual([['d', 'a', 'b', 'c', 'e']]);
    });

    it('makes room while dragging: the rows in between move, the held row follows the pointer', async () => {
      await setup();
      await dragTo(pick('a'), 0, centre(2) + 5, false);
      expect(list.classList.contains('is-sorting')).toBe(true);
      expect(row('a').classList.contains('is-lifted')).toBe(true);
      expect(transformOf('a')).toBe(`translateY(${centre(2) + 5 - centre(0)}px)`);
      expect(transformOf('b')).toBe(`translateY(${-PITCH}px)`);
      expect(transformOf('c')).toBe(`translateY(${-PITCH}px)`);
      expect(transformOf('d')).toBe('');
      expect(row('b').classList.contains('is-making-room')).toBe(true);
      pointer('pointerup', document, 100, centre(2) + 5);
    });

    it('shows a blue insertion line while the target differs and not over the own position', async () => {
      await setup();
      await dragTo(pick('a'), 0, centre(2) + 5, false);
      const line = list.querySelector<HTMLElement>('.c-sortable__line');
      expect(line).not.toBeNull();
      expect(line?.style.height).toBe('2px');
      expect(line?.getAttribute('aria-hidden')).toBe('true');
      pointer('pointermove', document, 100, centre(0) + 6);
      await render();
      expect(list.querySelector('.c-sortable__line')).toBeNull();
      pointer('pointerup', document, 100, centre(0) + 6);
    });

    it('keeps a click a click: below the threshold nothing is dragged and the row is selected', async () => {
      await setup();
      pointer('pointerdown', pick('b'), 100, centre(1));
      pointer('pointermove', document, 102, centre(1) + 1);
      pointer('pointerup', document, 102, centre(1) + 1);
      pick('b').click();
      await render();
      expect(host.reorders).toEqual([]);
      expect(host.clicked).toEqual(['b']);
      expect(list.classList.contains('is-sorting')).toBe(false);
    });

    it('does not select the row it dragged: the click that ends the drag is swallowed', async () => {
      await setup();
      await dragTo(pick('a'), 0, centre(3) + 5);
      pick('a').click();
      expect(host.clicked).toEqual([]);
      // Only that one click: the next one selects again.
      vi.advanceTimersByTime(5);
      pick('a').click();
      expect(host.clicked).toEqual(['a']);
    });

    it('leaves small buttons in a row alone', async () => {
      await setup();
      await dragTo(row('b').querySelector('.small') as Element, 1, centre(4), true);
      expect(host.reorders).toEqual([]);
      expect(list.classList.contains('is-sorting')).toBe(false);
    });

    it('ignores the right mouse button', async () => {
      await setup();
      pointer('pointerdown', pick('a'), 100, centre(0), { button: 2 });
      pointer('pointermove', document, 100, centre(3));
      pointer('pointerup', document, 100, centre(3));
      expect(host.reorders).toEqual([]);
    });

    it('works with a pen like with a mouse', async () => {
      await setup();
      pointer('pointerdown', pick('a'), 100, centre(0), { pointerType: 'pen' });
      pointer('pointermove', document, 100, centre(3) + 5, { pointerType: 'pen' });
      pointer('pointerup', document, 100, centre(3) + 5, { pointerType: 'pen' });
      expect(host.reorders).toEqual([['b', 'c', 'd', 'a', 'e']]);
    });

    it('emits nothing when the row is dropped at its own position', async () => {
      await setup();
      await dragTo(pick('c'), 2, centre(2) + 8);
      expect(host.reorders).toEqual([]);
      expect(list.classList.contains('is-sorting')).toBe(false);
    });

    it('reaches the first and the last position, and the held row never leaves the list', async () => {
      await setup();
      await dragTo(pick('c'), 2, -30, false);
      expect(transformOf('c')).toBe(`translateY(${-2 * PITCH}px)`);
      pointer('pointerup', document, 100, -30);
      await dragTo(pick('c'), 2, window.innerHeight + 30, false);
      expect(transformOf('c')).toBe(`translateY(${2 * PITCH}px)`);
      pointer('pointerup', document, 100, window.innerHeight + 30);
      expect(host.reorders).toEqual([
        ['c', 'a', 'b', 'd', 'e'],
        ['a', 'b', 'd', 'e', 'c'],
      ]);
    });

    it('does not move anything with a single entry', async () => {
      await setup(['a']);
      await dragTo(pick('a'), 0, centre(0) + 200);
      expect(host.reorders).toEqual([]);
    });

    it('restores the order on Escape and ignores the rest of the gesture', async () => {
      await setup();
      await dragTo(pick('a'), 0, centre(3), false);
      const escape = key(document.body, 'Escape');
      await render();
      expect(escape.defaultPrevented).toBe(true);
      expect(list.classList.contains('is-sorting')).toBe(false);
      expect(rows().every((entry) => entry.style.transform === '')).toBe(true);
      pointer('pointermove', document, 100, centre(4));
      pointer('pointerup', document, 100, centre(4));
      expect(host.reorders).toEqual([]);
    });

    it('restores the order when the pointer is cancelled', async () => {
      await setup();
      await dragTo(pick('a'), 0, centre(3), false);
      pointer('pointercancel', document, 100, centre(3));
      await render();
      expect(list.classList.contains('is-sorting')).toBe(false);
      expect(host.reorders).toEqual([]);
    });

    it('restores the order when the row is dropped well outside the list', async () => {
      await setup();
      await dragTo(pick('a'), 0, centre(3), false);
      pointer('pointermove', document, 900, centre(3));
      await render();
      expect(transformOf('b')).toBe('');
      pointer('pointerup', document, 900, centre(3));
      expect(host.reorders).toEqual([]);
      await dragTo(pick('a'), 0, -400);
      expect(host.reorders).toEqual([]);
    });

    it('lets go when another session changes the list under the held row', async () => {
      await setup();
      await dragTo(pick('a'), 0, centre(3), false);
      host.ids.set(['a', 'b', 'c', 'x', 'd', 'e']);
      await render();
      expect(list.classList.contains('is-sorting')).toBe(false);
      pointer('pointerup', document, 100, centre(3));
      expect(host.reorders).toEqual([]);
    });

    it('keeps the drag when the list is recomputed with the same order', async () => {
      await setup();
      await dragTo(pick('a'), 0, centre(3), false);
      host.ids.set(['a', 'b', 'c', 'd', 'e']);
      await render();
      expect(list.classList.contains('is-sorting')).toBe(true);
      pointer('pointerup', document, 100, centre(3) + 5);
      expect(host.reorders).toEqual([['b', 'c', 'd', 'a', 'e']]);
    });

    it('lets go when the held entry disappears', async () => {
      await setup();
      await dragTo(pick('a'), 0, centre(3), false);
      host.ids.set(['b', 'c', 'd', 'e']);
      await render();
      expect(list.classList.contains('is-sorting')).toBe(false);
      pointer('pointerup', document, 100, centre(3));
      expect(host.reorders).toEqual([]);
    });

    it('handles rapid successive drags: each one starts from the order the parent applied', async () => {
      await setup();
      await dragTo(pick('a'), 0, centre(1) + 5);
      host.ids.set(host.reorders[0]);
      await render();
      expect(order()).toEqual(['b', 'a', 'c', 'd', 'e']);
      await dragTo(pick('e'), 4, centre(0) - 5);
      host.ids.set(host.reorders[1]);
      await render();
      await dragTo(pick('c'), 3, centre(4) + 5);
      expect(host.reorders).toEqual([
        ['b', 'a', 'c', 'd', 'e'],
        ['e', 'b', 'a', 'c', 'd'],
        ['e', 'b', 'a', 'd', 'c'],
      ]);
    });

    it('does not start a second drag while one is running', async () => {
      await setup();
      await dragTo(pick('a'), 0, centre(2) + 5, false);
      pointer('pointerdown', pick('e'), 100, centre(4), { pointerId: 2 });
      pointer('pointermove', document, 100, centre(0), { pointerId: 2 });
      pointer('pointerup', document, 100, centre(2) + 5);
      expect(host.reorders).toEqual([['b', 'c', 'a', 'd', 'e']]);
    });

    describe('in the stacked layout, where the page scrolls', () => {
      beforeEach(() => {
        // `body { overflow: auto; height: 100% }` hands its overflow to the viewport: it reports overflowing content and
        // computes to `auto`, but it does not scroll and its rectangle moves up the screen with the page.
        document.body.style.overflowY = 'auto';
        Object.defineProperty(document.body, 'scrollHeight', { configurable: true, value: 2000 });
        Object.defineProperty(document.body, 'clientHeight', { configurable: true, value: 600 });
      });

      afterEach(() => {
        document.body.style.overflowY = '';
        delete (document.body as { scrollHeight?: number }).scrollHeight;
        delete (document.body as { clientHeight?: number }).clientHeight;
      });

      it('drops a row that was lifted after the page was scrolled', async () => {
        await setup();
        // Scrolled so far that the rectangle of the body ends above the pointer (the stub puts it at 0 to 40).
        scrollTop = 500;
        await dragTo(pick('a'), 0, centre(3) + 5);
        expect(host.reorders).toEqual([['b', 'c', 'd', 'a', 'e']]);
      });

      it('measures the visible list by the window, so a row dropped far outside it still cancels', async () => {
        await setup();
        scrollTop = 500;
        await dragTo(pick('a'), 0, centre(3), false);
        pointer('pointermove', document, 900, centre(3));
        pointer('pointerup', document, 900, centre(3));
        expect(host.reorders).toEqual([]);
      });
    });

    describe('in a short window', () => {
      const WINDOW_HEIGHT = 150;
      let height: number;

      beforeEach(() => {
        height = window.innerHeight;
        Object.defineProperty(window, 'innerHeight', { configurable: true, value: WINDOW_HEIGHT });
      });

      afterEach(() => {
        Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
      });

      it('scrolls near the edge of the visible area and follows the content', async () => {
        await setup();
        pointer('pointerdown', pick('a'), 100, centre(0));
        pointer('pointermove', document, 100, 60);
        pointer('pointermove', document, 100, WINDOW_HEIGHT - 4);
        await render();
        const before = transformOf('a');
        flushFrame();
        expect(scrollTop).toBeGreaterThan(0);
        flushFrame();
        await render();
        expect(scrollTop).toBeGreaterThan(10);
        expect(transformOf('a')).not.toBe(before);
        // Away from the edge nothing scrolls.
        pointer('pointermove', document, 100, 70);
        const stopped = scrollTop;
        flushFrame();
        expect(scrollTop).toBe(stopped);
        pointer('pointerup', document, 100, 70);
      });

      it('scrolls back towards the start near the top edge', async () => {
        await setup();
        scrollTop = 100;
        pointer('pointerdown', pick('c'), 100, centre(2));
        pointer('pointermove', document, 100, 60);
        pointer('pointermove', document, 100, 4);
        flushFrame();
        expect(scrollTop).toBeLessThan(100);
        pointer('pointerup', document, 100, 4);
      });

      it('stops scrolling when the drag ends', async () => {
        await setup();
        pointer('pointerdown', pick('a'), 100, centre(0));
        pointer('pointermove', document, 100, WINDOW_HEIGHT - 4);
        pointer('pointerup', document, 100, WINDOW_HEIGHT - 4);
        const stopped = scrollTop;
        flushFrame();
        flushFrame();
        expect(scrollTop).toBe(stopped);
      });
    });
  });

  describe('touch', () => {
    const touch: PointerEventInit = { pointerType: 'touch' };

    it('drags a row after a press and hold', async () => {
      await setup();
      pointer('pointerdown', pick('a'), 100, centre(0), touch);
      vi.advanceTimersByTime(400);
      await render();
      expect(list.classList.contains('is-sorting')).toBe(true);
      pointer('pointermove', document, 100, centre(2) + 5, touch);
      pointer('pointerup', document, 100, centre(2) + 5, touch);
      expect(host.reorders).toEqual([['b', 'c', 'a', 'd', 'e']]);
    });

    it('lets a swipe scroll the list: moving before the hold is over drags nothing', async () => {
      await setup();
      pointer('pointerdown', pick('a'), 100, centre(0), touch);
      pointer('pointermove', document, 100, centre(0) + 30, touch);
      vi.advanceTimersByTime(600);
      await render();
      expect(list.classList.contains('is-sorting')).toBe(false);
      pointer('pointermove', document, 100, centre(3), touch);
      pointer('pointerup', document, 100, centre(3), touch);
      expect(host.reorders).toEqual([]);
    });

    it('does not drag on a short tap', async () => {
      await setup();
      pointer('pointerdown', pick('a'), 100, centre(0), touch);
      pointer('pointerup', document, 100, centre(0), touch);
      vi.advanceTimersByTime(600);
      expect(list.classList.contains('is-sorting')).toBe(false);
      expect(host.reorders).toEqual([]);
    });

    it('stops the browser from scrolling or opening a menu while a held row is dragged', async () => {
      await setup();
      pointer('pointerdown', pick('a'), 100, centre(0), touch);
      vi.advanceTimersByTime(400);
      const move = new Event('touchmove', { bubbles: true, cancelable: true });
      document.dispatchEvent(move);
      const menu = new Event('contextmenu', { bubbles: true, cancelable: true });
      document.dispatchEvent(menu);
      expect(move.defaultPrevented).toBe(true);
      expect(menu.defaultPrevented).toBe(true);
      pointer('pointerup', document, 100, centre(0), touch);
      const later = new Event('touchmove', { bubbles: true, cancelable: true });
      document.dispatchEvent(later);
      expect(later.defaultPrevented).toBe(false);
    });

    it('drags at once from the handle', async () => {
      await setup();
      pointer('pointerdown', handle('a'), 100, centre(0), touch);
      pointer('pointermove', document, 100, centre(0) + 6, touch);
      pointer('pointermove', document, 100, centre(2) + 5, touch);
      pointer('pointerup', document, 100, centre(2) + 5, touch);
      expect(host.reorders).toEqual([['b', 'c', 'a', 'd', 'e']]);
    });

    it('cancels the long press when the list changes', async () => {
      await setup();
      pointer('pointerdown', pick('a'), 100, centre(0), touch);
      host.ids.set(['b', 'c', 'd', 'e']);
      await render();
      vi.advanceTimersByTime(600);
      expect(list.classList.contains('is-sorting')).toBe(false);
    });
  });

  describe('keyboard', () => {
    it('picks a row up with Space, moves it with the arrows and drops it with Space', async () => {
      await setup();
      handle('a').focus();
      key(handle('a'), ' ');
      await render();
      expect(handle('a').getAttribute('aria-pressed')).toBe('true');
      expect(announced()).toBe(
        'A picked up at position 1 of 5. Use the arrow keys to move, Space to drop, Escape to cancel.',
      );
      key(handle('a'), 'ArrowDown');
      key(handle('a'), 'ArrowDown');
      await render();
      expect(announced()).toBe('A moved to position 3 of 5.');
      expect(transformOf('b')).toBe(`translateY(${-PITCH}px)`);
      expect(transformOf('a')).toBe(`translateY(${2 * PITCH}px)`);
      expect(host.reorders).toEqual([]);
      key(handle('a'), ' ');
      await render();
      expect(host.reorders).toEqual([['b', 'c', 'a', 'd', 'e']]);
      expect(announced()).toBe('A dropped at position 3 of 5.');
    });

    it('also picks up with Enter and moves with Home, End and the left and right arrows', async () => {
      await setup();
      handle('c').focus();
      key(handle('c'), 'Enter');
      key(handle('c'), 'Home');
      await render();
      expect(transformOf('c')).toBe(`translateY(${-2 * PITCH}px)`);
      key(handle('c'), 'End');
      key(handle('c'), 'ArrowLeft');
      key(handle('c'), 'ArrowRight');
      key(handle('c'), 'Enter');
      await render();
      expect(host.reorders).toEqual([['a', 'b', 'd', 'e', 'c']]);
    });

    it('stays at the ends of the list', async () => {
      await setup();
      handle('a').focus();
      key(handle('a'), ' ');
      key(handle('a'), 'ArrowUp');
      key(handle('a'), ' ');
      await render();
      expect(host.reorders).toEqual([]);
      expect(announced()).toBe('A dropped at position 1 of 5.');
    });

    it('cancels with Escape and says where the row is', async () => {
      await setup();
      handle('b').focus();
      key(handle('b'), ' ');
      key(handle('b'), 'ArrowDown');
      const escape = key(handle('b'), 'Escape');
      await render();
      expect(escape.defaultPrevented).toBe(true);
      expect(host.reorders).toEqual([]);
      expect(rows().every((entry) => entry.style.transform === '')).toBe(true);
      expect(announced()).toBe('Move cancelled. B is back at position 2 of 5.');
      // The row is no longer held: the arrows do nothing.
      key(handle('b'), 'ArrowDown');
      expect(transformOf('b')).toBe('');
    });

    it('cancels when the focus leaves the handle', async () => {
      await setup();
      handle('b').focus();
      key(handle('b'), ' ');
      key(handle('b'), 'ArrowDown');
      handle('b').blur();
      await render();
      expect(list.classList.contains('is-sorting')).toBe(false);
      expect(host.reorders).toEqual([]);
    });

    it('lets go when the list changes under the held row', async () => {
      await setup();
      handle('b').focus();
      key(handle('b'), ' ');
      host.ids.set(['b', 'a', 'c', 'd', 'e']);
      await render();
      expect(list.classList.contains('is-sorting')).toBe(false);
      key(handle('b'), ' ');
      await render();
      // Space picked it up again instead of dropping the old move.
      expect(host.reorders).toEqual([]);
      expect(handle('b').getAttribute('aria-pressed')).toBe('true');
    });

    it('ignores other keys while a row is held', async () => {
      await setup();
      handle('b').focus();
      key(handle('b'), ' ');
      const other = key(handle('b'), 'a');
      await render();
      expect(other.defaultPrevented).toBe(false);
      expect(handle('b').getAttribute('aria-pressed')).toBe('true');
    });

    it('moves a row one place with Alt+Up and Alt+Down from anywhere in the row', async () => {
      await setup();
      pick('c').focus();
      const down = key(pick('c'), 'ArrowDown', { altKey: true });
      expect(down.defaultPrevented).toBe(true);
      expect(host.reorders).toEqual([['a', 'b', 'd', 'c', 'e']]);
      expect(announced()).toBe('C moved to position 4 of 5.');
      key(pick('c'), 'ArrowUp', { altKey: true });
      expect(host.reorders[1]).toEqual(['a', 'c', 'b', 'd', 'e']);
    });

    it('moves a row to the very start or end with Alt+Shift', async () => {
      await setup();
      key(pick('c'), 'ArrowUp', { altKey: true, shiftKey: true });
      key(pick('c'), 'ArrowDown', { altKey: true, shiftKey: true });
      expect(host.reorders).toEqual([
        ['c', 'a', 'b', 'd', 'e'],
        ['a', 'b', 'd', 'e', 'c'],
      ]);
    });

    it('does nothing at the ends and without Alt', async () => {
      await setup();
      key(pick('a'), 'ArrowUp', { altKey: true });
      key(pick('e'), 'ArrowDown', { altKey: true });
      key(pick('c'), 'ArrowDown');
      key(pick('c'), 'ArrowDown', { altKey: true, ctrlKey: true });
      key(pick('c'), 'ArrowLeft', { altKey: true });
      expect(host.reorders).toEqual([]);
    });

    it('keeps the focus on the same control after the row moved', async () => {
      await setup();
      pick('c').focus();
      key(pick('c'), 'ArrowUp', { altKey: true });
      host.ids.set(host.reorders[0]);
      await render();
      await fixture.whenStable();
      expect(order()).toEqual(['a', 'c', 'b', 'd', 'e']);
      expect(document.activeElement).toBe(pick('c'));
    });
  });

  describe('cleanup', () => {
    it('removes its listeners with the component', async () => {
      await setup();
      pointer('pointerdown', pick('a'), 100, centre(0));
      pointer('pointermove', document, 100, centre(2));
      fixture.destroy();
      pointer('pointermove', document, 100, centre(3));
      pointer('pointerup', document, 100, centre(3));
      expect(host.reorders).toEqual([]);
    });
  });
});
