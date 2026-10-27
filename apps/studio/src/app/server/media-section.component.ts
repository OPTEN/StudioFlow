import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import {
  FormControl,
  ReactiveFormsModule,
  type AbstractControl,
  type ValidationErrors,
} from '@angular/forms';
import { msg, t, tm, type Msg } from '@studioflow/i18n';
import { SETTINGS_FIELD_ERROR_CODES as CODES } from '@studioflow/scene-model';
import { ApiError, toUserMsg } from '../core/api/api-error';
import { StudioApiService } from '../core/api/studio-api.service';
import { MediaTestService } from '../core/media/media-test.service';
import { ServerSettingsService } from '../core/state/server-settings.service';
import { RefusedFields, focusFirstInvalid } from '../core/ui/form-feedback';
import { applyFailureMsg } from './apply-messages';
import { isMediaAddress } from './server-rules';

/** What the last test of the address found. */
type Check =
  | { readonly kind: 'ok'; readonly address: string; readonly roundTripMs: number }
  | { readonly kind: 'signal' | 'transport' | 'data'; readonly address: string };

function addressValidator(control: AbstractControl): ValidationErrors | null {
  const value = String(control.value ?? '').trim();
  if (value.length === 0) {
    return { address: 'required' };
  }
  return isMediaAddress(value) ? null : { address: 'invalid' };
}

/**
 * The media address (issue #27): the IPv4 address LiveKit announces, so that cameras, phones and the output reach the
 * server for picture and sound. The operator types it (or takes the address this page was opened with), tests it with
 * a WebRTC round trip from this browser and saves it. The same section is a step of the first-run wizard and a part of
 * the "Server settings" page.
 */
@Component({
  selector: 'sf-media-section',
  imports: [ReactiveFormsModule],
  templateUrl: './media-section.component.html',
  styleUrl: './server-section.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MediaSectionComponent {
  private readonly settings = inject(ServerSettingsService);
  private readonly mediaTest = inject(MediaTestService);
  private readonly api = inject(StudioApiService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly refused = new RefusedFields<'address'>();

  /** `next`: the step of the wizard ("Save and continue"); `save`: the settings page. */
  readonly mode = input<'save' | 'next'>('save');
  /** Emitted after the address is saved and LiveKit announces it. */
  readonly saved = output<void>();

  protected readonly t = t;
  protected readonly address = new FormControl(this.settings.settings()?.media.address ?? '', {
    nonNullable: true,
    validators: [addressValidator],
  });
  /** The address this page was opened with, if it is an IPv4 address. */
  protected readonly fromHost = signal<string | null>(null);
  /** Addresses of the server's own interfaces, when the API can see them. */
  protected readonly interfaces = signal<readonly string[]>([]);
  protected readonly testing = signal(false);
  protected readonly saving = signal(false);
  protected readonly check = signal<Check | null>(null);
  protected readonly error = signal<Msg | null>(null);
  protected readonly errorText = computed(() => tm(this.error()) || null);
  protected readonly checkText = computed(() => {
    const check = this.check();
    switch (check?.kind) {
      case undefined:
        return null;
      case 'ok':
        return t('regie.server.media.testOk', {
          address: check.address,
          ms: check.roundTripMs,
        });
      case 'signal':
        return t('regie.server.media.testSignal');
      case 'transport':
        return t('regie.server.media.testTransport', { address: check.address });
      case 'data':
        return t('regie.server.media.testData');
    }
  });
  protected readonly busy = computed(() => this.testing() || this.saving());

  constructor() {
    this.address.valueChanges.subscribe(() => {
      this.refused.clear('address');
      this.check.set(null);
    });
    void this.loadSuggestions();
    inject(DestroyRef).onDestroy(() => void this.mediaTest.end());
  }

  /** The text under the field: the server's verdict first, then the browser's own check once the field was left. */
  protected addressError(): string | null {
    const fromServer = this.refused.get('address');
    if (fromServer) {
      return tm(fromServer);
    }
    if (this.address.invalid && this.address.touched) {
      return t(
        this.address.errors?.['address'] === 'required'
          ? 'regie.server.media.required'
          : 'regie.server.media.invalid',
      );
    }
    return null;
  }

  protected use(address: string): void {
    this.address.setValue(address);
    this.address.markAsDirty();
  }

  protected async test(): Promise<void> {
    if (!this.valid() || this.busy()) {
      return;
    }
    const address = this.address.value.trim();
    this.error.set(null);
    this.check.set(null);
    this.testing.set(true);
    try {
      const result = await this.mediaTest.run(address);
      this.check.set(
        result.ok
          ? { kind: 'ok', address, roundTripMs: result.roundTripMs }
          : { kind: result.stage, address },
      );
    } catch (error) {
      this.showFailure(ApiError.from(error));
    } finally {
      this.testing.set(false);
    }
  }

  protected async save(event: Event): Promise<void> {
    event.preventDefault();
    if (!this.valid() || this.busy()) {
      return;
    }
    this.error.set(null);
    this.saving.set(true);
    try {
      await this.settings.saveMedia(this.address.value.trim());
      this.mediaTest.markSaved();
      const outcome = await this.settings.waitUntilApplied(['liveKit']);
      if (!outcome.applied) {
        this.error.set(applyFailureMsg(outcome));
        return;
      }
      this.saved.emit();
    } catch (error) {
      this.showFailure(ApiError.from(error));
    } finally {
      this.saving.set(false);
    }
  }

  private valid(): boolean {
    this.address.markAsTouched();
    if (this.address.invalid) {
      focusFirstInvalid(this.host, this.injector);
      return false;
    }
    return true;
  }

  private showFailure(error: ApiError): void {
    if (error.fieldErrors['address']?.includes(CODES.mediaAddressInvalid)) {
      this.refused.set({ address: msg('regie.server.media.invalid') });
      focusFirstInvalid(this.host, this.injector);
      return;
    }
    this.error.set(toUserMsg(error));
  }

  private async loadSuggestions(): Promise<void> {
    try {
      const suggestions = await this.api.getMediaSuggestions();
      this.fromHost.set(suggestions.fromHost);
      this.interfaces.set(
        suggestions.interfaces.filter((address) => address !== suggestions.fromHost),
      );
      if (this.address.value === '' && suggestions.fromHost) {
        this.address.setValue(suggestions.fromHost, { emitEvent: false });
      }
    } catch {
      // Suggestions are a convenience.
    }
  }
}
