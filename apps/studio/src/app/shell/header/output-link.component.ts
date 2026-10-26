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
import { t } from '@studioflow/i18n';
import type { OutputLinkDto } from '@studioflow/scene-model';
import { StudioApiService } from '../../core/api/studio-api.service';
import { ProductionStoreService } from '../../core/state/production-store.service';
import { ClipboardService } from '../../core/ui/clipboard.service';
import { ConfirmBoxComponent } from '../../core/ui/confirm-box.component';
import { IconComponent } from '../../core/ui/icon.component';
import { ToastService } from '../../core/ui/toast.service';
import { isIpOrCidr, normalizeIp } from './ip-address';
import { OutputCameraComponent } from './output-camera.component';

/** Longest link name the API accepts. */
export const LINK_NAME_MAX = 40;

/** "studioflow.example.com/o/webinar?k=••••••": without scheme and with the key masked. */
export function maskOutputUrl(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/([?&]k=)[^&#]*/, '$1••••••');
}

/** A name is required without its surrounding blanks (the API trims it). */
export function requiredName(control: AbstractControl<string>): ValidationErrors | null {
  return control.value.trim() ? null : { required: true };
}

function ipValidator(control: AbstractControl<string>): ValidationErrors | null {
  const value = control.value.trim();
  return !value || isIpOrCidr(value) ? null : { ip: true };
}

/**
 * The selected output link in the output popover (spec 9.1): its name (rename), the secret URL (masked; copy with
 * selection fallback), the IP restriction editor, "Use as camera …", "Regenerate link" and "Revoke link" behind dashed
 * red confirmations. Every change goes to the API; the popover gets the changed link back.
 */
@Component({
  selector: 'sf-output-link',
  imports: [ConfirmBoxComponent, IconComponent, OutputCameraComponent, ReactiveFormsModule],
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
  private readonly urlElement = viewChild<ElementRef<HTMLElement>>('url');

  /** The link; the popover creates this component anew when another link is selected. */
  readonly link = input.required<OutputLinkDto>();
  /** The link changed on the server (renamed, new key, new IP restriction). */
  readonly updated = output<OutputLinkDto>();
  /** The link was revoked. */
  readonly revoked = output<string>();

  protected readonly t = t;
  protected readonly nameMax = LINK_NAME_MAX;
  protected readonly revealed = signal(false);
  protected readonly confirming = signal<'regenerate' | 'revoke' | null>(null);
  protected readonly busy = signal(false);
  protected readonly cameraOpen = signal(false);
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
  protected readonly ipsDirty = computed(() => this.draftIps() !== null);
  protected readonly displayUrl = computed(() =>
    this.revealed() ? this.link().url : maskOutputUrl(this.link().url),
  );

  protected async copy(): Promise<void> {
    const url = this.link().url;
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
    this.nameControl.setValue(this.link().name);
    this.renaming.set(true);
  }

  protected async rename(event: Event): Promise<void> {
    event.preventDefault();
    const name = this.nameControl.value.trim();
    if (!name || this.nameControl.invalid) {
      this.nameControl.markAsTouched();
      return;
    }
    if (name === this.link().name) {
      this.renaming.set(false);
      return;
    }
    await this.run(async (productionId) => {
      const renamed = await this.api.renameOutputLink(productionId, this.link().id, { name });
      this.renaming.set(false);
      this.updated.emit(renamed);
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

  protected async regenerate(): Promise<void> {
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
