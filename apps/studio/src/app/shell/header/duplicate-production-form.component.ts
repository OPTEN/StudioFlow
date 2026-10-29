import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  computed,
  inject,
  input,
  output,
  signal,
  type OnInit,
} from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { t, tm, type Msg } from '@studioflow/i18n';
import { LIMITS, formatBytes, type ProductionDto } from '@studioflow/scene-model';
import { toUserMsg } from '../../core/api/api-error';
import { StudioApiService } from '../../core/api/studio-api.service';
import { focusFirstInvalid } from '../../core/ui/form-feedback';
import { IconComponent } from '../../core/ui/icon.component';
import { ProductionStoreService } from '../../core/state/production-store.service';

/** “Webinar (copy)”, with the name cut so that the whole stays within the limit for names. */
export function defaultCopyName(name: string): string {
  const overhead = t('regie.transfer.duplicate.defaultName', { name: '' }).length;
  const room = Math.max(1, LIMITS.productionNameLength - overhead);
  const shown = name.length > room ? name.slice(0, room).trimEnd() : name;
  return t('regie.transfer.duplicate.defaultName', { name: shown });
}

/**
 * “Duplicate…” on the settings page “All productions” (issue #14): the name of the copy (“Webinar (copy)” to start
 * with) and what is copied, the consequence first: cameras and screens become placeholders. The copy takes over the
 * scenes, texts, media and settings. It is allowed while the broadcast is live (the original is only read) and it never
 * becomes the active production. Copies the active production unless `source` names another one of the list. Reports
 * `done` with the new production (the page announces it) and `cancelled` when the operator backs out.
 */
@Component({
  selector: 'sf-duplicate-production-form',
  imports: [IconComponent, ReactiveFormsModule],
  templateUrl: './duplicate-production-form.component.html',
  styleUrl: './transfer-form.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DuplicateProductionFormComponent implements OnInit {
  private readonly api = inject(StudioApiService);
  private readonly store = inject(ProductionStoreService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  /** The production to copy; null copies the active production. */
  readonly source = input<{ readonly id: string; readonly name: string } | null>(null);
  /** The copy was created. */
  readonly done = output<ProductionDto>();
  /** The operator closed the form without copying anything. */
  readonly cancelled = output();

  protected readonly t = t;
  protected readonly nameMax = LIMITS.productionNameLength;
  protected readonly control = new FormControl(
    defaultCopyName(this.store.production()?.name ?? ''),
    {
      nonNullable: true,
      validators: [
        Validators.required,
        Validators.maxLength(LIMITS.productionNameLength),
        Validators.pattern(/\S/),
      ],
    },
  );
  protected readonly busy = signal(false);
  protected readonly error = signal<Msg | null>(null);
  protected readonly message = computed(() => tm(this.error()) || null);
  /** “3 media files (12.4 MB) are copied.” Only known for the active production (its media are loaded). */
  protected readonly mediaHint = computed(() => {
    const source = this.source();
    if (source && source.id !== this.store.productionId()) {
      return '';
    }
    const assets = [...this.store.assets().values()];
    const bytes = assets.reduce((sum, asset) => sum + asset.sizeBytes, 0);
    return t('regie.transfer.duplicate.media', { count: assets.length, size: formatBytes(bytes) });
  });

  ngOnInit(): void {
    const source = this.source();
    if (source) {
      this.control.reset(defaultCopyName(source.name));
    }
  }

  protected async submit(event: Event): Promise<void> {
    event.preventDefault();
    const productionId = this.source()?.id ?? this.store.productionId();
    const name = this.control.value.trim();
    if (this.busy() || !productionId) {
      return;
    }
    if (this.control.invalid || !name) {
      this.control.markAsTouched();
      focusFirstInvalid(this.host, this.injector);
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      this.done.emit(await this.api.duplicateProduction(productionId, { name }));
    } catch (error) {
      this.error.set(toUserMsg(error));
    } finally {
      this.busy.set(false);
    }
  }
}
