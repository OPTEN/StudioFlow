import { DOCUMENT } from '@angular/common';
import { Injectable, computed, inject } from '@angular/core';
import { SystemInfoService } from '../../core/api/system-info.service';

/** "studioflow.example.com/join" for "https://studioflow.example.com/join/" (what people type; shown large). */
export function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
}

/**
 * The public base URL of the installation (`GET /api/system/info`: the address of the server settings) for the short join
 * address "‹host›/join". Until it is loaded (or when the request fails) the address of this page is used, which is
 * the same host in a normal installation.
 */
@Injectable({ providedIn: 'root' })
export class PublicUrlService {
  private readonly system = inject(SystemInfoService);
  private readonly document = inject(DOCUMENT);
  private readonly base = computed(() => {
    const url = this.system.info()?.publicBaseUrl?.trim();
    return url ? url.replace(/\/+$/, '') : null;
  });

  /** "https://studioflow.example.com" (no trailing slash). */
  readonly baseUrl = computed(
    () => this.base() ?? this.document.location?.origin ?? 'https://studioflow.local',
  );
  /** Short address for laptops: "https://studioflow.example.com/join". */
  readonly joinUrl = computed(() => `${this.baseUrl()}/join`);

  /** Loads the base URL once; failures keep the fallback (no toast, the fallback works on site). */
  ensureLoaded(): void {
    this.system.ensureLoaded();
  }
}
