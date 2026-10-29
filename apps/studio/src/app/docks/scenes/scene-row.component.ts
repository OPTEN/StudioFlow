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
import { IconComponent } from '../../core/ui/icon.component';
import {
  PopoverDirective,
  PopoverService,
  PopoverTriggerDirective,
} from '../../core/ui/popover.directive';
import { SwitcherService } from '../../stage/switcher.service';
import { InlineEditComponent } from '../shared/inline-edit.component';
import { handleMenuKeys } from '../shared/menu-keys';
import { SceneCommandsService } from './scene-commands.service';
import type { SceneRowView } from './scene-list';
import { SceneThumbComponent } from './scene-thumb.component';

/** Width of the scene action menu (px); used to anchor it to the right edge of its trigger. */
const MENU_WIDTH = 232;
/** Distance of the menu from its trigger and from the window edges (px). */
const GAP = 6;
const EDGE = 8;

/**
 * One row of the Scenes dock, like a slide in the Keynote navigator: a button with the thumbnail (in the shape of the
 * canvas, 40 px high, the number key 1–9 in its corner), the name and a muted meta line (the "Live" / "Preview"
 * capsule, the slot codes or "K2 disrupted"), `aria-pressed` and an accessible name such as "Interview, live on
 * Program". Its tooltip names what a click does (go live, or into the Preview in Studio Mode). The "⋯" button in the
 * reserved space at the end of the row, or a right click on the row, opens the scene's menu: Rename, Duplicate, Send to
 * Preview, Move up, Move down and Delete (behind a confirmation, disabled with its reason on the live scene). Keyboard:
 * F2 renames; Alt+↑/↓ move the scene (handled by the surrounding sortable list). While renaming, the name is an inline
 * field.
 *
 * The menu is positioned `fixed` next to its trigger (or at the pointer) because the scene list scrolls (an absolute
 * popover would be clipped); scrolling outside the menu or resizing the window closes it.
 */
@Component({
  selector: 'sf-scene-row',
  imports: [
    ConfirmBoxComponent,
    IconComponent,
    InlineEditComponent,
    PopoverDirective,
    PopoverTriggerDirective,
    SceneThumbComponent,
  ],
  templateUrl: './scene-row.component.html',
  styleUrl: './scene-row.component.scss',
  host: {
    '[class.is-program]': 'view().isProgram',
    '[class.is-preview]': 'view().isPreview',
    '[class.is-current]': 'view().pressed',
    '[class.is-menu-open]': 'menuOpen()',
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

  /** The operator chose the scene (click, Enter, Space): the dock calls `SwitcherService.chooseScene`. */
  readonly choose = output<string>();

  protected readonly store = inject(ProductionStoreService);
  protected readonly commands = inject(SceneCommandsService);
  protected readonly switcher = inject(SwitcherService);
  protected readonly popovers = inject(PopoverService);
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);
  private readonly menu = viewChild<ElementRef<HTMLElement>>('menu');

  protected readonly t = t;
  protected readonly maxNameLength = LIMITS.sceneNameLength;
  protected readonly menuId = computed(() => `scene-menu:${this.view().id}`);
  protected readonly menuOpen = computed(() => this.popovers.isOpen(this.menuId()));
  protected readonly renaming = computed(() => this.commands.renamingId() === this.view().id);
  protected readonly canMoveUp = computed(() => this.canMove(-1));
  protected readonly canMoveDown = computed(() => this.canMove(1));
  protected readonly inPreview = computed(() => this.commands.inPreview(this.view().id));
  protected readonly deleting = computed(() =>
    this.commands.busy(`scene:${this.view().id}:delete`),
  );
  protected readonly rowTitle = computed(() =>
    this.blocked() ? t('regie.scenes.row.switching') : this.view().hint,
  );
  protected readonly menuPosition = signal<{ top: number; left: number }>({ top: 0, left: 0 });
  /** The menu shows the delete confirmation instead of its items. */
  protected readonly confirming = signal(false);
  /** The new name while the rename request runs (shown instead of the old one). */
  protected readonly pendingName = signal<string | null>(null);
  protected readonly displayName = computed(() => this.pendingName() ?? this.view().name);

  constructor() {
    effect((onCleanup) => {
      if (!this.menuOpen()) {
        untracked(() => this.confirming.set(false));
        return;
      }
      const view = this.document.defaultView;
      // A wheel tick inside the menu (or its confirmation) keeps it open; scrolling the list or the page closes it.
      const onScroll = (event: Event): void => {
        const panel = this.menu()?.nativeElement;
        if (!(event.target instanceof Node) || !panel?.contains(event.target)) {
          this.close();
        }
      };
      const onResize = (): void => this.close();
      view?.addEventListener('scroll', onScroll, { capture: true, passive: true });
      view?.addEventListener('resize', onResize);
      onCleanup(() => {
        view?.removeEventListener('scroll', onScroll, { capture: true });
        view?.removeEventListener('resize', onResize);
      });
    });
  }

  /** "⋯": anchors the menu below the button, right-aligned to it (the trigger directive opens it). */
  protected openBelow(event: MouseEvent): void {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.place(rect.right - MENU_WIDTH, rect.bottom + GAP, rect.top - GAP);
  }

  /** A right click on the row opens the same menu at the pointer. */
  protected openAtPointer(event: MouseEvent): void {
    event.preventDefault();
    this.place(event.clientX, event.clientY, event.clientY);
    this.popovers.open(this.menuId());
  }

  protected onRowKeyDown(event: KeyboardEvent): void {
    if (event.key === 'F2') {
      event.preventDefault();
      this.startRename();
    } else if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      // The keyboard's menu key opens the row menu below the row.
      event.preventDefault();
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
      this.place(rect.left + 12, rect.bottom + GAP, rect.top - GAP);
      this.popovers.open(this.menuId());
    }
  }

  /** Roving focus inside the menu (↑/↓, Home/End). Escape is handled by the PopoverService. */
  protected onMenuKeyDown(event: KeyboardEvent): void {
    if (!this.confirming()) {
      handleMenuKeys(event, event.currentTarget as HTMLElement);
    }
  }

  protected startRename(): void {
    this.close();
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
    this.close();
    await this.commands.duplicate(this.view().id);
  }

  protected async sendToPreview(): Promise<void> {
    this.close();
    this.focusRow();
    await this.commands.sendToPreview(this.view().id);
  }

  protected async move(direction: -1 | 1): Promise<void> {
    this.close();
    if (await this.commands.move(this.view().id, direction)) {
      // The row element moves in the DOM, which drops the focus in some browsers.
      this.focusRow();
    }
  }

  /** "Delete…": the menu turns into the confirmation (the focus moves to its "Cancel"). */
  protected askDelete(): void {
    this.confirming.set(true);
  }

  protected cancelDelete(): void {
    this.close();
    this.focusRow();
  }

  protected async remove(): Promise<void> {
    if (await this.commands.remove(this.view().id)) {
      this.close();
    }
  }

  private canMove(direction: -1 | 1): boolean {
    return this.commands.canMove(this.view().id, direction);
  }

  private close(): void {
    this.popovers.close(this.menuId());
  }

  /**
   * Places the menu at `left`/`below`, inside the window; when it does not fit below, it opens upwards from `above`.
   * The height is measured once the menu has rendered.
   */
  private place(left: number, below: number, above: number): void {
    const view = this.document.defaultView;
    const width = view?.innerWidth ?? 0;
    const clampedLeft = Math.max(EDGE, Math.min(left, width - MENU_WIDTH - EDGE));
    this.menuPosition.set({ top: below, left: clampedLeft });
    afterNextRender(
      () => {
        const panel = this.menu()?.nativeElement;
        const height = view?.innerHeight ?? 0;
        if (!panel || !view) {
          return;
        }
        const menuHeight = panel.getBoundingClientRect().height;
        if (below + menuHeight > height - EDGE && above - menuHeight > EDGE) {
          this.menuPosition.set({ top: above - menuHeight, left: clampedLeft });
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
