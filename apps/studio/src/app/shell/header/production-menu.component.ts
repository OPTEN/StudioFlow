import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { formatDate, t } from '@studioflow/i18n';
import type { ProductionSummaryDto } from '@studioflow/scene-model';
import { StudioApiService } from '../../core/api/studio-api.service';
import { ProductionStoreService } from '../../core/state/production-store.service';
import { ConfirmBoxComponent } from '../../core/ui/confirm-box.component';
import { IconComponent } from '../../core/ui/icon.component';
import {
  PopoverDirective,
  PopoverService,
  PopoverTriggerDirective,
} from '../../core/ui/popover.directive';
import { ToastService } from '../../core/ui/toast.service';
import { PRODUCTIONS_FORM_PARAM } from '../../settings/production/productions-form';

/** Id of the production switcher popover. */
export const PRODUCTION_POPOVER = 'production';

/**
 * The production title in the toolbar and its switcher (spec 9.1, DESIGN.md "Toolbar"): the productions with a check
 * on the active one (switching while the broadcast is live asks first, because this control room then shows the other
 * production), "New production…" and "Import…" (both open the form on the settings page "All productions") and
 * "Production settings…". Everything that configures the production lives in the settings window.
 */
@Component({
  selector: 'sf-production-menu',
  imports: [
    ConfirmBoxComponent,
    IconComponent,
    PopoverDirective,
    PopoverTriggerDirective,
    RouterLink,
  ],
  templateUrl: './production-menu.component.html',
  styleUrl: './production-menu.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProductionMenuComponent {
  protected readonly store = inject(ProductionStoreService);
  protected readonly popovers = inject(PopoverService);
  private readonly api = inject(StudioApiService);
  private readonly toasts = inject(ToastService);

  protected readonly popoverId = PRODUCTION_POPOVER;
  /** Queries of the links that open a form on the page "All productions". */
  protected readonly newQuery = { [PRODUCTIONS_FORM_PARAM]: 'new' };
  protected readonly importQuery = { [PRODUCTIONS_FORM_PARAM]: 'import' };
  protected readonly t = t;
  protected readonly busy = signal(false);
  protected readonly productions = signal<readonly ProductionSummaryDto[] | null>(null);
  protected readonly listError = signal(false);
  /** The production the operator wants to switch to while the broadcast is live (asks first). */
  protected readonly confirming = signal<ProductionSummaryDto | null>(null);
  protected readonly name = computed(() => this.store.production()?.name ?? 'StudioFlow');
  protected readonly live = computed(() => this.store.broadcast() === 'live');

  constructor() {
    // Every opening starts at the list and refreshes it.
    effect(() => {
      if (this.popovers.isOpen(this.popoverId)) {
        untracked(() => {
          this.confirming.set(null);
          void this.loadProductions();
        });
      }
    });
  }

  protected created(production: ProductionSummaryDto): string {
    return formatDate(new Date(production.createdAt));
  }

  /** A production of the list: the active one only closes the menu; another one switches (asking first while live). */
  protected choose(production: ProductionSummaryDto): void {
    if (production.isActive) {
      this.close();
      return;
    }
    if (this.live()) {
      this.confirming.set(production);
      return;
    }
    void this.switchTo(production);
  }

  protected async switchTo(production: ProductionSummaryDto): Promise<void> {
    if (this.busy()) {
      return;
    }
    this.busy.set(true);
    try {
      await this.store.switchProduction(production.id);
      this.toasts.show(t('regie.header.production.switched', { name: production.name }));
      this.close();
    } catch (error) {
      this.toasts.error(error);
    } finally {
      this.busy.set(false);
    }
  }

  /** Closes the menu (also before a link leads to the settings window, so it is closed on the way back). */
  protected close(): void {
    this.popovers.close(this.popoverId);
  }

  private async loadProductions(): Promise<void> {
    this.listError.set(false);
    try {
      this.productions.set(await this.api.listProductions());
    } catch {
      this.listError.set(true);
    }
  }
}
