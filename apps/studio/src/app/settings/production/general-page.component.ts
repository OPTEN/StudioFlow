import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { t } from '@studioflow/i18n';
import {
  DEFAULT_CANVAS_FORMAT,
  DEFAULT_CANVAS_RESOLUTION,
  LIMITS,
  canvasSize,
  canvasSizeLabel,
  formatRatioLabel,
  type CanvasFormat,
  type CanvasResolution,
} from '@studioflow/scene-model';
import { StudioApiService } from '../../core/api/studio-api.service';
import { ProductionStoreService } from '../../core/state/production-store.service';
import { ConfirmBoxComponent } from '../../core/ui/confirm-box.component';
import { IconComponent } from '../../core/ui/icon.component';
import { ToastService } from '../../core/ui/toast.service';
import { CanvasPickerComponent } from '../../shell/header/canvas-picker.component';
import { SettingsPageHeadComponent } from '../pages/settings-page-head.component';
import { FormActionsComponent } from './form-actions.component';

/** A production name: 1 to 80 characters, not only blanks (the API trims it). */
export function productionNameControl(value = ''): FormControl<string> {
  return new FormControl(value, {
    nonNullable: true,
    validators: [
      Validators.required,
      Validators.maxLength(LIMITS.productionNameLength),
      Validators.pattern(/\S/),
    ],
  });
}

/**
 * Settings › Production › General (`/settings/production`): the name of the active production (renamed in place) and
 * the format and resolution of its output. The canvas is locked while the broadcast is live; another format asks
 * first when scenes have elements, because they are fitted to the new canvas and the undo history is cleared.
 */
@Component({
  selector: 'sf-general-page',
  imports: [
    CanvasPickerComponent,
    ConfirmBoxComponent,
    FormActionsComponent,
    IconComponent,
    ReactiveFormsModule,
    SettingsPageHeadComponent,
  ],
  templateUrl: './general-page.component.html',
  styleUrl: './general-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GeneralPageComponent {
  protected readonly store = inject(ProductionStoreService);
  private readonly api = inject(StudioApiService);
  private readonly toasts = inject(ToastService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  protected readonly t = t;
  protected readonly nameMax = LIMITS.productionNameLength;
  protected readonly live = computed(() => this.store.broadcast() === 'live');

  protected readonly renaming = signal(false);
  protected readonly savingName = signal(false);
  protected readonly nameControl = productionNameControl();

  /** Format and resolution being chosen; they follow the production until the operator changes one. */
  protected readonly format = signal<CanvasFormat>(DEFAULT_CANVAS_FORMAT);
  protected readonly resolution = signal<CanvasResolution>(DEFAULT_CANVAS_RESOLUTION);
  protected readonly savingCanvas = signal(false);
  /** Save was pressed and the operator has to confirm what another format does to the scenes. */
  protected readonly confirming = signal(false);
  /** The canvas of the production, compared by value (other changes of the production do not reset the choice). */
  private readonly savedCanvas = computed(
    () => {
      const canvas = this.store.production()?.canvas;
      return canvas ? { format: canvas.format, resolution: canvas.resolution } : null;
    },
    {
      equal: (a, b) => a?.format === b?.format && a?.resolution === b?.resolution,
    },
  );
  private readonly change = computed(() => {
    const current = this.store.production()?.canvas;
    return {
      format: this.format() !== (current?.format ?? DEFAULT_CANVAS_FORMAT),
      resolution: this.resolution() !== (current?.resolution ?? DEFAULT_CANVAS_RESOLUTION),
    };
  });
  /** The chosen canvas differs from the one of the production. */
  protected readonly canvasChanged = computed(
    () => this.change().format || this.change().resolution,
  );
  /** Only the resolution changes: every element is scaled in proportion. */
  protected readonly resolutionOnly = computed(
    () => this.change().resolution && !this.change().format,
  );
  /** Scenes with elements, which another format fits into the new canvas. */
  protected readonly scenesWithElements = computed(
    () => this.store.scenes().filter((scene) => scene.items.length > 0).length,
  );

  constructor() {
    // The choice starts at the canvas of the production and follows it when it changes elsewhere, unless the
    // operator is in the middle of another choice.
    effect(() => {
      const canvas = this.savedCanvas();
      untracked(() => {
        if (canvas && !this.confirming() && !this.savingCanvas()) {
          this.format.set(canvas.format);
          this.resolution.set(canvas.resolution);
        }
      });
    });
  }

  protected startRename(): void {
    this.nameControl.reset(this.store.production()?.name ?? '');
    this.renaming.set(true);
    afterNextRender(
      () => this.host.nativeElement.querySelector<HTMLInputElement>('#production-name')?.select(),
      { injector: this.injector },
    );
  }

  protected cancelRename(): void {
    this.renaming.set(false);
    afterNextRender(
      () =>
        this.host.nativeElement.querySelector<HTMLButtonElement>('[data-rename]')?.focus(),
      { injector: this.injector },
    );
  }

  protected async rename(event: Event): Promise<void> {
    event.preventDefault();
    const productionId = this.store.productionId();
    const name = this.nameControl.value.trim();
    if (this.nameControl.invalid || !name) {
      this.nameControl.markAsTouched();
      return;
    }
    if (!productionId || this.savingName()) {
      return;
    }
    if (name === this.store.production()?.name) {
      this.cancelRename();
      return;
    }
    this.savingName.set(true);
    try {
      await this.api.updateProduction(productionId, { name, standbySlate: null, endSlate: null });
      this.toasts.show(t('regie.header.production.renamed', { name }));
      this.cancelRename();
    } catch (error) {
      this.toasts.error(error);
    } finally {
      this.savingName.set(false);
    }
  }

  protected setFormat(format: CanvasFormat): void {
    this.format.set(format);
    this.confirming.set(false);
  }

  protected setResolution(resolution: CanvasResolution): void {
    this.resolution.set(resolution);
    this.confirming.set(false);
  }

  protected discardCanvas(): void {
    const canvas = this.store.production()?.canvas;
    this.format.set(canvas?.format ?? DEFAULT_CANVAS_FORMAT);
    this.resolution.set(canvas?.resolution ?? DEFAULT_CANVAS_RESOLUTION);
    this.confirming.set(false);
  }

  /** Save: another format asks first when scenes have elements; a resolution or an empty production does not. */
  protected saveCanvas(event: Event): void {
    event.preventDefault();
    if (this.live() || !this.canvasChanged() || this.savingCanvas()) {
      return;
    }
    if (this.change().format && this.scenesWithElements() > 0) {
      this.confirming.set(true);
      return;
    }
    void this.applyCanvas();
  }

  protected async applyCanvas(): Promise<void> {
    const productionId = this.store.productionId();
    if (!productionId || this.savingCanvas()) {
      return;
    }
    const format = this.format();
    const resolution = this.resolution();
    this.savingCanvas.set(true);
    try {
      await this.api.changeCanvas(productionId, { format, resolution });
      this.confirming.set(false);
      this.toasts.show(
        t('regie.canvas.saved', {
          size: canvasSizeLabel(canvasSize(format, resolution)),
          ratio: formatRatioLabel(format),
        }),
      );
    } catch (error) {
      this.toasts.error(error);
    } finally {
      this.savingCanvas.set(false);
    }
  }
}
