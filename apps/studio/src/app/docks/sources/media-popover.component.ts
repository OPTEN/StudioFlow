import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { t, tm, type Msg } from '@studioflow/i18n';
import { LIMITS, formatBytes, type AssetDto } from '@studioflow/scene-model';
import { StudioApiService } from '../../core/api/studio-api.service';
import { ProductionStoreService } from '../../core/state/production-store.service';
import { ConfirmBoxComponent } from '../../core/ui/confirm-box.component';
import { IconComponent } from '../../core/ui/icon.component';
import { PopoverDirective } from '../../core/ui/popover.directive';
import { ToastService } from '../../core/ui/toast.service';
import { EditorService } from '../../stage/editor.service';
import { DockCommandService } from '../shared/dock-command.service';
import { InlineEditComponent } from '../shared/inline-edit.component';
import { keepInViewport } from '../shared/keep-in-viewport';
import { messageParts } from '../shared/message-parts';
import { AssetUploadService, type UploadEntry } from './asset-upload.service';
import { assetUsage, sortedAssets, usageSentence } from './source-rows';
import { UPLOAD_ACCEPT, dragHasFiles } from './upload-validation';

/** Id of the media popover. */
export const MEDIA_POPOVER = 'media';

/**
 * The media popover of the Sources dock ("Media"): upload images and videos (drag & drop or file dialog, pre-check,
 * progress, cancel, server errors in the active language) and the media of the production, each with a thumbnail,
 * "Add" to the edit scene (or an "In scene" checkmark), rename and delete (behind a confirmation; a medium that is still
 * used says where instead). A finished upload leaves the upload list and shows up highlighted in the library, so every
 * file is listed once.
 */
@Component({
  selector: 'sf-media-popover',
  imports: [ConfirmBoxComponent, IconComponent, InlineEditComponent, PopoverDirective],
  templateUrl: './media-popover.component.html',
  styleUrl: './media-popover.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MediaPopoverComponent {
  /** Open the file dialog right away ("Upload image or video…"). */
  readonly pickOnOpen = input(false);
  /** The file dialog was opened (the dock resets {@link pickOnOpen}). */
  readonly picked = output<void>();

  protected readonly uploads = inject(AssetUploadService);
  protected readonly commands = inject(DockCommandService);
  private readonly store = inject(ProductionStoreService);
  private readonly editor = inject(EditorService);
  private readonly api = inject(StudioApiService);
  private readonly toasts = inject(ToastService);
  private readonly fileInput = viewChild<ElementRef<HTMLInputElement>>('file');

  protected readonly t = t;
  protected readonly tm = tm;
  protected readonly popoverId = MEDIA_POPOVER;
  protected readonly accept = UPLOAD_ACCEPT;
  protected readonly maxNameLength = LIMITS.assetNameLength;
  protected readonly dragOver = signal(false);
  protected readonly rejected = signal<readonly Msg[]>([]);
  protected readonly renamingId = signal<string | null>(null);
  protected readonly confirmingId = signal<string | null>(null);
  /** Media the server (or the local check) reported as still used, with where they are used. */
  protected readonly inUse = signal<ReadonlyMap<string, readonly Msg[]>>(new Map());
  protected readonly assets = computed(() => sortedAssets(this.store.assets()));
  /** Uploads that are waiting, running, failed or cancelled; a finished one is listed in the library instead. */
  protected readonly activeUploads = computed(() =>
    this.uploads.uploads().filter((entry) => entry.state !== 'done'),
  );
  /** Media that were uploaded while the Regie was open (highlighted in the library). */
  protected readonly justUploaded = computed(
    () =>
      new Set(
        this.uploads
          .uploads()
          .flatMap((entry) => (entry.state === 'done' && entry.asset ? [entry.asset.id] : [])),
      ),
  );
  protected readonly sceneName = computed(
    () => this.editor.editScene()?.name ?? t('regie.sources.add.sceneFallback'),
  );
  /** "Drag here or choose a file": the text around the link-like part. */
  protected readonly dropPrompt = computed(() =>
    messageParts((mark) => t('regie.media.upload.prompt', { pick: mark })),
  );

  constructor() {
    const element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    afterNextRender(() => {
      const panel = element.querySelector<HTMLElement>('.c-pop');
      if (panel) {
        keepInViewport(panel, 200);
      }
      if (this.pickOnOpen()) {
        // Still inside the click's user activation, so the browser opens the dialog.
        this.fileInput()?.nativeElement.click();
        this.picked.emit();
      }
    });
  }

  /** Can the medium go into the edit scene right now? */
  protected canAddToScene(asset: AssetDto): boolean {
    return this.editor.canEdit() && !this.inScene(asset);
  }

  /** The medium is already in the edit scene. */
  protected inScene(asset: AssetDto): boolean {
    return this.editor.editScene()?.items.some((item) => item.source === asset.id) ?? false;
  }

  /** A thumbnail that cannot load leaves the dark picture well with the code instead of a broken-image glyph. */
  protected hideBrokenThumb(event: Event): void {
    (event.target as HTMLImageElement).style.visibility = 'hidden';
  }

  protected percent(entry: UploadEntry): number {
    return Math.round((entry.fraction ?? 0) * 100);
  }

  protected sizeText(bytes: number): string {
    return formatBytes(bytes);
  }

  /** "Image · 1920 × 1080 · 1.2 MB" / "Video · 24 MB". */
  protected assetMeta(asset: AssetDto): string {
    const kind = t(asset.kind === 'image' ? 'regie.media.kind.image' : 'regie.media.kind.video');
    const size = asset.width && asset.height ? ` · ${asset.width} × ${asset.height}` : '';
    return `${kind}${size} · ${formatBytes(asset.sizeBytes)}`;
  }

  protected onFiles(event: Event): void {
    const field = event.target as HTMLInputElement;
    this.addFiles(field.files);
    // Lets the same file be chosen again after a failed upload.
    field.value = '';
  }

  protected onDragOver(event: DragEvent): void {
    if (!dragHasFiles(event)) {
      return;
    }
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy';
    }
    this.dragOver.set(true);
  }

  protected onDragLeave(event: DragEvent): void {
    const zone = event.currentTarget as HTMLElement;
    if (!(event.relatedTarget instanceof Node) || !zone.contains(event.relatedTarget)) {
      this.dragOver.set(false);
    }
  }

  protected onDrop(event: DragEvent): void {
    if (!dragHasFiles(event)) {
      return;
    }
    event.preventDefault();
    this.dragOver.set(false);
    this.addFiles(event.dataTransfer?.files ?? null);
  }

  protected addToScene(asset: AssetDto): void {
    this.editor.addSource(asset.id);
  }

  protected startRename(asset: AssetDto): void {
    this.confirmingId.set(null);
    this.renamingId.set(asset.id);
  }

  protected async rename(asset: AssetDto, name: string): Promise<void> {
    this.renamingId.set(null);
    const renamed = await this.commands.run(`asset:${asset.id}:rename`, (productionId) =>
      this.api.renameAsset(productionId, asset.id, { name }),
    );
    if (renamed) {
      this.toasts.show(t('regie.media.toast.renamed', { name: renamed.name }));
    }
  }

  /** Delete: a medium that is visibly still in use explains where; otherwise the confirmation appears. */
  protected askDelete(asset: AssetDto): void {
    this.renamingId.set(null);
    const usage = assetUsage(asset.id, this.store.scenes(), this.store.production());
    if (usage.length > 0) {
      this.markInUse(asset.id, usage);
      return;
    }
    this.clearInUse(asset.id);
    this.confirmingId.set(asset.id);
  }

  protected async remove(asset: AssetDto): Promise<void> {
    const deleted = await this.commands.run(
      `asset:${asset.id}:delete`,
      async (productionId) => {
        await this.api.deleteAsset(productionId, asset.id);
        return true;
      },
      {
        onError: (error) => {
          if (!error.is('asset_in_use')) {
            return false;
          }
          const usage = assetUsage(asset.id, this.store.scenes(), this.store.production());
          this.markInUse(asset.id, usage);
          this.confirmingId.set(null);
          return true;
        },
      },
    );
    if (deleted) {
      this.confirmingId.set(null);
      this.toasts.show(t('regie.media.toast.deleted', { name: asset.name }));
    }
  }

  /** The sentence that says where a medium is still used, or null. */
  protected inUseMessage(assetId: string): string | null {
    const usage = this.inUse().get(assetId);
    return usage ? usageSentence(usage) : null;
  }

  private addFiles(files: FileList | null): void {
    if (!files || files.length === 0) {
      return;
    }
    const result = this.uploads.add(Array.from(files));
    this.rejected.set(result.rejected);
  }

  private markInUse(assetId: string, usage: readonly Msg[]): void {
    const next = new Map(this.inUse());
    next.set(assetId, usage);
    this.inUse.set(next);
  }

  private clearInUse(assetId: string): void {
    if (this.inUse().has(assetId)) {
      const next = new Map(this.inUse());
      next.delete(assetId);
      this.inUse.set(next);
    }
  }
}
