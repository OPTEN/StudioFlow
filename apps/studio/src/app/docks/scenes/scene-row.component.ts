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
} from '@angular/core';
import { t } from '@studioflow/i18n';
import { LIMITS, type SceneDto } from '@studioflow/scene-model';
import { IconComponent } from '../../core/ui/icon.component';
import {
  PopoverDirective,
  PopoverService,
  PopoverTriggerDirective,
} from '../../core/ui/popover.directive';
import { InlineEditComponent } from '../shared/inline-edit.component';
import { handleMenuKeys } from '../shared/menu-keys';
import { SceneCommandsService } from './scene-commands.service';
import type { SceneRowView } from './scene-list';
import { SceneThumbComponent } from './scene-thumb.component';

/** Width of the scene action menu (px); used to anchor it to the right edge of its trigger. */
const MENU_WIDTH = 200;
/** Approximate height of the menu, to open it upwards near the bottom of the window. */
const MENU_HEIGHT = 168;

/**
 * One row of the Scenes dock (prototype `.scene`): a button with the 16:9 thumbnail and keycap, name and meta
 * (PGM/PVW tag, slot codes or "K2 disrupted"), `aria-pressed` and the prototype's `aria-label`. Next to it the "…"
 * button opens the scene's actions (Rename, Duplicate, Move up, Move down). Keyboard: F2 renames; Alt+↑/↓ move the
 * scene (handled by the surrounding sortable list). While renaming, the name is an inline field.
 *
 * The menu is positioned `fixed` next to its trigger because the scene list scrolls (an absolute popover would be
 * clipped); scrolling or resizing closes it.
 */
@Component({
  selector: 'sf-scene-row',
  imports: [
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

  /** The operator chose the scene (click, Enter, Space): the dock calls `SwitcherService.chooseScene`. */
  readonly choose = output<string>();

  protected readonly commands = inject(SceneCommandsService);
  protected readonly popovers = inject(PopoverService);
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);

  protected readonly t = t;
  protected readonly maxNameLength = LIMITS.sceneNameLength;
  protected readonly menuId = computed(() => `scene-menu:${this.view().id}`);
  protected readonly menuOpen = computed(() => this.popovers.isOpen(this.menuId()));
  protected readonly renaming = computed(() => this.commands.renamingId() === this.view().id);
  protected readonly canMoveUp = computed(() => this.canMove(-1));
  protected readonly canMoveDown = computed(() => this.canMove(1));
  protected readonly menuPosition = signal<{ top: number; left: number }>({ top: 0, left: 0 });
  /** The new name while the rename request runs (shown instead of the old one). */
  protected readonly pendingName = signal<string | null>(null);
  protected readonly displayName = computed(() => this.pendingName() ?? this.view().name);

  constructor() {
    effect((onCleanup) => {
      if (!this.menuOpen()) {
        return;
      }
      const close = (): void => this.popovers.close(this.menuId());
      const view = this.document.defaultView;
      view?.addEventListener('scroll', close, { capture: true, passive: true });
      view?.addEventListener('resize', close);
      onCleanup(() => {
        view?.removeEventListener('scroll', close, { capture: true });
        view?.removeEventListener('resize', close);
      });
    });
  }

  /** Anchors the menu below the "…" button (above it near the bottom edge of the window). */
  protected placeMenu(event: MouseEvent): void {
    const trigger = event.currentTarget as HTMLElement;
    const rect = trigger.getBoundingClientRect();
    const viewportHeight = this.document.defaultView?.innerHeight ?? 0;
    const below = rect.bottom + 6;
    const top =
      below + MENU_HEIGHT > viewportHeight && rect.top - 6 - MENU_HEIGHT > 0
        ? rect.top - 6 - MENU_HEIGHT
        : below;
    this.menuPosition.set({ top, left: Math.max(8, rect.right - MENU_WIDTH) });
  }

  protected onRowKeyDown(event: KeyboardEvent): void {
    if (event.key === 'F2') {
      event.preventDefault();
      this.startRename();
    }
  }

  /** Roving focus inside the menu (↑/↓, Home/End). Escape is handled by the PopoverService. */
  protected onMenuKeyDown(event: KeyboardEvent): void {
    handleMenuKeys(event, event.currentTarget as HTMLElement);
  }

  protected startRename(): void {
    this.popovers.close(this.menuId());
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
    this.popovers.close(this.menuId());
    await this.commands.duplicate(this.view().id);
  }

  protected async move(direction: -1 | 1): Promise<void> {
    this.popovers.close(this.menuId());
    if (await this.commands.move(this.view().id, direction)) {
      // The row element moves in the DOM, which drops the focus in some browsers.
      this.focusRow();
    }
  }

  private canMove(direction: -1 | 1): boolean {
    return this.commands.canMove(this.view().id, direction);
  }

  private focusRow(): void {
    afterNextRender(() => this.element.querySelector<HTMLButtonElement>('.c-scene')?.focus(), {
      injector: this.injector,
    });
  }
}
