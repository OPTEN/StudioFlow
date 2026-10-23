import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { formatBytes, type AssetDto } from '@studioflow/scene-model';
import { ApiError, toUserMessage } from '../../core/api/api-error';
import { StudioApiService } from '../../core/api/studio-api.service';
import { AuthService } from '../../core/auth/auth.service';
import { ProductionStoreService } from '../../core/state/production-store.service';
import { ToastService } from '../../core/ui/toast.service';
import { EditorService } from '../../stage/editor.service';
import { validateUpload, type UploadKind } from './upload-validation';

/** Lifecycle of one upload. */
export type UploadState = 'queued' | 'uploading' | 'done' | 'failed' | 'aborted';

/** One file in the upload list. */
export interface UploadEntry {
  readonly id: number;
  readonly name: string;
  readonly size: number;
  readonly kind: UploadKind;
  readonly state: UploadState;
  /** 0–1 while uploading; null when the browser does not know the total. */
  readonly fraction: number | null;
  /** German error text of a failed upload. */
  readonly error: string | null;
  /** The created asset once done. */
  readonly asset: AssetDto | null;
}

/** Result of {@link AssetUploadService.add}. */
export interface AddFilesResult {
  /** Files that passed the pre-check and were queued. */
  readonly accepted: number;
  /** German messages for files that were rejected before uploading. */
  readonly rejected: readonly string[];
}

interface QueuedFile {
  readonly id: number;
  readonly file: File;
  readonly productionId: string;
}

/**
 * Uploads of images and videos (spec 4.7, prototype «Quelle hinzufügen»): checks type and size before the request
 * (PNG, JPEG, WebP ≤ 25 MB; MP4, WebM ≤ 1 GB), uploads one file after the other with progress, can cancel, and turns
 * server errors (415 type, 413 size) into German messages. When a file is done, the toast offers to add it to the
 * edit scene («Zur Szene hinzufügen»).
 *
 * Lives at root, so an upload keeps running when the media popover closes or the dock moves. Signing out cancels
 * every upload. The upload bypasses the HTTP interceptors (XMLHttpRequest for the progress), so a 401 is handled here
 * like the auth interceptor does: back to the login page (which also cancels the queue).
 */
@Injectable({ providedIn: 'root' })
export class AssetUploadService {
  private readonly api = inject(StudioApiService);
  private readonly store = inject(ProductionStoreService);
  private readonly editor = inject(EditorService);
  private readonly toasts = inject(ToastService);
  private readonly auth = inject(AuthService);

  private readonly entriesSignal = signal<readonly UploadEntry[]>([]);
  private readonly queue: QueuedFile[] = [];
  private readonly controllers = new Map<number, AbortController>();
  private nextId = 1;
  private running = false;

  /** Every upload of this session, oldest first, until dismissed. */
  readonly uploads = this.entriesSignal.asReadonly();
  /** Number of queued or running uploads. */
  readonly activeCount = computed(
    () =>
      this.entriesSignal().filter(
        (entry) => entry.state === 'queued' || entry.state === 'uploading',
      ).length,
  );

  constructor() {
    const unregister = this.auth.onSignedOut(() => this.cancelAll());
    inject(DestroyRef).onDestroy(() => {
      unregister();
      this.cancelAll();
    });
  }

  /** Checks and queues files; rejected files are reported, not queued. */
  add(files: Iterable<File>): AddFilesResult {
    const productionId = this.store.productionId();
    const rejected: string[] = [];
    let accepted = 0;
    for (const file of files) {
      const check = validateUpload(file);
      if (!check.ok) {
        rejected.push(check.message);
        continue;
      }
      if (!productionId) {
        rejected.push(
          `«${file.name}»: Keine Verbindung zum Server. Bitte gleich nochmals versuchen.`,
        );
        continue;
      }
      const id = this.nextId++;
      this.queue.push({ id, file, productionId });
      this.entriesSignal.update((entries) => [
        ...entries,
        {
          id,
          name: file.name,
          size: file.size,
          kind: check.kind,
          state: 'queued',
          fraction: 0,
          error: null,
          asset: null,
        },
      ]);
      accepted += 1;
    }
    void this.pump();
    return { accepted, rejected };
  }

  /** Cancels a queued or running upload. */
  cancel(id: number): void {
    const index = this.queue.findIndex((entry) => entry.id === id);
    if (index >= 0) {
      this.queue.splice(index, 1);
      this.patch(id, { state: 'aborted', error: null });
      return;
    }
    this.controllers.get(id)?.abort();
  }

  /** Removes a finished entry (done, failed, aborted) from the list. */
  dismiss(id: number): void {
    this.entriesSignal.update((entries) =>
      entries.filter(
        (entry) => entry.id !== id || entry.state === 'queued' || entry.state === 'uploading',
      ),
    );
  }

  /** Cancels everything (sign-out). */
  cancelAll(): void {
    for (const entry of [...this.queue]) {
      this.patch(entry.id, { state: 'aborted' });
    }
    this.queue.length = 0;
    for (const controller of this.controllers.values()) {
      controller.abort();
    }
  }

  /** Size text of an entry, e.g. «12,4 MB». */
  sizeText(entry: Pick<UploadEntry, 'size'>): string {
    return formatBytes(entry.size);
  }

  private async pump(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      for (let next = this.queue.shift(); next; next = this.queue.shift()) {
        await this.upload(next);
      }
    } finally {
      this.running = false;
    }
  }

  private async upload(item: QueuedFile): Promise<void> {
    const controller = new AbortController();
    this.controllers.set(item.id, controller);
    this.patch(item.id, { state: 'uploading', fraction: 0 });
    let shown: number | null = 0;
    try {
      const asset = await this.api.uploadAsset(item.productionId, item.file, {
        signal: controller.signal,
        // Progress events come many times per second: re-render only for whole percents.
        onProgress: ({ fraction }) => {
          const rounded = fraction === null ? null : Math.floor(fraction * 100) / 100;
          if (rounded !== shown) {
            shown = rounded;
            this.patch(item.id, { fraction: rounded });
          }
        },
      });
      this.patch(item.id, { state: 'done', fraction: 1, asset });
      this.announce(asset);
    } catch (error) {
      const apiError = ApiError.from(error);
      if (apiError.status === 401) {
        this.patch(item.id, { state: 'failed', error: toUserMessage(apiError) });
        this.auth.handleUnauthorized();
      } else if (apiError.is('aborted')) {
        this.patch(item.id, { state: 'aborted', error: null });
        this.toasts.show(`Hochladen von «${item.file.name}» abgebrochen`);
      } else {
        const message = toUserMessage(apiError);
        this.patch(item.id, { state: 'failed', error: message });
        this.toasts.show(`«${item.file.name}» wurde nicht hochgeladen: ${message}`);
      }
    } finally {
      this.controllers.delete(item.id);
    }
  }

  /** Toast for a finished upload, with «Zur Szene hinzufügen» when the edit scene can take it. */
  private announce(asset: AssetDto): void {
    const scene = this.editor.editScene();
    const message = `«${asset.name}» ist hochgeladen und steht als ${asset.code} bereit`;
    if (!scene || !this.editor.canEdit()) {
      this.toasts.show(message);
      return;
    }
    this.toasts.show(message, {
      label: 'Zur Szene hinzufügen',
      run: () => {
        if (!this.editor.editScene()?.items.some((item) => item.source === asset.id)) {
          this.editor.addSource(asset.id);
        }
      },
    });
  }

  private patch(id: number, changes: Partial<UploadEntry>): void {
    this.entriesSignal.update((entries) =>
      entries.map((entry) => (entry.id === id ? { ...entry, ...changes } : entry)),
    );
  }
}
