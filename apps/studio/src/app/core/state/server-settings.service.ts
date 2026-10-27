import { Injectable, computed, inject, signal } from '@angular/core';
import type {
  ApplyStatusDto,
  BackupsDto,
  ServerSettingsDto,
  UpdateAddressRequest,
  UpdateBackupRequest,
  UpdateEmbeddingRequest,
  UploadCertificateRequest,
} from '@studioflow/scene-model';
import { ApiError } from '../api/api-error';
import { StudioApiService } from '../api/studio-api.service';

/** How often the apply status is asked while the services take over a change. */
export const APPLY_POLL_MS = 1000;
/** How long the Regie waits for the services to take over a change before it says so. */
export const APPLY_TIMEOUT_MS = 40_000;

/** A service of the stack that has to take over the settings. */
export type ApplyTarget = 'caddy' | 'liveKit' | 'backup';

/** The result of waiting for the services: all run the settings, or these did not (with the reason the API gave). */
export interface ApplyOutcome {
  readonly applied: boolean;
  readonly failed: readonly { readonly target: ApplyTarget; readonly error: string | null }[];
}

/**
 * The server settings of the installation (`/api/settings`, issue #27) as the first-run wizard and the "Server
 * settings" page see them. Every save answers with the whole settings, which replace the state here. `configured` is
 * true once the media address was saved: until then the Regie sends the signed-in admin to the wizard.
 */
@Injectable({ providedIn: 'root' })
export class ServerSettingsService {
  private readonly api = inject(StudioApiService);
  private readonly current = signal<ServerSettingsDto | null>(null);
  private pendingLoad: Promise<ServerSettingsDto> | null = null;

  /** The settings, null until they are loaded. */
  readonly settings = this.current.asReadonly();
  /** True/false once known, null before. */
  readonly configured = computed(() => this.current()?.configured ?? null);

  /** Loads the settings from the server (always a request; concurrent calls share it). Rejects with an `ApiError`. */
  load(): Promise<ServerSettingsDto> {
    this.pendingLoad ??= this.api
      .getServerSettings()
      .then((settings) => {
        this.current.set(settings);
        return settings;
      })
      .finally(() => {
        this.pendingLoad = null;
      });
    return this.pendingLoad;
  }

  /**
   * Whether the installation is configured, for the route guard: asks the server unless it is known to be configured
   * (that never reverts). Null when the server cannot be reached, so a restart does not lock the operator out.
   */
  async ensureConfigured(): Promise<boolean | null> {
    if (this.current()?.configured === true) {
      return true;
    }
    try {
      return (await this.load()).configured;
    } catch (error) {
      const status = ApiError.from(error).status;
      // A 401/403 is the session's business (the interceptor sends the operator to the login page).
      return status === 401 || status === 403 ? true : null;
    }
  }

  /** Saves the media address. 400 `media_address_invalid`, 409 `broadcast_live`. */
  async saveMedia(address: string): Promise<ServerSettingsDto> {
    return this.store(await this.api.updateMediaSettings({ address }));
  }

  /** Saves the address and the certificate mode. */
  async saveAddress(request: UpdateAddressRequest): Promise<ServerSettingsDto> {
    return this.store(await this.api.updateAddressSettings(request));
  }

  /** Stores the certificate and the key of the mode `custom`. */
  async uploadCertificate(request: UploadCertificateRequest): Promise<ServerSettingsDto> {
    return this.store(await this.api.uploadCertificate(request));
  }

  /** Saves the origins that may embed the output. */
  async saveEmbedding(request: UpdateEmbeddingRequest): Promise<ServerSettingsDto> {
    return this.store(await this.api.updateEmbeddingSettings(request));
  }

  /** Saves the backup schedule and the off-site target. */
  async saveBackup(request: UpdateBackupRequest): Promise<ServerSettingsDto> {
    return this.store(await this.api.updateBackupSettings(request));
  }

  /** The latest backups and the state of the backup service. */
  listBackups(): Promise<BackupsDto> {
    return this.api.listBackups();
  }

  /** Asks the backup service for a backup now. */
  requestBackup(): Promise<void> {
    return this.api.requestBackup();
  }

  /**
   * Waits until the named services (default: Caddy and LiveKit) run the saved settings. The API applies them within
   * seconds; a service that reports an error ends the wait early, because it will not recover without the operator.
   * The backup service is not in the default: it may not run at all, which is no reason to hold the wizard. `sleep`
   * is injected for tests.
   */
  async waitUntilApplied(
    targets: readonly ApplyTarget[] = ['caddy', 'liveKit'],
    timeoutMs = APPLY_TIMEOUT_MS,
    sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
  ): Promise<ApplyOutcome> {
    const deadline = Date.now() + timeoutMs;
    let outcome: ApplyOutcome = { applied: false, failed: [] };
    for (;;) {
      try {
        outcome = outcomeOf(await this.api.getServerSettingsStatus(), targets);
      } catch (error) {
        // Caddy takes the new certificate: a moment without answer is normal while the proxy reloads.
        if (ApiError.from(error).status === 401) {
          throw error;
        }
      }
      if (outcome.applied || outcome.failed.length > 0 || Date.now() >= deadline) {
        return outcome;
      }
      await sleep(APPLY_POLL_MS);
    }
  }

  private store(settings: ServerSettingsDto): ServerSettingsDto {
    this.current.set(settings);
    return settings;
  }
}

function outcomeOf(status: ApplyStatusDto, wanted: readonly ApplyTarget[]): ApplyOutcome {
  const all: [ApplyTarget, ApplyStatusDto['caddy']][] = [
    ['caddy', status.caddy],
    ['liveKit', status.liveKit],
    ['backup', status.backup],
  ];
  const states = all.filter(([target]) => wanted.includes(target));
  const failed = states
    .filter(([, state]) => !state.applied && state.error)
    .map(([target, state]) => ({ target, error: state.error }));
  return { applied: states.every(([, state]) => state.applied), failed };
}
