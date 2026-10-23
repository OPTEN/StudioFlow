import { Injectable, computed, inject, signal } from '@angular/core';
import { t } from '@studioflow/i18n';
import { ApiError, type ErrorMessageOverrides } from '../../core/api/api-error';
import { ProductionStoreService } from '../../core/state/production-store.service';
import { ToastService } from '../../core/ui/toast.service';

/** Options of {@link DockCommandService.run}. */
export interface DockCommandOptions {
  /** Per-call texts that replace the generic error messages (e.g. `{ asset_in_use: msg('…') }`). */
  readonly errors?: ErrorMessageOverrides;
  /**
   * Handles an error before the toast; return true when it was handled (no toast). Used for inline errors such as
   * "in use" next to a media file.
   */
  readonly onError?: (error: ApiError) => boolean;
  /** Run even while the hub is offline (pure REST calls that do not depend on the live state, e.g. uploads). */
  readonly allowOffline?: boolean;
}

/**
 * Runs the server commands of the docks (scenes, stations, pairing, media) with the same rules everywhere:
 *
 * - **Double-click and rapid-repeat protection:** a command runs only while its key is free; {@link busy} is true
 *   until the request settles, so templates disable the button (`[disabled]="commands.busy('knock:' + id)"`). Keys are
 *   global, so the same knock card in the Stationen dock and in the pairing dock shares one lock.
 * - **Offline:** while the hub is not connected the command is not sent and a calm toast explains why.
 * - **Errors:** every failure becomes a toast in the active language from the `ApiError` (never an unhandled
 *   rejection).
 *
 * `run` resolves with the result of the action, or `undefined` when it was skipped or failed; it never rejects.
 */
@Injectable({ providedIn: 'root' })
export class DockCommandService {
  private readonly store = inject(ProductionStoreService);
  private readonly toasts = inject(ToastService);
  private readonly pending = signal<ReadonlySet<string>>(new Set());

  /** True while at least one command runs. */
  readonly anyBusy = computed(() => this.pending().size > 0);
  /** Commands can reach the server (hub connected and a state loaded). */
  readonly online = computed(() => this.store.canCommand());

  /** True while the command with this key runs (reactive). */
  busy(key: string): boolean {
    return this.pending().has(key);
  }

  /** True when the button of this command is disabled: it runs, or the Regie is offline (reactive). */
  blocked(key: string): boolean {
    return !this.store.canCommand() || this.pending().has(key);
  }

  /** Runs `action` with the current production id under the rules above. */
  async run<T>(
    key: string,
    action: (productionId: string) => Promise<T>,
    options: DockCommandOptions = {},
  ): Promise<T | undefined> {
    if (this.pending().has(key)) {
      return undefined;
    }
    const productionId = this.store.productionId();
    if (!productionId) {
      return undefined;
    }
    if (!options.allowOffline && !this.store.canCommand()) {
      this.toasts.show(t('regie.docks.offline'));
      return undefined;
    }
    this.pending.update((keys) => new Set([...keys, key]));
    try {
      return await action(productionId);
    } catch (error) {
      const apiError = ApiError.from(error);
      if (!options.onError?.(apiError)) {
        this.toasts.error(apiError, options.errors);
      }
      return undefined;
    } finally {
      this.pending.update((keys) => {
        const next = new Set(keys);
        next.delete(key);
        return next;
      });
    }
  }
}
