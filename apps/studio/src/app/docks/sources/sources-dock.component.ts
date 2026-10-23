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
import { ProductionStoreService } from '../../core/state/production-store.service';
import { IconComponent } from '../../core/ui/icon.component';
import { PopoverService, PopoverTriggerDirective } from '../../core/ui/popover.directive';
import { ToastService } from '../../core/ui/toast.service';
import { DockFrameComponent } from '../../shell/workspace/dock-frame.component';
import { EditorService } from '../../stage/editor.service';
import { SwitcherService } from '../../stage/switcher.service';
import { ElapsedComponent } from '../shared/elapsed.component';
import { toneClass, type StateTone } from '../shared/source-view';
import { ADD_SOURCE_POPOVER, AddSourcePopoverComponent } from './add-source-popover.component';
import { AssetUploadService } from './asset-upload.service';
import { MEDIA_POPOVER, MediaPopoverComponent } from './media-popover.component';
import { sourceRows, type SourceRowView } from './source-rows';
import { dragHasFiles } from './upload-validation';

/**
 * The Sources dock (prototype "selection and source list"): the items of the edit scene front to back, each with the
 * eye toggle, kind icon, slot code, name, state with timer, lamp and lock toggle. Selecting a row selects the item
 * for the monitor and Properties (`EditorService.select`); selecting the selected row again clears the selection
 * (toggle, `aria-pressed`). The header holds undo and "+ Source" (add a source, upload, manage media). Files dropped
 * on the dock are uploaded.
 */
@Component({
  selector: 'sf-sources-dock',
  imports: [
    AddSourcePopoverComponent,
    DockFrameComponent,
    ElapsedComponent,
    IconComponent,
    MediaPopoverComponent,
    PopoverTriggerDirective,
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
    return scene ? sourceRows(scene, this.store.sources(), this.editor.selectedItemId()) : [];
  });
  /** Prototype hint below the rows while nothing is selected. */
  protected readonly hint = computed(() => {
    if (this.editor.selectedItem() || this.editor.editLocked() || this.rows().length === 0) {
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

  /** Selects the row's item; a second click on the selected row clears the selection (back to the scene). */
  protected select(row: SourceRowView, event?: Event): void {
    event?.stopPropagation();
    if (!row.hidden) {
      this.editor.select(row.selected ? null : row.itemId);
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
