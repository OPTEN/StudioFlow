import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import type { DeviceKind } from '@flowstudio/scene-model';
import { toApiError, type ApiError } from '../core/api-error';
import { SESSION_STORAGE, STORAGE_KEYS } from '../core/browser-storage';
import { CredentialsService } from '../core/credentials.service';
import { DeviceApiService } from '../core/device-api.service';
import { NetworkStatusService } from '../core/network-status.service';
import { NoticeService } from '../core/notice.service';

/** Poll interval of a pending knock (spec 4.6). */
export const KNOCK_POLL_MS = 1500;
/** Longest pause between polls while the server is not reachable. */
export const KNOCK_MAX_BACKOFF_MS = 10_000;

/**
 * State of the knock of this tab:
 * `idle` nothing requested · `requesting` POST running · `pending` waiting for the Regie · `approved` paired ·
 * `denied` the Regie said no · `expired` the request timed out (10 min) or the credentials window passed.
 */
export type KnockPhase = 'idle' | 'requesting' | 'pending' | 'approved' | 'denied' | 'expired';

/** A pending knock as kept in `sessionStorage` (`flowstudio.pairing`), so a reload keeps the same request and code. */
export interface PendingKnock {
  readonly requestId: string;
  readonly pollToken: string;
  readonly checkCode: string;
  readonly expiresAt: string;
  readonly name: string;
  readonly kind: DeviceKind;
}

function parseKnock(value: unknown): PendingKnock | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const knock = value as Partial<Record<keyof PendingKnock, unknown>>;
  const valid =
    typeof knock.requestId === 'string' &&
    knock.requestId !== '' &&
    typeof knock.pollToken === 'string' &&
    knock.pollToken !== '' &&
    typeof knock.checkCode === 'string' &&
    /^\d{4}$/.test(knock.checkCode) &&
    typeof knock.expiresAt === 'string' &&
    typeof knock.name === 'string' &&
    (knock.kind === 'phone' || knock.kind === 'laptop');
  return valid ? (knock as PendingKnock) : null;
}

/**
 * Laptop pairing by short URL and check code (spec 4.6, way 2): knock, show the code, poll every 1.5 s (with backoff
 * while the server is unreachable) until the Regie approves or denies or the request expires. Survives reloads of
 * the tab through `sessionStorage`.
 */
@Injectable({ providedIn: 'root' })
export class KnockService {
  private readonly api = inject(DeviceApiService);
  private readonly credentials = inject(CredentialsService);
  private readonly storage = inject(SESSION_STORAGE);
  private readonly notices = inject(NoticeService);
  private readonly network = inject(NetworkStatusService);

  /** Current phase. */
  readonly phase = signal<KnockPhase>('idle');
  /** The pending knock (also after a reload). */
  readonly knock = signal<PendingKnock | null>(
    parseKnock(this.storage.readJson(STORAGE_KEYS.pairing)),
  );
  /** Polls are failing; the next attempt is scheduled. */
  readonly connectionTrouble = signal(false);
  /** Error of the last request attempt (German), e.g. rate limited. */
  readonly error = signal<ApiError | null>(null);
  /** Name and kind of the last knock, to prefill a new request after a denial or expiry. */
  readonly lastRequest = signal<{ readonly name: string; readonly kind: DeviceKind } | null>(null);

  private timer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;
  private failures = 0;
  private polling = false;
  private inFlight = false;

  constructor() {
    const unsubscribe = this.network.onWake(() => this.pollSoon());
    inject(DestroyRef).onDestroy(() => {
      unsubscribe();
      this.stopPolling();
    });
  }

  /** True when this tab has a knock waiting for the Regie. */
  hasPending(): boolean {
    return this.knock() !== null;
  }

  /** Knocks; resolves true when the request was accepted (then the waiting screen takes over). */
  async request(name: string, kind: DeviceKind, platform: string): Promise<boolean> {
    if (this.phase() === 'requesting') {
      return false;
    }
    this.stopPolling();
    this.phase.set('requesting');
    this.error.set(null);
    this.lastRequest.set({ name, kind });
    try {
      const created = await this.api.createPairingRequest({ name, kind, platform });
      const knock: PendingKnock = {
        requestId: created.requestId,
        pollToken: created.pollToken,
        checkCode: created.checkCode,
        expiresAt: created.expiresAt,
        name,
        kind,
      };
      this.knock.set(knock);
      this.storage.writeJson(STORAGE_KEYS.pairing, knock);
      this.phase.set('pending');
      this.failures = 0;
      this.connectionTrouble.set(false);
      this.schedule(KNOCK_POLL_MS);
      return true;
    } catch (error) {
      this.error.set(toApiError(error));
      this.phase.set('idle');
      return false;
    }
  }

  /** Continues a knock of this tab (waiting screen opened or reloaded). */
  resume(): void {
    const knock = this.knock();
    if (knock === null) {
      return;
    }
    if (this.phase() !== 'pending') {
      this.phase.set('pending');
      this.lastRequest.set({ name: knock.name, kind: knock.kind });
    }
    if (!this.polling) {
      this.pollSoon();
    }
  }

  /** Stops polling (the waiting screen was left); {@link resume} continues. */
  stopPolling(): void {
    this.generation++;
    this.polling = false;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /** Withdraws the knock («Abbrechen»); the server call is best effort. */
  async cancel(): Promise<void> {
    const knock = this.knock();
    this.stopPolling();
    this.forget();
    this.phase.set('idle');
    if (knock !== null) {
      await this.api.cancelPairingRequest(knock.requestId, knock.pollToken).catch(() => undefined);
    }
  }

  /** Back to the form after a denial or expiry. */
  reset(): void {
    this.stopPolling();
    this.forget();
    this.phase.set('idle');
    this.error.set(null);
  }

  private pollSoon(): void {
    if (this.knock() === null || this.phase() !== 'pending' || this.inFlight) {
      return;
    }
    this.schedule(0);
  }

  private schedule(delayMs: number): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
    }
    this.polling = true;
    const generation = this.generation;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (generation === this.generation) {
        void this.poll(generation);
      }
    }, delayMs);
  }

  private async poll(generation: number): Promise<void> {
    const knock = this.knock();
    if (knock === null || this.phase() !== 'pending') {
      this.polling = false;
      return;
    }
    this.inFlight = true;
    try {
      const status = await this.api.getPairingRequestStatus(knock.requestId, knock.pollToken);
      this.inFlight = false;
      if (generation !== this.generation) {
        return;
      }
      this.failures = 0;
      this.connectionTrouble.set(false);
      switch (status.status) {
        case 'pending':
          this.schedule(KNOCK_POLL_MS);
          return;
        case 'approved':
          if (status.credentials === null) {
            this.finish('expired');
            return;
          }
          this.credentials.save(status.credentials);
          this.notices.justPaired.set(true);
          this.finish('approved');
          return;
        case 'denied':
          this.finish('denied');
          return;
        default:
          this.finish('expired');
      }
    } catch (error) {
      this.inFlight = false;
      if (generation !== this.generation) {
        return;
      }
      const apiError = toApiError(error);
      if (apiError.status === 410) {
        this.finish('expired');
        return;
      }
      this.failures++;
      this.connectionTrouble.set(true);
      const retryAfterMs =
        apiError.retryAfterSeconds === null ? 0 : apiError.retryAfterSeconds * 1000;
      const backoff = Math.min(KNOCK_MAX_BACKOFF_MS, KNOCK_POLL_MS * 2 ** this.failures);
      this.schedule(Math.max(backoff, retryAfterMs));
    }
  }

  private finish(phase: Extract<KnockPhase, 'approved' | 'denied' | 'expired'>): void {
    this.stopPolling();
    this.forget();
    this.phase.set(phase);
  }

  private forget(): void {
    this.knock.set(null);
    this.storage.remove(STORAGE_KEYS.pairing);
  }
}
