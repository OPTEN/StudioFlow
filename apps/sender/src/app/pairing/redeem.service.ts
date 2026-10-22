import { Injectable, inject } from '@angular/core';
import type { DeviceKind } from '@flowstudio/scene-model';
import { toApiError, type ApiError } from '../core/api-error';
import { CredentialsService } from '../core/credentials.service';
import { DeviceApiService } from '../core/device-api.service';
import { NoticeService } from '../core/notice.service';

/** Attempts of one redeem before the page offers «Erneut versuchen». */
export const REDEEM_ATTEMPTS = 5;
/**
 * Attempts while the server answers «gerade nicht erreichbar» (503, e.g. a short database outage, or a gateway error
 * while the API restarts): about a minute of calm retrying instead of an error screen.
 */
export const REDEEM_OUTAGE_ATTEMPTS = 12;
/** First pause between attempts; doubles each time up to {@link REDEEM_MAX_RETRY_MS}. */
export const REDEEM_RETRY_MS = 1000;
/** Longest pause between two attempts (unless the server asks for more with Retry-After). */
export const REDEEM_MAX_RETRY_MS = 8000;

/** Result of {@link RedeemService.redeem}. */
export type RedeemOutcome =
  | { readonly kind: 'paired' }
  | { readonly kind: 'expired' }
  | { readonly kind: 'failed'; readonly error: ApiError };

/** Pause that can be awaited (injectable through the method argument for tests). */
export type Delay = (ms: number) => Promise<void>;

const defaultDelay: Delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Attempts allowed so far: more while the server only says it is briefly unavailable. */
function attemptLimit(lastError: ApiError | null): number {
  return lastError?.isUnavailable ? REDEEM_OUTAGE_ATTEMPTS : REDEEM_ATTEMPTS;
}

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
    for (let attempt = 0; attempt < attemptLimit(lastError); attempt++) {
      if (attempt > 0) {
        const retryAfterMs = (lastError?.retryAfterSeconds ?? 0) * 1000;
        const backoffMs = Math.min(REDEEM_RETRY_MS * 2 ** (attempt - 1), REDEEM_MAX_RETRY_MS);
        await delay(Math.max(backoffMs, retryAfterMs));
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
