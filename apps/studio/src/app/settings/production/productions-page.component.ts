import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { formatDate, t } from '@studioflow/i18n';
import {
  DEFAULT_CANVAS_FORMAT,
  DEFAULT_CANVAS_RESOLUTION,
  LIMITS,
  type CanvasFormat,
  type CanvasResolution,
  type ProductionDto,
  type ProductionSummaryDto,
} from '@studioflow/scene-model';
import { StudioApiService } from '../../core/api/studio-api.service';
import { ProductionStoreService } from '../../core/state/production-store.service';
import { ConfirmBoxComponent } from '../../core/ui/confirm-box.component';
import { focusFirstInvalid } from '../../core/ui/form-feedback';
import { IconComponent } from '../../core/ui/icon.component';
import { ToastService } from '../../core/ui/toast.service';
import { CanvasPickerComponent } from '../../shell/header/canvas-picker.component';
import { DuplicateProductionFormComponent } from '../../shell/header/duplicate-production-form.component';
import { ImportProductionFormComponent } from '../../shell/header/import-production-form.component';
import { SettingsPageHeadComponent } from '../pages/settings-page-head.component';
import { productionNameControl } from './general-page.component';
import { PRODUCTIONS_FORM_PARAM, type ProductionsForm } from './productions-form';

/**
 * Settings › Production › All productions (`/settings/productions`): the list of productions with the active one marked
 * and a switch for the others (while the broadcast is live it asks first, because this control room then shows the
 * other production); "New production…" with its format, "Import…" with the preview of the file, and "Duplicate…" and
 * "Export" for the active production. A copy or an import is not opened; its toast offers to switch.
 */
@Component({
  selector: 'sf-productions-page',
  imports: [
    CanvasPickerComponent,
    ConfirmBoxComponent,
    DuplicateProductionFormComponent,
    IconComponent,
    ImportProductionFormComponent,
    ReactiveFormsModule,
    SettingsPageHeadComponent,
  ],
  templateUrl: './productions-page.component.html',
  styleUrl: './productions-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProductionsPageComponent {
  protected readonly store = inject(ProductionStoreService);
  private readonly api = inject(StudioApiService);
  private readonly toasts = inject(ToastService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  protected readonly t = t;
  protected readonly nameMax = LIMITS.productionNameLength;
  protected readonly productions = signal<readonly ProductionSummaryDto[] | null>(null);
  protected readonly listError = signal(false);
  protected readonly busy = signal(false);
  /** The production the operator wants to switch to while the broadcast is live (asks first). */
  protected readonly confirmSwitch = signal<ProductionSummaryDto | null>(null);
  protected readonly form = signal<ProductionsForm | null>(null);
  protected readonly live = computed(() => this.store.broadcast() === 'live');
  protected readonly name = computed(() => this.store.production()?.name ?? '');
  /** Download link of the export of the active production (a ZIP file; the browser saves it). */
  protected readonly exportHref = computed(() => {
    const id = this.store.productionId();
    return id ? this.api.exportUrl(id) : null;
  });

  protected readonly createControl = productionNameControl();
  protected readonly newFormat = signal<CanvasFormat>(DEFAULT_CANVAS_FORMAT);
  protected readonly newResolution = signal<CanvasResolution>(DEFAULT_CANVAS_RESOLUTION);

  constructor() {
    void this.load();
    const query = inject(ActivatedRoute).snapshot.queryParamMap.get(PRODUCTIONS_FORM_PARAM);
    if (query === 'new' || query === 'import') {
      this.openForm(query);
    }
  }

  protected created(production: ProductionSummaryDto): string {
    return t('regie.production.state.created', { date: formatDate(new Date(production.createdAt)) });
  }

  protected async load(): Promise<void> {
    this.listError.set(false);
    try {
      this.productions.set(await this.api.listProductions());
    } catch {
      this.listError.set(true);
    }
  }

  protected openForm(form: ProductionsForm): void {
    this.form.set(form);
    if (form === 'new') {
      this.createControl.reset('');
      this.newFormat.set(DEFAULT_CANVAS_FORMAT);
      this.newResolution.set(DEFAULT_CANVAS_RESOLUTION);
    }
    // The first field of the form (or its first button) takes the focus.
    afterNextRender(
      () =>
        this.host.nativeElement
          .querySelector<HTMLElement>(
            `[data-form="${form}"] input:not([type="file"]), [data-form="${form}"] button`,
          )
          ?.focus(),
      { injector: this.injector },
    );
  }

  protected closeForm(): void {
    const form = this.form();
    this.form.set(null);
    afterNextRender(
      () => this.host.nativeElement.querySelector<HTMLElement>(`[data-open="${form}"]`)?.focus(),
      { injector: this.injector },
    );
  }

  /** "Switch to": at once, or after a question while the broadcast is live. */
  protected requestSwitch(production: ProductionSummaryDto): void {
    if (production.isActive) {
      return;
    }
    if (this.live()) {
      this.confirmSwitch.set(production);
      return;
    }
    void this.switchTo(production);
  }

  protected async switchTo(production: { readonly id: string; readonly name: string }): Promise<void> {
    if (this.busy()) {
      return;
    }
    this.busy.set(true);
    try {
      await this.store.switchProduction(production.id);
      this.confirmSwitch.set(null);
      this.toasts.show(t('regie.header.production.switched', { name: production.name }));
      await this.load();
    } catch (error) {
      this.toasts.error(error);
    } finally {
      this.busy.set(false);
    }
  }

  protected async create(event: Event): Promise<void> {
    event.preventDefault();
    const name = this.createControl.value.trim();
    if (this.createControl.invalid || !name) {
      this.createControl.markAsTouched();
      focusFirstInvalid(this.host, this.injector);
      return;
    }
    if (this.busy()) {
      return;
    }
    this.busy.set(true);
    try {
      const created = await this.api.createProduction({
        name,
        format: this.newFormat(),
        resolution: this.newResolution(),
      });
      if (this.live()) {
        this.toasts.show(t('regie.header.production.createdSwitchLater', { name: created.name }));
      } else {
        await this.store.switchProduction(created.id);
        this.toasts.show(t('regie.header.production.created', { name: created.name }));
      }
      this.form.set(null);
      await this.load();
    } catch (error) {
      this.toasts.error(error);
    } finally {
      this.busy.set(false);
    }
  }

  /** A copy or an import was created: it is listed and not active; while not on air the toast offers to switch. */
  protected async added(production: ProductionDto, message: string): Promise<void> {
    this.closeForm();
    if (this.live()) {
      this.toasts.show(message);
    } else {
      this.toasts.show(message, {
        label: t('regie.production.switch.now'),
        run: () => void this.switchTo(production),
      });
    }
    await this.load();
  }

  protected duplicated(production: ProductionDto): Promise<void> {
    return this.added(production, t('regie.transfer.duplicate.done', { name: production.name }));
  }

  protected imported(production: ProductionDto): Promise<void> {
    return this.added(production, t('regie.transfer.import.done', { name: production.name }));
  }

  /** The export was started by the link; the browser downloads the file. */
  protected exported(): void {
    this.toasts.show(t('regie.transfer.export.started', { name: this.name() }));
  }
}
