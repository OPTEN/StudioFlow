import { DOCUMENT } from '@angular/common';
import { Injectable, computed, inject } from '@angular/core';

/** "studioflow.example.com/join" for "https://studioflow.example.com/join/" (what people type; shown large). */
export function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
}

/**
 * The base URL devices are sent to: the address this Regie is open at. Whoever opens the Regie through a tunnel or
 * reverse proxy (`https://studioflow.example.com`) hands out that address; whoever opens it directly
 * (`https://172.25.99.187:9443`) hands out the direct one. Invite and output links of the API are moved to it with
 * `onThisOrigin`.
 */
@Injectable({ providedIn: 'root' })
export class PublicUrlService {
  private readonly document = inject(DOCUMENT);

  /** "https://studioflow.example.com" (no trailing slash). */
  readonly baseUrl = computed(() => this.document.location?.origin ?? 'https://studioflow.local');
  /** Short address for laptops: "https://studioflow.example.com/join". */
  readonly joinUrl = computed(() => `${this.baseUrl()}/join`);
}
