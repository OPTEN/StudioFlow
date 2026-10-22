import { Injectable, computed, inject } from '@angular/core';
import type { PairingRequestDto } from '@flowstudio/scene-model';
import { StudioApiService } from '../../core/api/studio-api.service';
import { ProductionStoreService } from '../../core/state/production-store.service';
import { ClockService } from '../../core/ui/clock.service';
import { ToastService } from '../../core/ui/toast.service';
import { DockCommandService } from '../shared/dock-command.service';

/** Toast when a knock was answered by someone else or expired (410). */
export const KNOCK_GONE_MESSAGE = 'Diese Anfrage ist abgelaufen oder wurde schon beantwortet.';

/**
 * The knocks of laptops that opened `/join` (spec 4.6, way 2): the pending requests (expired ones are hidden by the
 * shared clock until the server removes them) and «Zulassen» / «Ablehnen». Both answers of one request share one
 * lock, so a double click or a click on both buttons sends exactly one request. Used by the knock cards in the
 * Stationen dock and in the pairing dock.
 */
@Injectable({ providedIn: 'root' })
export class PairingRequestsService {
  private readonly api = inject(StudioApiService);
  private readonly store = inject(ProductionStoreService);
  private readonly clock = inject(ClockService);
  private readonly commands = inject(DockCommandService);
  private readonly toasts = inject(ToastService);

  /** Pending requests, oldest first, without expired ones. */
  readonly pending = computed<readonly PairingRequestDto[]>(
    () => {
      const now = this.store.serverNow(this.clock.now());
      return this.store
        .pairingRequests()
        .filter((request) => !(Date.parse(request.expiresAt) <= now));
    },
    // Re-evaluated every second (expiry): unchanged lists keep their identity.
    { equal: (a, b) => a.length === b.length && a.every((request, index) => request === b[index]) },
  );

  /** True while an answer for the request is in flight or the Regie is offline (buttons disabled). */
  busy(requestId: string): boolean {
    return this.commands.blocked(this.key(requestId));
  }

  /** «Zulassen»: pairs the laptop; resolves true on success. */
  async approve(request: PairingRequestDto): Promise<boolean> {
    const device = await this.commands.run(
      this.key(request.id),
      (productionId) => this.api.approvePairingRequest(productionId, request.id),
      { errors: { pairing_expired: KNOCK_GONE_MESSAGE, not_found: KNOCK_GONE_MESSAGE } },
    );
    if (!device) {
      return false;
    }
    const code = this.store.deviceSources(device.id)[0]?.code;
    this.toasts.show(
      code ? `${device.name} ist gekoppelt und kommt als ${code}` : `${device.name} ist gekoppelt`,
    );
    return true;
  }

  /** «Ablehnen»: the laptop shows that it was not admitted; resolves true on success. */
  async deny(request: PairingRequestDto): Promise<boolean> {
    const done = await this.commands.run(
      this.key(request.id),
      async (productionId) => {
        await this.api.denyPairingRequest(productionId, request.id);
        return true;
      },
      { errors: { pairing_expired: KNOCK_GONE_MESSAGE, not_found: KNOCK_GONE_MESSAGE } },
    );
    if (done) {
      this.toasts.show(`Anfrage von ${request.name} abgelehnt`);
    }
    return done === true;
  }

  private key(requestId: string): string {
    return `knock:${requestId}`;
  }
}
