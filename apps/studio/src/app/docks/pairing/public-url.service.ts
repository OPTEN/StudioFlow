import { DOCUMENT } from '@angular/common';
import { Injectable, computed, inject, signal } from '@angular/core';
import { StudioApiService } from '../../core/api/studio-api.service';

/** «flowstudio.opten.ch/join» for «https://flowstudio.opten.ch/join/» (what people type; shown large). */
export function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
}

/**
 * The public base URL of the installation (`GET /api/system/info`, `FLOWSTUDIO_PUBLIC_BASE_URL`) for the short join
 * address «‹host›/join». Until it is loaded (or when the request fails) the address of this page is used, which is
 * the same host in a normal installation.
 */
@Injectable({ providedIn: 'root' })
export class PublicUrlService {
  private readonly api = inject(StudioApiService);
  private readonly document = inject(DOCUMENT);
  private readonly base = signal<string | null>(null);
  private loading = false;

  /** «https://flowstudio.opten.ch» (no trailing slash). */
  readonly baseUrl = computed(
    () => this.base() ?? this.document.location?.origin ?? 'https://flowstudio.local',
  );
  /** Short address for laptops: «https://flowstudio.opten.ch/join». */
  readonly joinUrl = computed(() => `${this.baseUrl()}/join`);

  /** Loads the base URL once; failures keep the fallback (no toast, the fallback works on site). */
  ensureLoaded(): void {
    if (this.base() !== null || this.loading) {
      return;
    }
    this.loading = true;
    this.api
      .getSystemInfo()
      .then((info) => {
        const url = info.publicBaseUrl?.trim();
        if (url) {
          this.base.set(url.replace(/\/+$/, ''));
        }
      })
      .catch(() => undefined)
      .finally(() => {
        this.loading = false;
      });
  }
}
