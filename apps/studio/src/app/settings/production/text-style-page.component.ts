import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { t, type PlainMessageKey } from '@studioflow/i18n';
import {
  DEFAULT_TEXT_THEME,
  contrastRatio,
  formatDecimal,
  hasReadableContrast,
  isHexColor,
  type TextThemeDto,
} from '@studioflow/scene-model';
import { StudioApiService } from '../../core/api/studio-api.service';
import { ProductionStoreService } from '../../core/state/production-store.service';
import { IconComponent } from '../../core/ui/icon.component';
import { ToastService } from '../../core/ui/toast.service';
import { SettingsPageHeadComponent } from '../pages/settings-page-head.component';
import { FormActionsComponent } from './form-actions.component';
import { PicturePreviewComponent } from './picture-preview.component';

/** The three colours of the text theme, in the order of the form, with what each one colours. */
const COLOUR_FIELDS = [
  {
    key: 'accent',
    label: 'regie.header.production.textAccent',
    sub: 'regie.production.text.accentSub',
  },
  {
    key: 'background',
    label: 'regie.header.production.textBackground',
    sub: 'regie.production.text.backgroundSub',
  },
  {
    key: 'foreground',
    label: 'regie.header.production.textForeground',
    sub: 'regie.production.text.foregroundSub',
  },
] as const satisfies readonly {
  key: keyof TextThemeDto;
  label: PlainMessageKey;
  sub: PlainMessageKey;
}[];

function colourControl(): FormControl<string> {
  return new FormControl(DEFAULT_TEXT_THEME.accent, {
    nonNullable: true,
    validators: [Validators.required, Validators.pattern(/^#[0-9a-fA-F]{6}$/)],
  });
}

function sameTheme(a: TextThemeDto, b: TextThemeDto): boolean {
  return a.accent === b.accent && a.background === b.background && a.foreground === b.foreground;
}

/**
 * Settings › Production › Text style (`/settings/text-style`): the accent, background and text colour of every lower
 * third, title and note of the production, each as a colour picker and a hex field, with a live picture of the three
 * text styles drawn by the output's renderer. A low contrast is advice in neutral words (it can still be saved);
 * "Use default colours" only fills the fields, saving applies them.
 */
@Component({
  selector: 'sf-text-style-page',
  imports: [
    FormActionsComponent,
    IconComponent,
    PicturePreviewComponent,
    ReactiveFormsModule,
    SettingsPageHeadComponent,
  ],
  templateUrl: './text-style-page.component.html',
  styleUrl: './text-style-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TextStylePageComponent {
  protected readonly store = inject(ProductionStoreService);
  private readonly api = inject(StudioApiService);
  private readonly toasts = inject(ToastService);

  protected readonly t = t;
  protected readonly fields = COLOUR_FIELDS;
  protected readonly saving = signal(false);
  protected readonly form = new FormGroup({
    accent: colourControl(),
    background: colourControl(),
    foreground: colourControl(),
  });
  private readonly value = toSignal(this.form.valueChanges, {
    initialValue: this.form.getRawValue(),
  });
  /** The production whose colours the form was filled with, and those colours. */
  private loadedFor: string | null = null;
  private baseline: TextThemeDto = DEFAULT_TEXT_THEME;
  /** The theme of the last save, until the production in the store has caught up with it. */
  private readonly lastSaved = signal<TextThemeDto | null>(null);

  /** The colours as typed, or null while one of them is not a valid `#rrggbb`. */
  protected readonly edited = computed<TextThemeDto | null>(() => {
    const { accent, background, foreground } = this.value();
    const theme = {
      accent: (accent ?? '').trim().toLowerCase(),
      background: (background ?? '').trim().toLowerCase(),
      foreground: (foreground ?? '').trim().toLowerCase(),
    };
    return Object.values(theme).every((colour) => isHexColor(colour)) ? theme : null;
  });
  /** What the preview draws: the typed colours, or the saved ones while a field is not valid. */
  protected readonly preview = computed(() => this.edited() ?? this.store.textTheme());
  protected readonly dirty = computed(() => {
    const edited = this.edited();
    const saved = this.lastSaved();
    const raw = this.value();
    const current = this.store.textTheme();
    if (!edited) {
      // An invalid field is a change too: it must be fixed or discarded.
      return (
        raw.accent !== current.accent ||
        raw.background !== current.background ||
        raw.foreground !== current.foreground
      );
    }
    return !sameTheme(edited, current) && (saved === null || !sameTheme(edited, saved));
  });
  /** The fields already hold the default colours. */
  protected readonly isDefault = computed(() => {
    const edited = this.edited();
    return edited !== null && sameTheme(edited, DEFAULT_TEXT_THEME);
  });
  /** Contrast of the text on its background ("4,4"), when it is below the readable minimum; else null. */
  protected readonly lowContrast = computed(() => {
    const theme = this.edited();
    if (!theme || hasReadableContrast(theme)) {
      return null;
    }
    // Rounded down, so a ratio just below the minimum never reads "4.5".
    return formatDecimal(Math.floor(contrastRatio(theme.foreground, theme.background) * 10) / 10);
  });

  constructor() {
    // The form starts with the saved colours and follows them while the operator has not changed anything.
    effect(() => {
      const id = this.store.production()?.id ?? null;
      this.store.textTheme();
      untracked(() => {
        const edited = this.edited();
        const untouched = edited !== null && sameTheme(edited, this.baseline);
        if (id !== null && (id !== this.loadedFor || untouched)) {
          this.loadedFor = id;
          this.discard();
        }
      });
    });
  }

  protected invalid(key: keyof TextThemeDto): boolean {
    const control = this.form.controls[key];
    return control.invalid && control.touched;
  }

  /** Sets one colour from the colour picker. */
  protected pick(key: keyof TextThemeDto, value: string): void {
    this.form.controls[key].setValue(value.trim().toLowerCase());
    this.form.controls[key].markAsTouched();
  }

  protected useDefaults(): void {
    this.form.setValue({ ...DEFAULT_TEXT_THEME });
  }

  protected discard(): void {
    this.baseline = this.store.textTheme();
    this.lastSaved.set(null);
    this.form.reset({ ...this.baseline });
  }

  protected async save(event: Event): Promise<void> {
    event.preventDefault();
    const productionId = this.store.productionId();
    const textTheme = this.edited();
    if (!textTheme) {
      this.form.markAllAsTouched();
      return;
    }
    if (!productionId || this.saving() || !this.dirty()) {
      return;
    }
    this.saving.set(true);
    try {
      await this.api.updateProduction(productionId, {
        name: null,
        standbySlate: null,
        endSlate: null,
        textTheme,
      });
      this.lastSaved.set(textTheme);
      this.baseline = textTheme;
      this.toasts.show(t('regie.header.production.textColorsSaved'));
    } catch (error) {
      this.toasts.error(error);
    } finally {
      this.saving.set(false);
    }
  }
}
