import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { t } from '@studioflow/i18n';
import { LIMITS, type SceneDto } from '@studioflow/scene-model';
import { ProductionStoreService } from '../../core/state/production-store.service';
import { ConfirmBoxComponent } from '../../core/ui/confirm-box.component';
import {
  ContextMenuDirective,
  ContextMenuService,
  type ContextMenuEntry,
} from '../../core/ui/context-menu';
import { IconComponent } from '../../core/ui/icon.component';
import { PopoverDirective, PopoverService } from '../../core/ui/popover.directive';
import { keyHint } from '../../core/ui/shortcuts';
import { SwitcherService } from '../../stage/switcher.service';
import { InlineEditComponent } from '../shared/inline-edit.component';
import { SceneCommandsService } from './scene-commands.service';
import type { SceneRowView } from './scene-list';
import { SceneThumbComponent } from './scene-thumb.component';

/** Width of the delete confirmation (px). */
const CONFIRM_WIDTH = 260;
/** Width the "⋯" menu is aligned with (the minimum width of the shared context menu, px). */
const MENU_WIDTH = 220;
/** Distance of the confirmation from the row and from the window edges (px). */
const GAP = 6;
const EDGE = 8;

/**
 * One row of the Scenes dock, like a slide in the Keynote navigator: a button with the thumbnail (in the shape of the
 * canvas, 40 px high, the number key 1–9 in its corner), the name and a muted meta line (the "Live" / "Preview"
 * capsule, the slot codes or "K2 disrupted"), `aria-pressed` and an accessible name such as "Interview, live on
 * Program". Its tooltip names what a click does (go live, or into the Preview in Studio Mode).
 *
 * The scene's commands are one menu ({@link menu}), opened by a right click on the row, the context-menu key,
 * Shift+F10 or the "⋯" button at the end of the row: Go live (Take in Studio Mode), Send to Preview, Rename,
 * Duplicate, Move up, Move down and Delete… (disabled with its reason on the live scene). Keyboard on the row: Enter
 * or Space chooses it (like a click), F2 renames, Ctrl/Cmd+D duplicates, Delete or Backspace asks to delete; Alt+↑/↓
 * move it and ↑/↓ move the focus to the next row (both handled by the surrounding sortable list). While renaming, the
 * name is an inline field. Delete asks in a small confirmation anchored to the row, positioned `fixed` because the
 * scene list scrolls; scrolling outside it or resizing the window closes it.
 */
@Component({
  selector: 'sf-scene-row',
  imports: [
    ConfirmBoxComponent,
    ContextMenuDirective,
    IconComponent,
    InlineEditComponent,
    PopoverDirective,
    SceneThumbComponent,
  ],
  templateUrl: './scene-row.component.html',
  styleUrl: './scene-row.component.scss',
  host: {
    '[class.is-program]': 'view().isProgram',
    '[class.is-preview]': 'view().isPreview',
    '[class.is-current]': 'view().pressed',
    '[class.is-menu-open]': 'confirmOpen() || menuOpen()',
  },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SceneRowComponent {
  /** The scene (with local drafts, for the thumbnail). */
  readonly scene = input.required<SceneDto>();
  /** Row model (see `sceneRowView`). */
  readonly view = input.required<SceneRowView>();
  /**
   * Switching is blocked (a fade runs or a switch is in flight): the row is dimmed (`is-blocked`), its tooltip says
   * "Switching…" and the click is ignored. Neither a native `disabled` nor `aria-disabled`: the row keeps its focus and
   * stays a drag handle for reordering, and a test or operator click is not held back until the guard ends and then
   * sent after all.
   */
  readonly blocked = input(false);

  /** The operator chose the scene (click, Enter, Space, "Go live"): the dock calls `SwitcherService.chooseScene`. */
  readonly choose = output<string>();

  protected readonly store = inject(ProductionStoreService);
  protected readonly commands = inject(SceneCommandsService);
  protected readonly switcher = inject(SwitcherService);
  private readonly popovers = inject(PopoverService);
  private readonly menus = inject(ContextMenuService);
  private readonly moreButton = viewChild<ElementRef<HTMLButtonElement>>('more');
  /** The ⋯ menu of this row is open (its trigger says so with aria-expanded). */
  protected readonly menuOpen = computed(
    () =>
      !!this.moreButton() && this.menus.current()?.returnFocus === this.moreButton()?.nativeElement,
  );
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);
  private readonly confirmPanel = viewChild<ElementRef<HTMLElement>>('confirm');

  protected readonly t = t;
  protected readonly maxNameLength = LIMITS.sceneNameLength;
  protected readonly confirmId = computed(() => `scene-delete:${this.view().id}`);
  protected readonly confirmOpen = computed(() => this.popovers.isOpen(this.confirmId()));
  protected readonly renaming = computed(() => this.commands.renamingId() === this.view().id);
  protected readonly deleting = computed(() =>
    this.commands.busy(`scene:${this.view().id}:delete`),
  );
  protected readonly rowTitle = computed(() =>
    this.blocked() ? t('regie.scenes.row.switching') : this.view().hint,
  );
  protected readonly confirmPosition = signal<{ top: number; left: number }>({ top: 0, left: 0 });
  /** The new name while the rename request runs (shown instead of the old one). */
  protected readonly pendingName = signal<string | null>(null);
  protected readonly displayName = computed(() => this.pendingName() ?? this.view().name);

  constructor() {
    effect((onCleanup) => {
      if (!this.confirmOpen()) {
        return;
      }
      const view = this.document.defaultView;
      // A wheel tick inside the confirmation keeps it open; scrolling the list or the page closes it.
      const onScroll = (event: Event): void => {
        const panel = this.confirmPanel()?.nativeElement;
        if (!(event.target instanceof Node) || !panel?.contains(event.target)) {
          untracked(() => this.closeConfirm());
        }
      };
      const onResize = (): void => untracked(() => this.closeConfirm());
      view?.addEventListener('scroll', onScroll, { capture: true, passive: true });
      view?.addEventListener('resize', onResize);
      onCleanup(() => {
        view?.removeEventListener('scroll', onScroll, { capture: true });
        view?.removeEventListener('resize', onResize);
      });
    });
  }

  /**
   * The commands of the scene, for the right-click menu and the "⋯" button. Each one also has a visible place: the row
   * itself (click), the Take button, Properties (name, delete) and the drag handle (order).
   */
  protected readonly menu = (): readonly ContextMenuEntry[] => {
    const view = this.view();
    const online = this.commands.online();
    const studioMode = this.switcher.studioMode();
    const inPreview = this.commands.inPreview(view.id);
    const entries: ContextMenuEntry[] = [];
    if (!studioMode) {
      entries.push({
        label: t('regie.scenes.row.goLive'),
        icon: 'play',
        shortcut: 'Enter',
        disabled: view.isProgram || !online || this.switcher.busy(),
        run: () => this.choose.emit(view.id),
      });
    } else if (inPreview) {
      entries.push({
        label: t('regie.scenes.row.take'),
        icon: 'play',
        shortcut: keyHint('space'),
        disabled: !this.switcher.canTake(),
        run: () => void this.switcher.take(),
      });
    }
    entries.push(
      {
        label: t(
          studioMode ? 'regie.scenes.row.sendToPreview' : 'regie.scenes.row.sendToPreviewStudio',
        ),
        icon: 'send',
        shortcut: studioMode ? 'Enter' : undefined,
        disabled: !online || inPreview || this.switcher.busy(),
        run: () => void this.sendToPreview(),
      },
      'separator',
      {
        label: t('regie.scenes.row.rename'),
        icon: 'pencil',
        shortcut: 'F2',
        disabled: !online,
        run: () => this.startRename(),
      },
      {
        label: t('regie.scenes.row.duplicate'),
        icon: 'copy',
        shortcut: keyHint('mod', 'D'),
        disabled: !this.commands.canCreate() || this.commands.blocked(`scene:${view.id}:duplicate`),
        run: () => void this.duplicate(),
      },
      'separator',
      {
        label: t('regie.scenes.row.moveUp'),
        icon: 'up',
        shortcut: keyHint('Alt', '↑'),
        disabled: !this.commands.canMove(view.id, -1) || this.commands.blocked('scene:order'),
        run: () => void this.move(-1),
      },
      {
        label: t('regie.scenes.row.moveDown'),
        icon: 'down',
        shortcut: keyHint('Alt', '↓'),
        disabled: !this.commands.canMove(view.id, 1) || this.commands.blocked('scene:order'),
        run: () => void this.move(1),
      },
      'separator',
      {
        label: t(view.isProgram ? 'regie.scenes.row.deleteLive' : 'regie.scenes.row.delete'),
        icon: 'trash',
        shortcut: t('regie.scenes.row.deleteKey'),
        danger: true,
        disabled: view.isProgram || !online || this.deleting(),
        run: () => this.askDelete(),
      },
    );
    return entries;
  };

  /** "⋯": the same menu, below the button and right-aligned to it. */
  protected openMenuAt(event: MouseEvent): void {
    const button = event.currentTarget as HTMLElement;
    const rect = button.getBoundingClientRect();
    this.menus.open(
      this.menu(),
      { x: Math.max(EDGE, rect.right - MENU_WIDTH), y: rect.bottom + 4 },
      { label: t('regie.scenes.row.menuLabel', { name: this.displayName() }), returnFocus: button },
    );
  }

  /** F2 renames, Ctrl/Cmd+D duplicates, Delete or Backspace asks to delete (Enter and Space are the click). */
  protected onRowKeyDown(event: KeyboardEvent): void {
    const mod = event.ctrlKey || event.metaKey;
    if (mod && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'd') {
      // Always prevented: Ctrl+D would bookmark the page.
      event.preventDefault();
      if (
        this.commands.canCreate() &&
        !this.commands.blocked(`scene:${this.view().id}:duplicate`)
      ) {
        void this.duplicate();
      }
      return;
    }
    if (mod || event.altKey || event.shiftKey) {
      return;
    }
    if (event.key === 'F2') {
      event.preventDefault();
      this.startRename();
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      this.askDelete();
    }
  }

  protected startRename(): void {
    this.commands.setRenaming(this.view().id);
  }

  protected async rename(name: string): Promise<void> {
    this.commands.setRenaming(null);
    this.pendingName.set(name);
    this.focusRow();
    try {
      await this.commands.rename(this.view().id, name);
    } finally {
      this.pendingName.set(null);
    }
  }

  protected cancelRename(): void {
    this.commands.setRenaming(null);
    this.focusRow();
  }

  protected async duplicate(): Promise<void> {
    await this.commands.duplicate(this.view().id);
  }

  protected async sendToPreview(): Promise<void> {
    this.focusRow();
    await this.commands.sendToPreview(this.view().id);
  }

  protected async move(direction: -1 | 1): Promise<void> {
    if (await this.commands.move(this.view().id, direction)) {
      // The row element moves in the DOM, which drops the focus in some browsers.
      this.focusRow();
    }
  }

  /**
   * "Delete…": the confirmation opens below the row (the focus moves to its "Cancel"). The live scene cannot be
   * deleted: the key then shows the reason as a toast (the menu item names it).
   */
  protected askDelete(): void {
    const view = this.view();
    if (view.isProgram) {
      this.commands.explainLiveDelete();
      return;
    }
    if (!this.commands.online() || this.deleting()) {
      return;
    }
    const row = this.element.querySelector<HTMLElement>('.c-scene') ?? this.element;
    const rect = row.getBoundingClientRect();
    this.place(rect.left, rect.bottom + GAP, rect.top - GAP);
    this.popovers.open(this.confirmId());
  }

  protected cancelDelete(): void {
    this.closeConfirm();
    this.focusRow();
  }

  protected async remove(): Promise<void> {
    if (await this.commands.remove(this.view().id)) {
      this.closeConfirm();
    }
  }

  private closeConfirm(): void {
    this.popovers.close(this.confirmId());
  }

  /**
   * Places the confirmation at `left`/`below`, inside the window; when it does not fit below, it opens upwards from
   * `above`. The height is measured once it has rendered.
   */
  private place(left: number, below: number, above: number): void {
    const view = this.document.defaultView;
    const width = view?.innerWidth ?? 0;
    const clampedLeft = Math.max(EDGE, Math.min(left, width - CONFIRM_WIDTH - EDGE));
    this.confirmPosition.set({ top: below, left: clampedLeft });
    afterNextRender(
      () => {
        const panel = this.confirmPanel()?.nativeElement;
        const height = view?.innerHeight ?? 0;
        if (!panel || !view) {
          return;
        }
        const panelHeight = panel.getBoundingClientRect().height;
        if (below + panelHeight > height - EDGE && above - panelHeight > EDGE) {
          this.confirmPosition.set({ top: above - panelHeight, left: clampedLeft });
        }
      },
      { injector: this.injector },
    );
  }

  private focusRow(): void {
    afterNextRender(() => this.element.querySelector<HTMLButtonElement>('.c-scene')?.focus(), {
      injector: this.injector,
    });
  }
}
