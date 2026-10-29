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
import { msg, t, tm } from '@studioflow/i18n';
import { SETTINGS_FIELD_ERROR_CODES as CODES } from '@studioflow/scene-model';
import { ApiError, toUserMsg } from '../core/api/api-error';
import { StudioApiService } from '../core/api/studio-api.service';
import { MediaTestService } from '../core/media/media-test.service';
import { ProductionStoreService } from '../core/state/production-store.service';
import { ServerSettingsService } from '../core/state/server-settings.service';
import { RefusedFields, focusFirstInvalid } from '../core/ui/form-feedback';
import { applyProblem, plainProblem, type ServerProblem } from './apply-messages';
import { ServerProblemComponent } from './server-problem.component';
import { isMediaAddress } from './server-rules';
import { TechnicalDetailsComponent } from './technical-details.component';

/** What the last test of the address found. */
type Check =
  | { readonly kind: 'ok'; readonly address: string; readonly roundTripMs: number }
  | { readonly kind: 'signal' | 'transport' | 'data'; readonly address: string };

/** A suggested address and where it comes from: the address of this page, or a network interface of the server. */
interface Suggestion {
  readonly address: string;
  readonly fromHost: boolean;
}

/** The command that shows whether the media server and the web server run (the test could not reach the media server). */
const SIGNAL_COMMAND = 'docker compose ps livekit caddy';

function addressValidator(control: AbstractControl): ValidationErrors | null {
  const value = String(control.value ?? '').trim();
  if (value.length === 0) {
    return { address: 'required' };
  }
  return isMediaAddress(value) ? null : { address: 'invalid' };
}

/**
 * The media server (issue #27): the IPv4 address LiveKit announces, so that cameras, phones and the output reach the
 * server for picture and sound. The operator types it or takes a labelled suggestion, tests it with a WebRTC round trip
 * from this browser (which restarts the media server, so it waits for the end of a broadcast) and saves it. The same
 * section is the second step of the first-run wizard (`mode="next"`, with the wizard's buttons projected into the
 * action row) and the page "Media server" of the settings window.
 */
@Component({
  selector: 'sf-media-section',
  imports: [ReactiveFormsModule, ServerProblemComponent, TechnicalDetailsComponent],
  templateUrl: './media-section.component.html',
  styleUrls: ['./server-section.scss', './media-section.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MediaSectionComponent {
  private readonly settings = inject(ServerSettingsService);
  private readonly mediaTest = inject(MediaTestService);
  private readonly api = inject(StudioApiService);
  private readonly store = inject(ProductionStoreService);
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
  /** The addresses the operator can take with one click, labelled with where they come from. */
  protected readonly suggestions = signal<readonly Suggestion[]>([]);
  protected readonly testing = signal(false);
  protected readonly saving = signal(false);
  protected readonly check = signal<Check | null>(null);
  protected readonly problem = signal<ServerProblem | null>(null);
  /** The broadcast is on air: the media server must not restart (the API refuses with 409 as well). */
  protected readonly onAir = computed(() => this.store.broadcast() === 'live');
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
  protected readonly signalCommand = SIGNAL_COMMAND;

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

  protected suggestionSource(suggestion: Suggestion): string {
    return t(
      suggestion.fromHost
        ? 'regie.server.media.suggestFromHost'
        : 'regie.server.media.suggestInterface',
    );
  }

  protected suggestionName(suggestion: Suggestion): string {
    return t('regie.server.media.suggestName', {
      address: suggestion.address,
      source: this.suggestionSource(suggestion),
    });
  }

  protected use(address: string): void {
    this.address.setValue(address);
    this.address.markAsDirty();
  }

  protected async test(): Promise<void> {
    if (!this.valid() || this.busy() || this.onAir()) {
      return;
    }
    const address = this.address.value.trim();
    this.problem.set(null);
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
    if (!this.valid() || this.busy() || this.onAir()) {
      return;
    }
    this.problem.set(null);
    this.saving.set(true);
    try {
      await this.settings.saveMedia(this.address.value.trim());
      this.mediaTest.markSaved();
      const outcome = await this.settings.waitUntilApplied(['liveKit']);
      if (!outcome.applied) {
        this.problem.set(applyProblem(outcome));
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
    this.problem.set(plainProblem(toUserMsg(error)));
  }

  private async loadSuggestions(): Promise<void> {
    try {
      const found = await this.api.getMediaSuggestions();
      const list: Suggestion[] = [];
      if (found.fromHost) {
        list.push({ address: found.fromHost, fromHost: true });
      }
      for (const address of found.interfaces) {
        if (address !== found.fromHost) {
          list.push({ address, fromHost: false });
        }
      }
      this.suggestions.set(list);
      if (this.address.value === '' && found.fromHost) {
        this.address.setValue(found.fromHost, { emitEvent: false });
      }
    } catch {
      // Suggestions are a convenience.
    }
  }
}
