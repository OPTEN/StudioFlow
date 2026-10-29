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
import { DOCUMENT } from '@angular/common';
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
import {
  ContextMenuDirective,
  ContextMenuService,
  type ContextMenuEntry,
} from '../../core/ui/context-menu';
import { focusFirstInvalid } from '../../core/ui/form-feedback';
import { IconComponent } from '../../core/ui/icon.component';
import { isTypingTarget } from '../../core/ui/keyboard.service';
import { keyHint } from '../../core/ui/shortcuts';
import { ToastService } from '../../core/ui/toast.service';
import { CanvasPickerComponent } from '../../shell/header/canvas-picker.component';
import { DuplicateProductionFormComponent } from '../../shell/header/duplicate-production-form.component';
import { ImportProductionFormComponent } from '../../shell/header/import-production-form.component';
import { SettingsPageHeadComponent } from '../pages/settings-page-head.component';
import { productionNameControl } from './general-page.component';
import { PRODUCTIONS_FORM_PARAM, type ProductionsForm } from './productions-form';
import { moveRowFocus } from './tab-keys';

/** Width of the row menu, to right-align it to the "⋯" button. */
const MENU_WIDTH = 220;

/**
 * Settings › Production › All productions (`/settings/productions`): the list of productions with the active one marked
 * and a switch for the others (while the broadcast is live it asks first, because this control room then shows the
 * other production); "New production…" with its format, "Import…" with the preview of the file, and "Duplicate…" and
 * "Export" for the active production. A copy or an import is not opened; its toast offers to switch. Every row has a
 * right-click menu and a "⋯" button with its commands (switch to, rename, duplicate, export); on a focused row F2
 * renames, Ctrl/Cmd+D duplicates, ↑/↓ move to the neighbouring production. Deleting a production does not exist (the
 * API has no such endpoint).
 */
@Component({
  selector: 'sf-productions-page',
  imports: [
    CanvasPickerComponent,
    ConfirmBoxComponent,
    ContextMenuDirective,
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
  private readonly menus = inject(ContextMenuService);
  private readonly document = inject(DOCUMENT);

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

  /** The production renamed in place in its row. */
  protected readonly renamingId = signal<string | null>(null);
  protected readonly renameControl = productionNameControl();
  /** The production a "Duplicate…" form below its row copies (null: the form of "This production"). */
  protected readonly duplicateSource = signal<ProductionSummaryDto | null>(null);

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
    return t('regie.production.state.created', {
      date: formatDate(new Date(production.createdAt)),
    });
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
    if (form !== 'duplicate') {
      this.duplicateSource.set(null);
    }
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
    const source = this.duplicateSource();
    this.form.set(null);
    this.duplicateSource.set(null);
    // Back to the button that opened the form, or to the "⋯" of the row the copy was made from.
    const selector = source ? `[data-more="${source.id}"]` : `[data-open="${form}"]`;
    afterNextRender(() => this.host.nativeElement.querySelector<HTMLElement>(selector)?.focus(), {
      injector: this.injector,
    });
  }

  /** The commands of a production, for its right-click menu and its "⋯" button. */
  protected readonly menuOf =
    (production: ProductionSummaryDto) => (): readonly ContextMenuEntry[] => {
      const online = this.store.canCommand();
      return [
        {
          label: t('regie.production.switch.to'),
          icon: 'play',
          checked: production.isActive,
          disabled: production.isActive || !online || this.busy(),
          run: () => this.requestSwitch(production),
        },
        'separator',
        {
          label: t('regie.production.menu.rename'),
          icon: 'pencil',
          shortcut: 'F2',
          disabled: !online,
          run: () => this.startRename(production),
        },
        {
          label: t('regie.transfer.duplicate.open'),
          icon: 'copy',
          shortcut: keyHint('mod', 'D'),
          disabled: !online,
          run: () => this.startDuplicate(production),
        },
        {
          label: t('regie.transfer.menu.export'),
          icon: 'download',
          run: () => this.exportProduction(production),
        },
      ];
    };

  /** "⋯": the same menu, below the button and right-aligned to it. */
  protected openMenuAt(event: MouseEvent, production: ProductionSummaryDto): void {
    const button = event.currentTarget as HTMLElement;
    const rect = button.getBoundingClientRect();
    this.menus.open(
      this.menuOf(production)(),
      { x: Math.max(8, rect.right - MENU_WIDTH), y: rect.bottom + 4 },
      { label: production.name, returnFocus: button },
    );
  }

  /** F2 renames, Ctrl/Cmd+D duplicates, ↑/↓ move between the productions. */
  protected onRowKeyDown(event: KeyboardEvent, production: ProductionSummaryDto): void {
    if (isTypingTarget(event.target as Element)) {
      return;
    }
    if (moveRowFocus(event, '.c-prods__row', '[data-more]')) {
      return;
    }
    const mod = event.ctrlKey || event.metaKey;
    if (mod && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'd') {
      // Always prevented: Ctrl+D would bookmark the page.
      event.preventDefault();
      if (this.store.canCommand()) {
        this.startDuplicate(production);
      }
      return;
    }
    if (!mod && !event.altKey && !event.shiftKey && event.key === 'F2') {
      event.preventDefault();
      if (this.store.canCommand()) {
        this.startRename(production);
      }
    }
  }

  protected startRename(production: ProductionSummaryDto): void {
    this.renameControl.reset(production.name);
    this.renamingId.set(production.id);
    afterNextRender(
      () =>
        this.host.nativeElement.querySelector<HTMLInputElement>('[data-rename-input]')?.select(),
      { injector: this.injector },
    );
  }

  protected cancelRename(): void {
    const id = this.renamingId();
    this.renamingId.set(null);
    afterNextRender(
      () => this.host.nativeElement.querySelector<HTMLElement>(`[data-more="${id}"]`)?.focus(),
      { injector: this.injector },
    );
  }

  protected async rename(event: Event, production: ProductionSummaryDto): Promise<void> {
    event.preventDefault();
    const name = this.renameControl.value.trim();
    if (this.renameControl.invalid || !name) {
      this.renameControl.markAsTouched();
      return;
    }
    if (name === production.name) {
      this.cancelRename();
      return;
    }
    if (this.busy()) {
      return;
    }
    this.busy.set(true);
    try {
      await this.api.updateProduction(production.id, {
        name,
        standbySlate: null,
        endSlate: null,
      });
      this.toasts.show(t('regie.header.production.renamed', { name }));
      this.cancelRename();
      await this.load();
    } catch (error) {
      this.toasts.error(error);
    } finally {
      this.busy.set(false);
    }
  }

  /** "Duplicate…": the form of "This production" for the active one, else a form below the row. */
  protected startDuplicate(production: ProductionSummaryDto): void {
    this.openForm('duplicate');
    this.duplicateSource.set(production.isActive ? null : production);
  }

  /** "Export" of any production: the browser downloads the ZIP file. */
  protected exportProduction(production: ProductionSummaryDto): void {
    const anchor = this.document.createElement('a');
    anchor.href = this.api.exportUrl(production.id);
    anchor.download = '';
    anchor.click();
    this.toasts.show(t('regie.transfer.export.started', { name: production.name }));
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

  protected async switchTo(production: {
    readonly id: string;
    readonly name: string;
  }): Promise<void> {
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
