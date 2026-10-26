import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  output,
  signal,
} from '@angular/core';
import { t, tm, type Msg } from '@studioflow/i18n';
import {
  formatBytes,
  formatPercent,
  type ImportPreviewDto,
  type ImportWarningDto,
  type ProductionDto,
} from '@studioflow/scene-model';
import { ApiError, toUserMsg } from '../../core/api/api-error';
import { StudioApiService, type UploadProgress } from '../../core/api/studio-api.service';
import { ToastService } from '../../core/ui/toast.service';

/** Steps of the form. */
type Phase = 'choose' | 'checking' | 'preview' | 'importing';

/** Placeholders listed in the preview; the count tells the rest. */
const MAX_LISTED_PLACEHOLDERS = 8;

/** File types the picker offers; the server decides by the content. */
export const IMPORT_ACCEPT = '.zip,application/zip,application/x-zip-compressed';

/**
 * “Import…” in the production menu (issue #14): choose an exported file (`.studioflow.zip`), see what it contains
 * (name, scenes, texts, media and size, the cameras and screens that become placeholders, warnings) and import it as a
 * new production. Nothing is created before the operator presses “Import”: the first upload is a dry run
 * (`?dryRun=true`) that only reads the file. The imported production does not become the active one. A refused file
 * (not a StudioFlow file, from a newer version, too large, limit of productions) is explained under the button, in the
 * active language. Reports `done` with the new production and `cancelled` when the operator backs out.
 */
@Component({
  selector: 'sf-import-production-form',
  templateUrl: './import-production-form.component.html',
  styleUrl: './transfer-form.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ImportProductionFormComponent {
  private readonly api = inject(StudioApiService);
  private readonly toasts = inject(ToastService);

  /** The production was imported. */
  readonly done = output<ProductionDto>();
  /** The operator closed the form without importing anything. */
  readonly cancelled = output();

  protected readonly t = t;
  protected readonly accept = IMPORT_ACCEPT;
  protected readonly phase = signal<Phase>('choose');
  protected readonly file = signal<File | null>(null);
  protected readonly preview = signal<ImportPreviewDto | null>(null);
  protected readonly error = signal<Msg | null>(null);
  /** Share of the file that is uploaded (0–1), or null while unknown. */
  protected readonly fraction = signal<number | null>(null);
  protected readonly message = computed(() => tm(this.error()) || null);
  protected readonly working = computed(
    () => this.phase() === 'checking' || this.phase() === 'importing',
  );
  protected readonly percent = computed(() => {
    const fraction = this.fraction();
    return fraction === null ? null : formatPercent(Math.round(fraction * 100));
  });
  protected readonly percentValue = computed(() => Math.round((this.fraction() ?? 0) * 100));
  protected readonly percentWidth = computed(() => `${this.percentValue()}%`);

  protected readonly scenesText = computed(() =>
    t('regie.transfer.import.scenes', { count: this.preview()?.scenes ?? 0 }),
  );
  protected readonly textsText = computed(() =>
    t('regie.transfer.import.texts', { count: this.preview()?.texts ?? 0 }),
  );
  protected readonly mediaText = computed(() => {
    const preview = this.preview();
    return t('regie.transfer.import.media', {
      count: preview?.media ?? 0,
      size: formatBytes(preview?.mediaBytes ?? 0),
    });
  });
  protected readonly versionText = computed(() =>
    t('regie.transfer.import.version', { version: this.preview()?.appVersion ?? '' }),
  );
  protected readonly placeholders = computed(() =>
    (this.preview()?.placeholders ?? []).slice(0, MAX_LISTED_PLACEHOLDERS).map((placeholder) => ({
      code: placeholder.code,
      label: placeholder.label ?? t('regie.transfer.import.unnamed'),
    })),
  );
  protected readonly morePlaceholders = computed(() =>
    Math.max(0, (this.preview()?.placeholders.length ?? 0) - MAX_LISTED_PLACEHOLDERS),
  );
  protected readonly warnings = computed(() =>
    (this.preview()?.warnings ?? [])
      .map((warning) => warningText(warning))
      .filter((text): text is string => text !== null),
  );

  private upload: AbortController | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.upload?.abort());
  }

  /** A file was chosen: read it with a dry run and show what it contains. */
  protected async choose(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    // The same file can be chosen again after an error.
    input.value = '';
    if (!file || this.working()) {
      return;
    }
    this.file.set(file);
    this.preview.set(null);
    this.error.set(null);
    this.phase.set('checking');
    const outcome = await this.send(() => this.api.previewImport(file, this.options()));
    if (outcome === undefined) {
      this.phase.set('choose');
      return;
    }
    this.preview.set(outcome);
    this.phase.set('preview');
  }

  /** “Import”: uploads the file again and creates the production. */
  protected async submit(): Promise<void> {
    const file = this.file();
    if (!file || this.phase() !== 'preview') {
      return;
    }
    this.error.set(null);
    this.phase.set('importing');
    const created = await this.send(() => this.api.importProduction(file, this.options()));
    if (created === undefined) {
      this.phase.set('preview');
      return;
    }
    this.toasts.show(t('regie.transfer.import.done', { name: created.name }));
    this.done.emit(created);
  }

  /** Cancel stops an upload that is running; otherwise it closes the form. */
  protected cancel(): void {
    if (this.upload) {
      this.upload.abort();
      return;
    }
    this.cancelled.emit();
  }

  private options(): { onProgress: (progress: UploadProgress) => void; signal: AbortSignal } {
    this.fraction.set(null);
    this.upload = new AbortController();
    return {
      signal: this.upload.signal,
      onProgress: (progress) => this.fraction.set(progress.fraction),
    };
  }

  /** Runs a request; undefined when it failed (the reason is shown) or was cancelled. */
  private async send<T>(request: () => Promise<T>): Promise<T | undefined> {
    try {
      return await request();
    } catch (error) {
      if (!ApiError.from(error).is('aborted')) {
        this.error.set(toUserMsg(error));
      }
      return undefined;
    } finally {
      this.upload = null;
      this.fraction.set(null);
    }
  }
}

/** The text of a warning of the preview; null for a code this version does not know. */
function warningText(warning: ImportWarningDto): string | null {
  switch (warning.code) {
    case 'nameChanged':
      return t('regie.transfer.import.warning.nameChanged', { name: warning.params['name'] ?? '' });
    case 'placeholders':
      return t('regie.transfer.import.warning.placeholders', {
        count: Number(warning.params['count'] ?? 0),
      });
    default:
      return null;
  }
}
