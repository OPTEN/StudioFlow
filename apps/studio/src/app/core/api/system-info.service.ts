import { Injectable, computed, inject, signal } from '@angular/core';
import type { SystemInfoDto } from '@studioflow/scene-model';
import { StudioApiService } from './studio-api.service';

/**
 * What the server says about itself (`GET /api/system/info`, admin only): the running version as `0.1.0+1a2b3c4` and
 * the public base URL. Loaded once on demand and shared by everything that shows it (the settings popover, the short
 * join address of the pairing dock), so the request is made at most once per page load. A failed request is not an
 * error for the user: nothing is shown and the next `ensureLoaded()` tries again.
 */
@Injectable({ providedIn: 'root' })
export class SystemInfoService {
  private readonly api = inject(StudioApiService);
  private readonly loaded = signal<SystemInfoDto | null>(null);
  private loading = false;

  /** The answer of the server, null until it is loaded. */
  readonly info = this.loaded.asReadonly();
  /** "0.1.0+1a2b3c4" (the commit is missing in a build that does not know it), null until loaded. */
  readonly version = computed(() => this.loaded()?.version.trim() || null);

  /** Loads the information once; concurrent calls share one request. */
  ensureLoaded(): void {
    if (this.loaded() !== null || this.loading) {
      return;
    }
    this.loading = true;
    this.api
      .getSystemInfo()
      .then((info) => this.loaded.set(info))
      .catch(() => undefined)
      .finally(() => {
        this.loading = false;
      });
  }
}
