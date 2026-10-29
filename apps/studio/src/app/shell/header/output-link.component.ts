import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import {
  FormControl,
  ReactiveFormsModule,
  Validators,
  type AbstractControl,
  type ValidationErrors,
} from '@angular/forms';
import { LOCALES, SUPPORTED_LOCALES, t } from '@studioflow/i18n';
import type { OutputLinkDto } from '@studioflow/scene-model';
import { StudioApiService } from '../../core/api/studio-api.service';
import { ProductionStoreService } from '../../core/state/production-store.service';
import { ClipboardService } from '../../core/ui/clipboard.service';
import { ConfirmBoxComponent } from '../../core/ui/confirm-box.component';
import { IconComponent } from '../../core/ui/icon.component';
import { ToastService } from '../../core/ui/toast.service';
import { FormActionsComponent } from '../../settings/production/form-actions.component';
import { isIpOrCidr, normalizeIp } from './ip-address';
import { OutputCameraComponent } from './output-camera.component';
import {
  DEFAULT_LINK_OPTIONS,
  maskOutputUrl,
  outputLinkUrl,
  type OutputLinkOptions,
} from './output-url';

// The URL helpers have their own module (the output popover uses them without this component).
export { maskOutputUrl, outputLinkUrl } from './output-url';

/** Longest link name the API accepts. */
export const LINK_NAME_MAX = 40;

/** A name is required without its surrounding blanks (the API trims it). */
export function requiredName(control: AbstractControl<string>): ValidationErrors | null {
  return control.value.trim() ? null : { required: true };
}

function ipValidator(control: AbstractControl<string>): ValidationErrors | null {
  const value = control.value.trim();
  return !value || isIpOrCidr(value) ? null : { ip: true };
}

let nextId = 0;

/**
 * One output link on the settings page "Output links" (spec 9.1), shown below its row: the name (renamed in place),
 * the secret URL (masked, "Show link" reveals it; copy with selection fallback) with its display options, the IP
 * restriction (edited as a draft, saved with "Save access"), "Use as camera in OBS", "New link" and "Revoke link"
 * behind confirmations that name the consequence. Every change goes to the API; the page gets the changed link back.
 */
@Component({
  selector: 'sf-output-link',
  imports: [
    ConfirmBoxComponent,
    FormActionsComponent,
    IconComponent,
    OutputCameraComponent,
    ReactiveFormsModule,
  ],
  templateUrl: './output-link.component.html',
  styleUrl: './output-link.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OutputLinkComponent {
  private readonly api = inject(StudioApiService);
  private readonly store = inject(ProductionStoreService);
  private readonly clipboard = inject(ClipboardService);
  private readonly toasts = inject(ToastService);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly urlElement = viewChild<ElementRef<HTMLElement>>('url');

  /** The link; the page keeps this component while the link stays in the list. */
  readonly link = input.required<OutputLinkDto>();
  /** The link changed on the server (renamed, new key, new IP restriction). */
  readonly updated = output<OutputLinkDto>();
  /** The link was revoked. */
  readonly revoked = output<string>();

  protected readonly t = t;
  protected readonly nameMax = LINK_NAME_MAX;
  protected readonly languages = SUPPORTED_LOCALES.map((tag) => ({
    tag,
    name: LOCALES[tag].nativeName,
  }));
  protected readonly id = `sf-output-link-${++nextId}`;
  protected readonly revealed = signal(false);
  protected readonly confirming = signal<'renew' | 'revoke' | null>(null);
  protected readonly busy = signal(false);
  protected readonly cameraOpen = signal(false);
  protected readonly optionsOpen = signal(false);
  protected readonly options = signal<OutputLinkOptions>(DEFAULT_LINK_OPTIONS);
  protected readonly renaming = signal(false);
  protected readonly savingIps = signal(false);
  /** Edited IP list; null while unchanged (the server list is shown). */
  protected readonly draftIps = signal<readonly string[] | null>(null);
  protected readonly ipControl = new FormControl('', {
    nonNullable: true,
    validators: [ipValidator, Validators.maxLength(64)],
  });
  protected readonly nameControl = new FormControl('', {
    nonNullable: true,
    validators: [requiredName, Validators.maxLength(LINK_NAME_MAX)],
  });

  protected readonly ips = computed(() => this.draftIps() ?? this.link().allowedIps);
  protected readonly ipsDirty = computed(() => {
    const draft = this.draftIps();
    const saved = this.link().allowedIps;
    return draft !== null && (draft.length !== saved.length || draft.some((ip, i) => ip !== saved[i]));
  });
  /** The URL with the chosen display options (what "Copy" copies). */
  protected readonly url = computed(() => outputLinkUrl(this.link().url, this.options()));
  protected readonly displayUrl = computed(() =>
    this.revealed() ? this.url() : maskOutputUrl(this.url()),
  );

  protected setOption<K extends keyof OutputLinkOptions>(key: K, value: OutputLinkOptions[K]): void {
    this.options.update((options) => ({ ...options, [key]: value }));
  }

  protected async copy(): Promise<void> {
    const url = this.url();
    const copied = await this.clipboard.copy(url, { label: maskOutputUrl(url) });
    if (!copied) {
      // Fallback: show the real link and select it, so Ctrl+C copies the working URL.
      this.revealed.set(true);
      afterNextRender(
        () => this.clipboard.selectContents(this.urlElement()?.nativeElement ?? null),
        { injector: this.injector },
      );
    }
  }

  protected startRename(): void {
    this.nameControl.reset(this.link().name);
    this.renaming.set(true);
    this.focus('[data-name-input]');
  }

  protected cancelRename(): void {
    this.renaming.set(false);
    this.focus('[data-rename]');
  }

  protected async rename(event: Event): Promise<void> {
    event.preventDefault();
    const name = this.nameControl.value.trim();
    if (!name || this.nameControl.invalid) {
      this.nameControl.markAsTouched();
      return;
    }
    if (name === this.link().name) {
      this.cancelRename();
      return;
    }
    await this.run(async (productionId) => {
      const renamed = await this.api.renameOutputLink(productionId, this.link().id, { name });
      this.updated.emit(renamed);
      this.cancelRename();
      this.toasts.show(t('regie.output.link.renamed', { name: renamed.name }));
    });
  }

  protected addIp(event?: Event): void {
    event?.preventDefault();
    const value = normalizeIp(this.ipControl.value);
    if (!value || this.ipControl.invalid) {
      this.ipControl.markAsTouched();
      return;
    }
    if (!this.ips().includes(value)) {
      this.draftIps.set([...this.ips(), value]);
    }
    this.ipControl.reset('');
  }

  protected removeIp(ip: string): void {
    this.draftIps.set(this.ips().filter((entry) => entry !== ip));
  }

  protected async saveIps(): Promise<void> {
    const allowedIps = this.draftIps();
    if (allowedIps === null || this.savingIps()) {
      return;
    }
    this.savingIps.set(true);
    try {
      await this.run(async (productionId) => {
        this.updated.emit(
          await this.api.updateOutputLinkAccess(productionId, this.link().id, {
            allowedIps: [...allowedIps],
          }),
        );
        this.draftIps.set(null);
        this.toasts.show(
          allowedIps.length === 0
            ? t('regie.header.output.accessSavedOpen')
            : t('regie.header.output.accessSaved'),
        );
      });
    } finally {
      this.savingIps.set(false);
    }
  }

  protected discardIps(): void {
    this.draftIps.set(null);
    this.ipControl.reset('');
  }

  protected async renew(): Promise<void> {
    await this.run(async (productionId) => {
      const renewed = await this.api.regenerateOutputLinkKey(productionId, this.link().id);
      this.revealed.set(false);
      this.confirming.set(null);
      this.updated.emit(renewed);
      this.toasts.show(t('regie.header.output.linkNew', { name: renewed.name }));
    });
  }

  protected async revoke(): Promise<void> {
    const { id, name } = this.link();
    await this.run(async (productionId) => {
      await this.api.revokeOutputLink(productionId, id);
      this.revoked.emit(id);
      this.toasts.show(t('regie.output.link.revoked', { name }));
    });
  }

  protected cancelConfirm(selector: string): void {
    this.confirming.set(null);
    this.focus(selector);
  }

  private focus(selector: string): void {
    afterNextRender(
      () => this.host.nativeElement.querySelector<HTMLElement>(selector)?.focus(),
      { injector: this.injector },
    );
  }

  /** Runs one request for the production; errors become a toast, `busy` blocks a second click. */
  private async run(request: (productionId: string) => Promise<void>): Promise<void> {
    const productionId = this.store.productionId();
    if (!productionId || this.busy()) {
      return;
    }
    this.busy.set(true);
    try {
      await request(productionId);
    } catch (error) {
      this.toasts.error(error);
    } finally {
      this.busy.set(false);
    }
  }
}
