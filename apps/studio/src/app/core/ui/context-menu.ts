import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  Directive,
  ElementRef,
  Injectable,
  afterRenderEffect,
  computed,
  inject,
  input,
  signal,
  viewChildren,
} from '@angular/core';
import { IconComponent, type IconName } from './icon.component';
import { KeyboardService } from './keyboard.service';

/** One command of a context menu. */
export interface ContextMenuItem {
  readonly label: string;
  readonly run: () => void;
  readonly icon?: IconName;
  /** Shortcut hint shown on the right ("Space", "Ctrl+D", "Del"); the shortcut itself is handled elsewhere. */
  readonly shortcut?: string;
  /** Destructive command: red text. */
  readonly danger?: boolean;
  readonly disabled?: boolean;
  /** Shows a checkmark (toggle state). */
  readonly checked?: boolean;
}

/** A command or a separator line. */
export type ContextMenuEntry = ContextMenuItem | 'separator';

interface OpenMenu {
  readonly entries: readonly ContextMenuEntry[];
  readonly x: number;
  readonly y: number;
  readonly label: string;
  readonly returnFocus: HTMLElement | null;
}

/**
 * The right-click menu of the Regie (DESIGN.md "Context menus"): one at a time, opened at the pointer by a right click
 * or at the element by the context-menu key or Shift+F10. Arrow keys move, Enter or Space runs, Escape or a click outside
 * closes and returns the focus. Every command of a context menu also exists somewhere visible (a button or a ⋯ menu);
 * the context menu is the fast path, never the only one.
 */
@Injectable({ providedIn: 'root' })
export class ContextMenuService {
  private readonly menu = signal<OpenMenu | null>(null);

  /** The open menu, or null. */
  readonly current = this.menu.asReadonly();

  constructor() {
    const unregister = inject(KeyboardService).registerEscape('popover', () => {
      if (!this.menu()) {
        return false;
      }
      this.close();
      return true;
    });
    inject(DestroyRef).onDestroy(unregister);
  }

  /** Opens a menu at a viewport position; empty lists open nothing. */
  open(
    entries: readonly ContextMenuEntry[],
    position: { x: number; y: number },
    options: { label?: string; returnFocus?: HTMLElement | null } = {},
  ): void {
    if (!entries.some((entry) => entry !== 'separator')) {
      return;
    }
    this.menu.set({
      entries,
      x: position.x,
      y: position.y,
      label: options.label ?? '',
      returnFocus: options.returnFocus ?? null,
    });
  }

  /** Closes the menu; `restoreFocus` puts the focus back on the element that opened it. */
  close(restoreFocus = true): void {
    const open = this.menu();
    this.menu.set(null);
    if (restoreFocus) {
      open?.returnFocus?.focus();
    }
  }

  /** Runs a command and closes the menu. */
  run(item: ContextMenuItem): void {
    if (item.disabled) {
      return;
    }
    this.close();
    item.run();
  }
}

/**
 * `[sfContextMenu]="menuFor(row)"` on any element: right click, the context-menu key and Shift+F10 open the entries at
 * the pointer or at the element. Pass a function so the entries are built when the menu opens.
 */
@Directive({
  selector: '[sfContextMenu]',
  host: {
    '(contextmenu)': 'onContextMenu($event)',
    '(keydown)': 'onKeydown($event)',
  },
})
export class ContextMenuDirective {
  private readonly menus = inject(ContextMenuService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** Builds the entries when the menu opens. */
  readonly sfContextMenu = input.required<() => readonly ContextMenuEntry[]>();
  /** Accessible name of the menu ("Scene Welcome"). */
  readonly sfContextMenuLabel = input('');

  protected onContextMenu(event: MouseEvent): void {
    const entries = this.sfContextMenu()();
    if (!entries.some((entry) => entry !== 'separator')) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.menus.open(entries, { x: event.clientX, y: event.clientY }, this.options());
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) {
      return;
    }
    event.preventDefault();
    const rect = this.host.nativeElement.getBoundingClientRect();
    this.menus.open(
      this.sfContextMenu()(),
      { x: rect.left + 12, y: rect.bottom - 4 },
      this.options(),
    );
  }

  private options(): { label: string; returnFocus: HTMLElement | null } {
    const active = this.host.nativeElement.ownerDocument.activeElement;
    return {
      label: this.sfContextMenuLabel(),
      returnFocus: active instanceof HTMLElement ? active : this.host.nativeElement,
    };
  }
}

/** Renders the open context menu (once, in the root component). */
@Component({
  selector: 'sf-context-menu-host',
  imports: [IconComponent],
  template: `
    @if (menus.current(); as open) {
      <div
        class="c-ctx"
        role="menu"
        tabindex="-1"
        [attr.aria-label]="open.label || null"
        [style.left.px]="position().x"
        [style.top.px]="position().y"
        (keydown)="onKeydown($event)"
      >
        @for (entry of open.entries; track $index) {
          @if (entry === 'separator') {
            <div class="c-menu-sep" role="separator"></div>
          } @else {
            <button
              #item
              class="c-menu-item c-ctx__item"
              type="button"
              role="menuitem"
              tabindex="-1"
              [class.is-danger]="entry.danger"
              [disabled]="entry.disabled"
              [attr.aria-checked]="entry.checked ?? null"
              (click)="menus.run(entry)"
            >
              <span class="c-ctx__check" aria-hidden="true">
                @if (entry.checked) {
                  <svg sfIcon="check" [size]="14"></svg>
                } @else if (entry.icon) {
                  <svg [sfIcon]="entry.icon" [size]="14"></svg>
                }
              </span>
              <span class="c-ctx__label">{{ entry.label }}</span>
              @if (entry.shortcut) {
                <kbd class="c-ctx__key">{{ entry.shortcut }}</kbd>
              }
            </button>
          }
        }
      </div>
    }
  `,
  styles: `
    .c-ctx {
      background: var(--float);
      border-radius: 10px;
      box-shadow: var(--shadow-pop);
      display: grid;
      max-height: calc(100dvh - 16px);
      min-width: 220px;
      overflow-y: auto;
      padding: 5px;
      position: fixed;
      z-index: 90;
    }

    .c-ctx__item {
      min-height: 26px;
      padding: 3px 8px;
    }

    .c-ctx__item.is-danger:not(:hover, :focus-visible) {
      color: var(--red);
    }

    .c-ctx__check {
      display: grid;
      flex: none;
      place-items: center;
      width: 14px;
    }

    .c-ctx__label {
      flex: 1;
    }

    .c-ctx__key {
      color: var(--muted);
      font: inherit;
      font-size: 12px;
      margin-left: 18px;
    }

    .c-ctx__item:hover .c-ctx__key,
    .c-ctx__item:focus-visible .c-ctx__key {
      color: var(--on-fill);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ContextMenuHostComponent {
  protected readonly menus = inject(ContextMenuService);
  private readonly document = inject(DOCUMENT);
  private readonly items = viewChildren<ElementRef<HTMLButtonElement>>('item');
  private readonly size = signal({ width: 220, height: 0 });

  /** Keeps the menu inside the viewport (flips left or up near an edge). */
  protected readonly position = computed(() => {
    const open = this.menus.current();
    if (!open) {
      return { x: 0, y: 0 };
    }
    const view = this.document.defaultView;
    const width = view?.innerWidth ?? 1280;
    const height = view?.innerHeight ?? 720;
    const { width: w, height: h } = this.size();
    const x = open.x + w + 8 > width ? Math.max(8, open.x - w) : open.x;
    const y = open.y + h + 8 > height ? Math.max(8, height - h - 8) : open.y;
    return { x, y };
  });

  private readonly onPointerDown = (event: Event): void => {
    const target = event.target as Node | null;
    const menu = this.document.querySelector('.c-ctx');
    if (this.menus.current() && menu && target && !menu.contains(target)) {
      this.menus.close(false);
    }
  };

  constructor() {
    this.document.addEventListener('pointerdown', this.onPointerDown, true);
    this.document.defaultView?.addEventListener('blur', () => this.menus.close(false));
    inject(DestroyRef).onDestroy(() =>
      this.document.removeEventListener('pointerdown', this.onPointerDown, true),
    );
    afterRenderEffect(() => {
      const open = this.menus.current();
      const menu = this.document.querySelector<HTMLElement>('.c-ctx');
      if (!open || !menu) {
        return;
      }
      const rect = menu.getBoundingClientRect();
      if (rect.width !== this.size().width || rect.height !== this.size().height) {
        this.size.set({ width: rect.width, height: rect.height });
      }
      if (!menu.contains(this.document.activeElement)) {
        this.firstEnabled()?.focus();
      }
    });
  }

  protected onKeydown(event: KeyboardEvent): void {
    const buttons = this.items()
      .map((item) => item.nativeElement)
      .filter((button) => !button.disabled);
    const index = buttons.indexOf(this.document.activeElement as HTMLButtonElement);
    const move = (to: number): void => {
      event.preventDefault();
      buttons[(to + buttons.length) % buttons.length]?.focus();
    };
    switch (event.key) {
      case 'ArrowDown':
        move(index + 1);
        break;
      case 'ArrowUp':
        move(index - 1);
        break;
      case 'Home':
        move(0);
        break;
      case 'End':
        move(buttons.length - 1);
        break;
      case 'Tab':
        event.preventDefault();
        this.menus.close();
        break;
    }
  }

  private firstEnabled(): HTMLButtonElement | undefined {
    return this.items()
      .map((item) => item.nativeElement)
      .find((button) => !button.disabled);
  }
}
