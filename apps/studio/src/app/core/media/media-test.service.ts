import { DOCUMENT } from '@angular/common';
import { Injectable, InjectionToken, inject } from '@angular/core';
import type { MediaTestInput, MediaTestResult } from '@studioflow/media-client';
import { StudioApiService } from '../api/studio-api.service';

/** Runs the round trip of the media test; replaced in tests. The dynamic import keeps livekit-client out of the main bundle. */
export const MEDIA_TEST_RUNNER = new InjectionToken<
  (input: MediaTestInput) => Promise<MediaTestResult>
>('MEDIA_TEST_RUNNER', {
  providedIn: 'root',
  factory: () => async (input) =>
    (await import('@studioflow/media-client')).runMediaRoundTrip(input),
});

/**
 * The media test of the first-run wizard and the "Server settings" (issue #27): LiveKit announces the address to try
 * (`POST /api/settings/media/test`, valid for two minutes unless the address is saved), then two throw-away
 * participants join through the same origin as the page and exchange a message over WebRTC. Success proves that this
 * browser reaches the media server on that address. The test stays open until the address is saved or {@link end}
 * is called, so that saving the tested address does not restart LiveKit a second time.
 */
@Injectable({ providedIn: 'root' })
export class MediaTestService {
  private readonly api = inject(StudioApiService);
  private readonly runner = inject(MEDIA_TEST_RUNNER);
  private readonly document = inject(DOCUMENT);
  private open = false;

  /** True while LiveKit announces a tested address that was not saved. */
  get isOpen(): boolean {
    return this.open;
  }

  /** Tests `address`. Rejects with an `ApiError` when the server refuses to start the test (invalid address, a live broadcast). */
  async run(address: string): Promise<MediaTestResult> {
    const trial = await this.api.startMediaTest({ address });
    this.open = true;
    return this.runner({
      url: this.pageUrl(),
      firstToken: trial.first.token,
      secondToken: trial.second.token,
    });
  }

  /** The address was saved: the server has ended the test. */
  markSaved(): void {
    this.open = false;
  }

  /** Ends an open test without saving: LiveKit goes back to the saved address. Never rejects. */
  async end(): Promise<void> {
    if (!this.open) {
      return;
    }
    this.open = false;
    try {
      await this.api.endMediaTest();
    } catch {
      // The trial ends by itself after two minutes.
    }
  }

  /** `wss://host:port` of the page: the test goes through the same origin as the Regie (Caddy proxies `/rtc`). */
  private pageUrl(): string {
    const { protocol, host } = this.document.location;
    return `${protocol === 'https:' ? 'wss' : 'ws'}://${host}`;
  }
}
