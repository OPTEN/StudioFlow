import { Injectable, inject } from '@angular/core';
import type { DeviceKind } from '@flowstudio/scene-model';
import { toApiError, type ApiError } from '../core/api-error';
import { CredentialsService } from '../core/credentials.service';
import { DeviceApiService } from '../core/device-api.service';
import { NoticeService } from '../core/notice.service';

/** Attempts of one redeem before the page offers «Erneut versuchen». */
export const REDEEM_ATTEMPTS = 5;
/** First pause between attempts; doubles each time. */
export const REDEEM_RETRY_MS = 1000;

/** Result of {@link RedeemService.redeem}. */
export type RedeemOutcome =
  | { readonly kind: 'paired' }
  | { readonly kind: 'expired' }
  | { readonly kind: 'failed'; readonly error: ApiError };

/** Pause that can be awaited (injectable through the method argument for tests). */
export type Delay = (ms: number) => Promise<void>;

const defaultDelay: Delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Redeems a QR code or invite link (spec 4.6, ways 1 and 3). The client id is stored before the first request, so a
 * lost response (network failure, reload) is retried with the same id and the server answers with the same device
 * instead of burning the invite. QR invites get an automatic name («Handy n»); the Regie can rename it later.
 */
@Injectable({ providedIn: 'root' })
export class RedeemService {
  private readonly api = inject(DeviceApiService);
  private readonly credentials = inject(CredentialsService);
  private readonly notices = inject(NoticeService);

  /** Redeems the token with retries on transient failures. Never rejects. */
  async redeem(
    token: string,
    kind: DeviceKind,
    platform: string,
    delay: Delay = defaultDelay,
  ): Promise<RedeemOutcome> {
    const clientId = this.credentials.clientId();
    let lastError: ApiError | null = null;
    for (let attempt = 0; attempt < REDEEM_ATTEMPTS; attempt++) {
      if (attempt > 0) {
        const retryAfterMs = (lastError?.retryAfterSeconds ?? 0) * 1000;
        await delay(Math.max(REDEEM_RETRY_MS * 2 ** (attempt - 1), retryAfterMs));
      }
      try {
        const credentials = await this.api.redeemInvite(token, {
          clientId,
          name: null,
          kind,
          platform,
        });
        this.credentials.save(credentials);
        this.notices.justPaired.set(true);
        return { kind: 'paired' };
      } catch (error) {
        const apiError = toApiError(error);
        if (apiError.status === 410) {
          return { kind: 'expired' };
        }
        if (!apiError.isTransient) {
          return { kind: 'failed', error: apiError };
        }
        lastError = apiError;
      }
    }
    return { kind: 'failed', error: lastError ?? toApiError(null) };
  }
}
