import { Injectable, inject } from '@angular/core';
import { ApiError } from '../api/api-error';
import { StudioApiService } from '../api/studio-api.service';
import { ProductionStoreService } from './production-store.service';

/**
 * "Seen" (spec 4.5, GAP-08): acknowledges recovered incidents, shared by every Regie session. Only a recovered
 * incident (`endedAt` set) can be acknowledged; the server answers an open one with 409 and an unknown or already
 * acknowledged one with 404.
 */
@Injectable({ providedIn: 'root' })
export class IncidentAckService {
  private readonly api = inject(StudioApiService);
  private readonly store = inject(ProductionStoreService);

  /** True while the incident is known and recovered (reactive). */
  canAcknowledge(incidentId: string): boolean {
    return this.store
      .incidents()
      .some((incident) => incident.id === incidentId && incident.endedAt !== null);
  }

  /**
   * Acknowledges the incidents that are still recovered; the others (open again, or gone) are skipped. A 404 (the
   * other Regie was faster) or 409 (the source dropped again during the request) is no error: the next event shows
   * the current state. Rejects with an {@link ApiError} for anything else.
   */
  async acknowledge(productionId: string, incidentIds: readonly string[]): Promise<void> {
    for (const incidentId of incidentIds) {
      if (!this.canAcknowledge(incidentId)) {
        continue;
      }
      try {
        await this.api.acknowledgeIncident(productionId, incidentId);
      } catch (error) {
        const status = ApiError.from(error).status;
        if (status !== 404 && status !== 409) {
          throw error;
        }
      }
    }
  }
}
