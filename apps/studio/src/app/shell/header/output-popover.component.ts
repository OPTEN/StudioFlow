import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
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
import { CANVAS_HEIGHT, CANVAS_WIDTH, type OutputSettingsDto } from '@studioflow/scene-model';
import { toUserMessage } from '../../core/api/api-error';
import { StudioApiService } from '../../core/api/studio-api.service';
import { ProductionStoreService } from '../../core/state/production-store.service';
import { ClipboardService } from '../../core/ui/clipboard.service';
import { ConfirmBoxComponent } from '../../core/ui/confirm-box.component';
import { IconComponent } from '../../core/ui/icon.component';
import { PopoverDirective } from '../../core/ui/popover.directive';
import { ToastService } from '../../core/ui/toast.service';
import { isIpOrCidr, normalizeIp } from './ip-address';

/** Id of the output popover. */
export const OUTPUT_POPOVER = 'output';

/** Output frame rate shown in the popover (the output page renders at the display rate, nominally 30 fps). */
const NOMINAL_FPS = 30;

/** «studioflow.opten.ch/o/webinar?k=••••••»: without scheme and with the key masked. */
export function maskOutputUrl(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/([?&]k=)[^&#]*/, '$1••••••');
}

function ipValidator(control: AbstractControl<string>): ValidationErrors | null {
  const value = control.value.trim();
  return !value || isIpOrCidr(value) ? null : { ip: true };
}

/**
 * Output popover (prototype `renderOutPop`, spec 4.8, 9.1): consumer state and addresses, format, latency, the secret
 * link (masked; copy with selection fallback), the IP restriction editor and «Link neu erzeugen» behind a dashed red
 * confirmation. Loads the output settings when it opens.
 */
@Component({
  selector: 'sf-output-popover',
  imports: [ConfirmBoxComponent, IconComponent, PopoverDirective, ReactiveFormsModule],
  templateUrl: './output-popover.component.html',
  styleUrl: './output-popover.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OutputPopoverComponent {
  private readonly api = inject(StudioApiService);
  private readonly store = inject(ProductionStoreService);
  private readonly clipboard = inject(ClipboardService);
  private readonly toasts = inject(ToastService);
  private readonly injector = inject(Injector);
  private readonly urlElement = viewChild<ElementRef<HTMLElement>>('url');

  protected readonly popoverId = OUTPUT_POPOVER;
  protected readonly format = `${CANVAS_WIDTH} × ${CANVAS_HEIGHT} · ${NOMINAL_FPS} fps`;
  protected readonly settings = signal<OutputSettingsDto | null>(null);
  protected readonly loadError = signal<string | null>(null);
  protected readonly revealed = signal(false);
  protected readonly confirming = signal(false);
  protected readonly regenerating = signal(false);
  protected readonly savingIps = signal(false);
  /** Edited IP list; null while unchanged (the server list is shown). */
  protected readonly draftIps = signal<readonly string[] | null>(null);
  protected readonly ipControl = new FormControl('', {
    nonNullable: true,
    validators: [ipValidator, Validators.maxLength(64)],
  });

  protected readonly status = this.store.outputStatus;
  protected readonly ips = computed(() => this.draftIps() ?? this.settings()?.allowedIps ?? []);
  protected readonly ipsDirty = computed(() => this.draftIps() !== null);
  protected readonly displayUrl = computed(() => {
    const url = this.settings()?.url;
    if (!url) {
      return null;
    }
    return this.revealed() ? url : maskOutputUrl(url);
  });
  protected readonly stateText = computed(() => {
    const status = this.status();
    switch (status?.state) {
      case 'connected':
        // «Abnehmer» is the same in singular and plural.
        return `verbunden, ${status.consumers} Abnehmer`;
      case 'stale':
        return 'verbunden, kein aktuelles Bild';
      default:
        return 'nicht verbunden';
    }
  });
  protected readonly stateClass = computed(() => {
    switch (this.status()?.state) {
      case 'connected':
        return 'c-state--ok';
      case 'stale':
        return 'c-state--warn';
      default:
        return 'c-output-pop__muted';
    }
  });
  protected readonly addresses = computed(() => {
    const addresses = this.status()?.addresses ?? [];
    return addresses.length > 0 ? addresses.join(', ') : '–';
  });
  protected readonly latency = computed(() => {
    const latency = this.status()?.latencyMs;
    return latency === null || latency === undefined ? null : `${Math.round(latency)} ms`;
  });

  constructor() {
    void this.load();
  }

  /** (Re)loads URL, IP list and frame ancestors. */
  protected async load(): Promise<void> {
    const productionId = this.store.productionId();
    if (!productionId) {
      return;
    }
    this.loadError.set(null);
    try {
      this.settings.set(await this.api.getOutputSettings(productionId));
    } catch (error) {
      this.loadError.set(toUserMessage(error));
    }
  }

  protected async copy(): Promise<void> {
    const url = this.settings()?.url;
    if (!url) {
      return;
    }
    const copied = await this.clipboard.copy(url, { label: maskOutputUrl(url) });
    if (!copied) {
      // Fallback: show the real link and select it, so Ctrl+C copies the working URL.
      this.revealed.set(true);
      afterNextRender(
        () => this.clipboard.selectContents(this.urlElement()?.nativeElement ?? null),
        {
          injector: this.injector,
        },
      );
    }
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
    const productionId = this.store.productionId();
    const allowedIps = this.draftIps();
    if (!productionId || allowedIps === null || this.savingIps()) {
      return;
    }
    this.savingIps.set(true);
    try {
      this.settings.set(
        await this.api.updateOutputAccess(productionId, { allowedIps: [...allowedIps] }),
      );
      this.draftIps.set(null);
      this.toasts.show(
        allowedIps.length === 0
          ? 'Zugriff gespeichert: jede Adresse darf den Output öffnen'
          : 'Zugriff gespeichert',
      );
    } catch (error) {
      this.toasts.error(error);
    } finally {
      this.savingIps.set(false);
    }
  }

  protected discardIps(): void {
    this.draftIps.set(null);
    this.ipControl.reset('');
  }

  protected async regenerate(): Promise<void> {
    const productionId = this.store.productionId();
    if (!productionId || this.regenerating()) {
      return;
    }
    this.regenerating.set(true);
    try {
      this.settings.set(await this.api.regenerateOutputKey(productionId));
      this.revealed.set(false);
      this.confirming.set(false);
      this.toasts.show('Neuer Output-Link erzeugt. Der alte ist ungültig.');
    } catch (error) {
      this.toasts.error(error);
    } finally {
      this.regenerating.set(false);
    }
  }
}
