import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { t, tm } from '@studioflow/i18n';
import type { ItemFit } from '@studioflow/scene-model';
import { ProductionStoreService } from '../../core/state/production-store.service';
import { ContextMenuDirective, type ContextMenuEntry } from '../../core/ui/context-menu';
import { IconComponent } from '../../core/ui/icon.component';
import { PopoverService, PopoverTriggerDirective } from '../../core/ui/popover.directive';
import { ToastService } from '../../core/ui/toast.service';
import { DockFrameComponent } from '../../shell/workspace/dock-frame.component';
import { EditorService } from '../../stage/editor.service';
import { SwitcherService } from '../../stage/switcher.service';
import { EditStatusComponent } from '../shared/edit-status.component';
import { ElapsedComponent } from '../shared/elapsed.component';
import { messageParts } from '../shared/message-parts';
import { SceneTagComponent } from '../shared/scene-tag.component';
import { SortableItemDirective, SortableListComponent } from '../shared/sortable-list.component';
import { toneClass, type StateTone } from '../shared/source-view';
import { StationThumbComponent } from '../stations/station-thumb.component';
import { ADD_SOURCE_POPOVER, AddSourcePopoverComponent } from './add-source-popover.component';
import { AssetUploadService } from './asset-upload.service';
import { MEDIA_POPOVER, MediaPopoverComponent } from './media-popover.component';
import { PlaceholderListComponent } from './placeholder-list.component';
import { flipOrder, sourceRows, type SourceRowView } from './source-rows';
import { dragHasFiles } from './upload-validation';

/**
 * The Sources dock, a layer list of the edit scene: the body starts with the scene it lists ("in Interview" with its
 * "Live" / "Preview" capsule) and the status line (live edits, read-only, offline), then the items front to back, each
 * with kind icon, slot code, name, state with timer and lamp, and the eye and lock toggles at the end (shown on hover,
 * on focus and while they are switched on). Selecting a row selects the item for the monitor and Properties
 * (`EditorService.select`); selecting the selected row again clears the selection (toggle, `aria-pressed`). The header
 * holds undo, redo and "+ Source" (add a source, new text, upload, media library); an empty scene offers the same as
 * buttons. Files dropped on the dock are uploaded. The rows are reordered by drag and drop or from the keyboard
 * ({@link SortableListComponent}); the top row is the front layer, and `EditorService.reorderItems` sends the new
 * order. A right click on a row (or the context-menu key) offers the commands of the item: show or hide, lock, the
 * layer order, fit or fill, Properties… and Remove from scene; each also has a button here or in Properties. Keyboard
 * on a row: Enter or Space selects it, ↑/↓ select the neighbour, Delete or Backspace removes it from the scene (the toast
 * and Ctrl+Z bring it back). In a copied production the section "Missing sources" below the rows lists the placeholders of the original
 * devices with "Assign…" ({@link PlaceholderListComponent}).
 */
@Component({
  selector: 'sf-sources-dock',
  imports: [
    AddSourcePopoverComponent,
    ContextMenuDirective,
    DockFrameComponent,
    EditStatusComponent,
    ElapsedComponent,
    IconComponent,
    MediaPopoverComponent,
    PlaceholderListComponent,
    PopoverTriggerDirective,
    SceneTagComponent,
    SortableItemDirective,
    SortableListComponent,
    StationThumbComponent,
  ],
  templateUrl: './sources-dock.component.html',
  styleUrl: './sources-dock.component.scss',
  host: { style: 'display: contents' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SourcesDockComponent {
  protected readonly editor = inject(EditorService);
  protected readonly popovers = inject(PopoverService);
  private readonly store = inject(ProductionStoreService);
  private readonly switcher = inject(SwitcherService);
  private readonly uploads = inject(AssetUploadService);
  private readonly toasts = inject(ToastService);
  private readonly addTrigger = viewChild<ElementRef<HTMLElement>>('addTrigger');

  protected readonly t = t;
  protected readonly addPopover = ADD_SOURCE_POPOVER;
  protected readonly mediaPopover = MEDIA_POPOVER;
  /** The media popover opens the file dialog when it appears. */
  protected readonly pickOnOpen = signal(false);
  protected readonly dropActive = signal(false);

  protected readonly loading = computed(() => this.store.state() === null);
  protected readonly scene = this.editor.editScene;
  protected readonly count = computed(() => this.scene()?.items.length ?? null);
  protected readonly rows = computed<readonly SourceRowView[]>(() => {
    const scene = this.scene();
    return scene
      ? sourceRows(
          scene,
          this.store.sources(),
          this.editor.selectedItemId(),
          this.store.placeholders(),
        )
      : [];
  });
  protected readonly rowIds = computed(() => this.rows().map((row) => row.itemId));
  protected readonly rowsById = computed(
    () => new Map(this.rows().map((row) => [row.itemId, row] as const)),
  );
  /** Name of a row for the reorder handle and the announcements: "K1 Phone stage left". */
  protected readonly rowName = (itemId: string): string => {
    const row = this.rowsById().get(itemId);
    return row ? `${row.code} ${row.name}` : '';
  };
  /** "in {scene}": the text around the scene name of the body head. */
  protected readonly editingParts = computed(() =>
    messageParts((mark) => t('regie.sources.dock.editing', { scene: mark })),
  );
  /** Hint below the rows: in an Auto grid scene what the order means, else (prototype) while nothing is selected. */
  protected readonly hint = computed(() => {
    if (this.rows().length === 0) {
      return null;
    }
    if (this.scene()?.layoutMode === 'autoGrid') {
      return t('regie.sources.hint.autoGrid');
    }
    if (this.editor.selectedItem() || this.editor.editLocked()) {
      return null;
    }
    return t(
      this.switcher.studioMode() ? 'regie.sources.hint.preview' : 'regie.sources.hint.program',
    );
  });

  constructor() {
    // Escape in the media popover returns the focus to "+ Source".
    let unregister: (() => void) | null = null;
    afterNextRender(() => {
      const trigger = this.addTrigger()?.nativeElement;
      if (trigger) {
        unregister = this.popovers.registerScope(MEDIA_POPOVER, trigger, true);
      }
    });
    inject(DestroyRef).onDestroy(() => unregister?.());
  }

  protected toneClass(tone: StateTone): string {
    return toneClass(tone);
  }

  /** A row was dragged or moved: the dock lists front to back, the scene stores back to front. */
  protected reorder(rowIds: readonly string[]): void {
    this.editor.reorderItems(flipOrder(rowIds));
  }

  /** The commands of a row's right-click menu. */
  protected rowMenu(row: SourceRowView): () => readonly ContextMenuEntry[] {
    return () => {
      const item = this.editor.itemById(row.itemId);
      const items = this.scene()?.items ?? [];
      const index = items.findIndex((entry) => entry.id === row.itemId);
      const canEdit = this.editor.canEdit();
      const atFront = index < 0 || index === items.length - 1;
      const atBack = index <= 0;
      const entries: ContextMenuEntry[] = [
        {
          label: t(row.hidden ? 'regie.sources.menu.show' : 'regie.sources.menu.hide'),
          icon: row.hidden ? 'eye' : 'eye-off',
          run: () => this.editor.toggleHidden(row.itemId),
        },
        {
          label: t(row.locked ? 'regie.sources.menu.unlock' : 'regie.sources.menu.lock'),
          icon: row.locked ? 'unlock' : 'lock',
          run: () => this.editor.toggleLocked(row.itemId),
        },
        'separator',
        {
          label: t('regie.properties.element.layerToFront'),
          disabled: !canEdit || atFront,
          run: () => this.editor.moveLayer(row.itemId, 'front'),
        },
        {
          label: t('regie.properties.element.layerForward'),
          icon: 'up',
          disabled: !canEdit || atFront,
          run: () => this.editor.moveLayer(row.itemId, 'up'),
        },
        {
          label: t('regie.properties.element.layerBackward'),
          icon: 'down',
          disabled: !canEdit || atBack,
          run: () => this.editor.moveLayer(row.itemId, 'down'),
        },
        {
          label: t('regie.properties.element.layerToBack'),
          disabled: !canEdit || atBack,
          run: () => this.editor.moveLayer(row.itemId, 'back'),
        },
      ];
      if (item && !row.isText) {
        entries.push(
          'separator',
          {
            label: t('regie.properties.element.fitCover'),
            checked: item.fit === 'cover',
            disabled: !canEdit,
            run: () => this.setFit(row.itemId, 'cover'),
          },
          {
            label: t('regie.properties.element.fitContain'),
            checked: item.fit === 'contain',
            disabled: !canEdit,
            run: () => this.setFit(row.itemId, 'contain'),
          },
        );
      }
      entries.push(
        'separator',
        {
          label: t('regie.sources.menu.properties'),
          icon: 'sliders',
          disabled: row.hidden && !row.isText,
          run: () => this.editor.select(row.itemId),
        },
        {
          label: t('regie.properties.element.remove'),
          icon: 'trash',
          shortcut: t('regie.sources.menu.deleteKey'),
          danger: true,
          disabled: !canEdit,
          run: () => this.editor.removeItem(row.itemId),
        },
      );
      return entries;
    };
  }

  /** Delete or Backspace on a row removes the item from the scene (the toast offers Undo, Ctrl+Z works too). */
  protected onRowKeyDown(row: SourceRowView, event: KeyboardEvent): void {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
      return;
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      this.editor.removeItem(row.itemId);
    }
  }

  /** ↑/↓ moved the focus to another row: select it (a hidden camera, screen or medium cannot be selected). */
  protected onFocusStep(itemId: string): void {
    const row = this.rowsById().get(itemId);
    if (row && (!row.hidden || row.isText)) {
      this.editor.select(itemId);
    }
  }

  /** Selects the row's item; a second click on the selected row clears the selection (back to the scene). */
  protected select(row: SourceRowView, event?: Event): void {
    event?.stopPropagation();
    if (!row.hidden || row.isText) {
      this.editor.select(row.selected ? null : row.itemId);
    }
  }

  private setFit(itemId: string, fit: ItemFit): void {
    const item = this.editor.itemById(itemId);
    if (item && item.fit !== fit) {
      this.editor.updateItem({ ...item, fit });
    }
  }

  protected toggleHidden(row: SourceRowView, event: Event): void {
    event.stopPropagation();
    this.editor.toggleHidden(row.itemId);
  }

  protected toggleLocked(row: SourceRowView, event: Event): void {
    event.stopPropagation();
    this.editor.toggleLocked(row.itemId);
  }

  /** "Add a source" of the empty state: the "+ Source" menu of the header. */
  protected openAdd(): void {
    this.popovers.open(ADD_SOURCE_POPOVER);
  }

  /** "New lower third" of the empty state: a new text, added hidden and selected for writing. */
  protected addLowerThird(): void {
    void this.editor.addText('lowerThird');
  }

  protected openUpload(): void {
    this.pickOnOpen.set(true);
    this.popovers.open(MEDIA_POPOVER);
  }

  protected openMedia(): void {
    this.pickOnOpen.set(false);
    this.popovers.open(MEDIA_POPOVER);
  }

  protected onDragOver(event: DragEvent): void {
    if (!dragHasFiles(event)) {
      return;
    }
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy';
    }
    this.dropActive.set(true);
  }

  protected onDragLeave(event: DragEvent): void {
    const zone = event.currentTarget as HTMLElement;
    if (!(event.relatedTarget instanceof Node) || !zone.contains(event.relatedTarget)) {
      this.dropActive.set(false);
    }
  }

  /** Files dropped on the dock are uploaded; the media popover shows the progress. */
  protected onDrop(event: DragEvent): void {
    if (!dragHasFiles(event)) {
      return;
    }
    event.preventDefault();
    this.dropActive.set(false);
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length === 0) {
      return;
    }
    const result = this.uploads.add(files);
    if (result.rejected.length > 0) {
      this.toasts.show(tm(result.rejected[0]));
    }
    if (result.accepted > 0) {
      this.openMedia();
    }
  }
}
