import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { t } from '@studioflow/i18n';
import type { ProductionDto, SlateDto } from '@studioflow/scene-model';
import { StudioApiService } from '../../core/api/studio-api.service';
import { ProductionStoreService } from '../../core/state/production-store.service';
import { focusFirstInvalid } from '../../core/ui/form-feedback';
import { IconComponent } from '../../core/ui/icon.component';
import { ToastService } from '../../core/ui/toast.service';
import { SettingsPageHeadComponent } from '../pages/settings-page-head.component';
import { FormActionsComponent } from './form-actions.component';
import { PicturePreviewComponent } from './picture-preview.component';

/** Longest title and subtitle of a slate (API `SlateRules`). */
export const SLATE_TEXT_MAX = 120;

/** The two slates of a production. */
type SlateKey = 'standby' | 'end';

function slateGroup(): FormGroup<{
  title: FormControl<string>;
  subtitle: FormControl<string>;
  background: FormControl<string>;
}> {
  return new FormGroup({
    title: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(SLATE_TEXT_MAX), Validators.pattern(/\S/)],
    }),
    subtitle: new FormControl('', {
      nonNullable: true,
      validators: [Validators.maxLength(SLATE_TEXT_MAX)],
    }),
    background: new FormControl('', { nonNullable: true }),
  });
}

/** The form value of a slate. */
function slateValue(slate: SlateDto | undefined): { title: string; subtitle: string; background: string } {
  return {
    title: slate?.title ?? '',
    subtitle: slate?.subtitle ?? '',
    background: slate?.backgroundAssetId ?? '',
  };
}

/** The slate the form describes (trimmed, empty subtitle and background as null). */
function toSlate(value: { title?: string; subtitle?: string; background?: string }): SlateDto {
  return {
    title: (value.title ?? '').trim(),
    subtitle: (value.subtitle ?? '').trim() || null,
    backgroundAssetId: value.background || null,
  };
}

function sameSlate(a: SlateDto, b: SlateDto | undefined): boolean {
  return (
    a.title === (b?.title ?? '') &&
    a.subtitle === (b?.subtitle ?? null) &&
    a.backgroundAssetId === (b?.backgroundAssetId ?? null)
  );
}

/**
 * Settings › Production › Slates (`/settings/slates`): what the audience sees before the broadcast (standby slate) and
 * after it (end slate). Each slate has a title, an optional subtitle and an optional background image, and a live
 * picture drawn by the output's own renderer as the operator types. The slate the output shows right now is marked.
 */
@Component({
  selector: 'sf-slates-page',
  imports: [
    FormActionsComponent,
    IconComponent,
    PicturePreviewComponent,
    ReactiveFormsModule,
    SettingsPageHeadComponent,
  ],
  templateUrl: './slates-page.component.html',
  styleUrl: './slates-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SlatesPageComponent {
  protected readonly store = inject(ProductionStoreService);
  private readonly api = inject(StudioApiService);
  private readonly toasts = inject(ToastService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  protected readonly t = t;
  protected readonly textMax = SLATE_TEXT_MAX;
  protected readonly saving = signal(false);
  protected readonly form = new FormGroup({ standby: slateGroup(), end: slateGroup() });
  private readonly value = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });

  /** The slates as typed, for the previews. */
  protected readonly drafts = computed<Record<SlateKey, SlateDto>>(() => {
    const value = this.value();
    return { standby: toSlate(value.standby ?? {}), end: toSlate(value.end ?? {}) };
  });
  /** The slates of the last save, until the production in the store has caught up with them. */
  private readonly lastSaved = signal<Record<SlateKey, SlateDto> | null>(null);
  /** Something differs from the saved slates. */
  protected readonly dirty = computed(() => {
    const production = this.store.production();
    const drafts = this.drafts();
    const saved = this.lastSaved();
    const differs = (base: Record<SlateKey, SlateDto | undefined>): boolean =>
      !sameSlate(drafts.standby, base.standby) || !sameSlate(drafts.end, base.end);
    return (
      !!production &&
      differs({ standby: production.standbySlate, end: production.endSlate }) &&
      (saved === null || differs(saved))
    );
  });
  /** The slate the output shows now: the standby slate before, the end slate after the broadcast. */
  protected readonly showing = computed<SlateKey | null>(() => {
    switch (this.store.broadcast()) {
      case 'standby':
        return 'standby';
      case 'ended':
        return 'end';
      default:
        return null;
    }
  });
  /** Image assets that can sit behind a slate. */
  protected readonly images = computed(() =>
    [...this.store.assets().values()].filter((asset) => asset.kind === 'image'),
  );
  protected readonly slates = [
    {
      key: 'standby',
      title: 'regie.header.production.beforeBroadcast',
      hint: 'regie.production.slates.standbyHint',
    },
    {
      key: 'end',
      title: 'regie.header.production.afterBroadcast',
      hint: 'regie.production.slates.endHint',
    },
  ] as const;

  private loadedFor: ProductionDto | null = null;

  constructor() {
    // The form starts with the saved slates and follows them while the operator has not changed anything.
    effect(() => {
      const production = this.store.production();
      untracked(() => {
        if (production && (this.loadedFor?.id !== production.id || this.untouched())) {
          this.reset(production);
        }
      });
    });
  }

  protected reset(production = this.store.production()): void {
    if (!production) {
      return;
    }
    this.loadedFor = production;
    this.lastSaved.set(null);
    this.form.reset({
      standby: slateValue(production.standbySlate),
      end: slateValue(production.endSlate),
    });
  }

  /** The form still holds the slates it was filled with (or saved last). */
  private untouched(): boolean {
    const drafts = this.drafts();
    const base = this.lastSaved() ?? {
      standby: this.loadedFor?.standbySlate,
      end: this.loadedFor?.endSlate,
    };
    return sameSlate(drafts.standby, base.standby) && sameSlate(drafts.end, base.end);
  }

  protected invalid(key: SlateKey): boolean {
    const control = this.form.controls[key].controls.title;
    return control.invalid && control.touched;
  }

  protected async save(event: Event): Promise<void> {
    event.preventDefault();
    const productionId = this.store.productionId();
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      focusFirstInvalid(this.host, this.injector);
      return;
    }
    if (!productionId || this.saving() || !this.dirty()) {
      return;
    }
    const { standby, end } = this.drafts();
    this.saving.set(true);
    try {
      await this.api.updateProduction(productionId, {
        name: null,
        standbySlate: standby,
        endSlate: end,
      });
      this.lastSaved.set({ standby, end });
      this.form.markAsUntouched();
      this.toasts.show(t('regie.header.production.slatesSaved'));
    } catch (error) {
      this.toasts.error(error);
    } finally {
      this.saving.set(false);
    }
  }
}
