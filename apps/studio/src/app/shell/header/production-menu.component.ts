import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { LIMITS, type ProductionSummaryDto, type SlateDto } from '@flowstudio/scene-model';
import { toGermanMessage } from '../../core/api/api-error';
import { StudioApiService } from '../../core/api/studio-api.service';
import { AuthService } from '../../core/auth/auth.service';
import { ProductionStoreService } from '../../core/state/production-store.service';
import { IconComponent } from '../../core/ui/icon.component';
import {
  PopoverDirective,
  PopoverService,
  PopoverTriggerDirective,
} from '../../core/ui/popover.directive';
import { ToastService } from '../../core/ui/toast.service';

/** Id of the production menu popover. */
export const PRODUCTION_POPOVER = 'production';

/** Views of the production menu. */
type MenuMode = 'menu' | 'rename' | 'slates' | 'create';

function nameControl(): FormControl<string> {
  return new FormControl('', {
    nonNullable: true,
    validators: [
      Validators.required,
      Validators.maxLength(LIMITS.productionNameLength),
      Validators.pattern(/\S/),
    ],
  });
}

function textControl(required: boolean): FormControl<string> {
  return new FormControl('', {
    nonNullable: true,
    validators: required
      ? [Validators.required, Validators.maxLength(120), Validators.pattern(/\S/)]
      : [Validators.maxLength(120)],
  });
}

/**
 * The production name in the header and its menu (spec 9.1): rename, edit the standby and end slates, switch to or
 * create another production (not while the broadcast is live) and sign out. Typed reactive forms for every input.
 */
@Component({
  selector: 'fs-production-menu',
  imports: [IconComponent, PopoverDirective, PopoverTriggerDirective, ReactiveFormsModule],
  templateUrl: './production-menu.component.html',
  styleUrl: './production-menu.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProductionMenuComponent {
  protected readonly store = inject(ProductionStoreService);
  protected readonly popovers = inject(PopoverService);
  private readonly api = inject(StudioApiService);
  private readonly auth = inject(AuthService);
  private readonly toasts = inject(ToastService);

  protected readonly popoverId = PRODUCTION_POPOVER;
  protected readonly mode = signal<MenuMode>('menu');
  protected readonly busy = signal(false);
  protected readonly productions = signal<readonly ProductionSummaryDto[] | null>(null);
  protected readonly listError = signal(false);
  protected readonly name = computed(() => this.store.production()?.name ?? 'FlowStudio');
  protected readonly live = computed(() => this.store.broadcast() === 'live');

  protected readonly renameControl = nameControl();
  protected readonly createControl = nameControl();
  protected readonly slatesForm = new FormGroup({
    standbyTitle: textControl(true),
    standbySubtitle: textControl(false),
    standbyBackground: new FormControl('', { nonNullable: true }),
    endTitle: textControl(true),
    endSubtitle: textControl(false),
    endBackground: new FormControl('', { nonNullable: true }),
  });
  /** Image assets that can sit behind a slate. */
  protected readonly imageAssets = computed(() =>
    [...this.store.assets().values()].filter((asset) => asset.kind === 'image'),
  );

  constructor() {
    // Every opening starts at the menu and refreshes the production list.
    effect(() => {
      if (this.popovers.isOpen(this.popoverId)) {
        untracked(() => {
          this.mode.set('menu');
          void this.loadProductions();
        });
      }
    });
  }

  protected show(mode: MenuMode): void {
    const production = this.store.production();
    if (mode === 'rename') {
      this.renameControl.reset(production?.name ?? '');
    } else if (mode === 'create') {
      this.createControl.reset('');
    } else if (mode === 'slates' && production) {
      this.slatesForm.reset({
        standbyTitle: production.standbySlate.title,
        standbySubtitle: production.standbySlate.subtitle ?? '',
        standbyBackground: production.standbySlate.backgroundAssetId ?? '',
        endTitle: production.endSlate.title,
        endSubtitle: production.endSlate.subtitle ?? '',
        endBackground: production.endSlate.backgroundAssetId ?? '',
      });
    }
    this.mode.set(mode);
  }

  protected async rename(event: Event): Promise<void> {
    event.preventDefault();
    const name = this.renameControl.value.trim();
    if (this.renameControl.invalid || !name) {
      this.renameControl.markAsTouched();
      return;
    }
    await this.run(async (id) => {
      await this.api.updateProduction(id, { name, standbySlate: null, endSlate: null });
      this.toasts.show(`Produktion heisst jetzt «${name}»`);
      this.mode.set('menu');
    });
  }

  protected async saveSlates(event: Event): Promise<void> {
    event.preventDefault();
    const production = this.store.production();
    if (this.slatesForm.invalid || !production) {
      this.slatesForm.markAllAsTouched();
      return;
    }
    const value = this.slatesForm.getRawValue();
    const slate = (title: string, subtitle: string, background: string): SlateDto => ({
      title: title.trim(),
      subtitle: subtitle.trim() || null,
      backgroundAssetId: background || null,
    });
    await this.run(async (id) => {
      await this.api.updateProduction(id, {
        name: null,
        standbySlate: slate(value.standbyTitle, value.standbySubtitle, value.standbyBackground),
        endSlate: slate(value.endTitle, value.endSubtitle, value.endBackground),
      });
      this.toasts.show('Slates gespeichert');
      this.mode.set('menu');
    });
  }

  protected async create(event: Event): Promise<void> {
    event.preventDefault();
    const name = this.createControl.value.trim();
    if (this.createControl.invalid || !name) {
      this.createControl.markAsTouched();
      return;
    }
    await this.run(async () => {
      const created = await this.api.createProduction({ name });
      if (this.live()) {
        this.toasts.show(`Produktion «${created.name}» erstellt. Wechseln geht nach der Sendung.`);
      } else {
        await this.store.switchProduction(created.id);
        this.toasts.show(`Produktion «${created.name}» erstellt und aktiv`);
      }
      this.popovers.close(this.popoverId);
    });
  }

  protected async switchTo(production: ProductionSummaryDto): Promise<void> {
    if (production.isActive || this.live()) {
      return;
    }
    await this.run(async () => {
      await this.store.switchProduction(production.id);
      this.toasts.show(`Gewechselt zu «${production.name}»`);
      this.popovers.close(this.popoverId);
    });
  }

  protected logout(): void {
    this.popovers.close(this.popoverId);
    // A refused logout keeps the session (see AuthService.logout): say so instead of pretending.
    this.auth
      .logout()
      .catch((error: unknown) =>
        this.toasts.show(`Abmelden hat nicht geklappt. ${toGermanMessage(error)}`),
      );
  }

  private async loadProductions(): Promise<void> {
    this.listError.set(false);
    try {
      this.productions.set(await this.api.listProductions());
    } catch {
      this.listError.set(true);
    }
  }

  private async run(action: (productionId: string) => Promise<void>): Promise<void> {
    const productionId = this.store.productionId();
    if (!productionId || this.busy()) {
      return;
    }
    this.busy.set(true);
    try {
      await action(productionId);
    } catch (error) {
      this.toasts.error(error);
    } finally {
      this.busy.set(false);
    }
  }
}
