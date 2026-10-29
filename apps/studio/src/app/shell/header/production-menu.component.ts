import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { formatDate, t } from '@studioflow/i18n';
import type { ProductionSummaryDto } from '@studioflow/scene-model';
import { StudioApiService } from '../../core/api/studio-api.service';
import { ProductionStoreService } from '../../core/state/production-store.service';
import { ConfirmBoxComponent } from '../../core/ui/confirm-box.component';
import { ContextMenuDirective, type ContextMenuEntry } from '../../core/ui/context-menu';
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
 * "Production settings…". Everything that configures the production lives in the settings window. A right click on a
 * production offers "Switch to" and "Production settings…" (the active one) or "All productions…" (another one).
 */
@Component({
  selector: 'sf-production-menu',
  imports: [
    ConfirmBoxComponent,
    ContextMenuDirective,
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
  private readonly router = inject(Router);

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
  /** A switch asked for in the right-click menu while live: the question shows when the menu opens again. */
  private pendingConfirm: ProductionSummaryDto | null = null;
  protected readonly name = computed(() => this.store.production()?.name ?? 'StudioFlow');
  protected readonly live = computed(() => this.store.broadcast() === 'live');

  constructor() {
    // Every opening starts at the list and refreshes it.
    effect(() => {
      if (this.popovers.isOpen(this.popoverId)) {
        untracked(() => {
          this.confirming.set(this.pendingConfirm);
          this.pendingConfirm = null;
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

  /** The right-click menu of a production in the list; every command is also a row or a link of the menu. */
  protected readonly menuOf =
    (production: ProductionSummaryDto) => (): readonly ContextMenuEntry[] => [
      {
        label: t('regie.production.switch.to'),
        icon: 'play',
        checked: production.isActive,
        disabled: production.isActive || this.busy() || !this.store.canCommand(),
        run: () => this.chooseFromMenu(production),
      },
      'separator',
      production.isActive
        ? {
            label: t('regie.production.switcher.settings'),
            icon: 'sliders',
            run: () => this.openSettings('/settings/production'),
          }
        : {
            label: t('regie.production.menu.all'),
            icon: 'stack',
            run: () => this.openSettings('/settings/productions'),
          },
    ];

  /** The click on the right-click menu closed the switcher; a question while live opens it again. */
  private chooseFromMenu(production: ProductionSummaryDto): void {
    if (!production.isActive && this.live()) {
      this.pendingConfirm = production;
      this.popovers.open(this.popoverId);
      return;
    }
    this.choose(production);
  }

  private openSettings(url: string): void {
    this.close();
    void this.router.navigateByUrl(url);
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
