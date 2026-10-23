import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type {
  BandwidthTestResultDto,
  CreatePairingRequest,
  DeviceCredentialsDto,
  DeviceSelfDto,
  DeviceSessionDto,
  DeviceSlotDto,
  LiveKitTokenDto,
  PairingRequestCreatedDto,
  PairingRequestStatusDto,
  RedeemInviteRequest,
  SourceKind,
} from '@studioflow/scene-model';
import { firstValueFrom, timeout, type Observable } from 'rxjs';
import { toApiError } from './api-error';

/** Header carrying the poll token of a knock. */
export const PAIRING_TOKEN_HEADER = 'X-Pairing-Token';

/** Upper bound of a normal API call. */
const REQUEST_TIMEOUT_MS = 15_000;
/** Upper bound of the 1 MB bandwidth test upload. */
const UPLOAD_TIMEOUT_MS = 20_000;

/** Monotonic milliseconds for RTT measurements. */
function nowMs(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now();
}

/**
 * Typed REST client of the sender: the public pairing routes and the device routes (`ApiSurface.cs`, groups
 * “Pairing (public)” and “Device (sender)”). Device routes get the bearer from {@link deviceAuthInterceptor}. Every
 * method rejects with an {@link ApiError} carrying a message in the active language (`userMessage`).
 */
@Injectable({ providedIn: 'root' })
export class DeviceApiService {
  private readonly http = inject(HttpClient);

  /** `POST /api/pairing/requests`: knock with name, kind and platform (rate limited, 429). */
  createPairingRequest(body: CreatePairingRequest): Promise<PairingRequestCreatedDto> {
    return this.call(this.http.post<PairingRequestCreatedDto>('/api/pairing/requests', body));
  }

  /** `GET /api/pairing/requests/{id}`: poll a knock; unknown ids and wrong tokens answer `expired`. */
  getPairingRequestStatus(requestId: string, pollToken: string): Promise<PairingRequestStatusDto> {
    return this.call(
      this.http.get<PairingRequestStatusDto>(
        `/api/pairing/requests/${encodeURIComponent(requestId)}`,
        { headers: new HttpHeaders({ [PAIRING_TOKEN_HEADER]: pollToken }) },
      ),
    );
  }

  /** `DELETE /api/pairing/requests/{id}`: withdraw a pending knock. */
  async cancelPairingRequest(requestId: string, pollToken: string): Promise<void> {
    await this.call(
      this.http.delete(`/api/pairing/requests/${encodeURIComponent(requestId)}`, {
        headers: new HttpHeaders({ [PAIRING_TOKEN_HEADER]: pollToken }),
      }),
    );
  }

  /** `POST /api/pairing/invites/{token}/redeem`: idempotent per client id for five minutes (410 when expired). */
  redeemInvite(token: string, body: RedeemInviteRequest): Promise<DeviceCredentialsDto> {
    return this.call(
      this.http.post<DeviceCredentialsDto>(
        `/api/pairing/invites/${encodeURIComponent(token)}/redeem`,
        body,
      ),
    );
  }

  /** `GET /api/device/me`: who am I (401 unknown device, 403 blocked). */
  getSelf(): Promise<DeviceSelfDto> {
    return this.call(this.http.get<DeviceSelfDto>('/api/device/me'));
  }

  /**
   * `GET /api/device/me` with the measured round trip time: the tech check ping, and the first RTT before the station's
   * `Report` round trips take over.
   */
  async getSelfTimed(): Promise<{ readonly self: DeviceSelfDto; readonly rttMs: number }> {
    const started = nowMs();
    const self = await this.getSelf();
    return { self, rttMs: Math.max(0, Math.round(nowMs() - started)) };
  }

  /** `GET /api/device/session`: self and current tally. */
  getSession(): Promise<DeviceSessionDto> {
    return this.call(this.http.get<DeviceSessionDto>('/api/device/session'));
  }

  /** `POST /api/device/livekit-token`: a fresh LiveKit token for every (re)join (403 when blocked). */
  getLiveKitToken(): Promise<LiveKitTokenDto> {
    return this.call(this.http.post<LiveKitTokenDto>('/api/device/livekit-token', null));
  }

  /** `POST /api/device/slots`: another screen or the optional laptop camera (409 `limit_reached`). */
  allocateSlot(kind: Extract<SourceKind, 'camera' | 'screen'>): Promise<DeviceSlotDto> {
    return this.call(this.http.post<DeviceSlotDto>('/api/device/slots', { kind }));
  }

  /** `DELETE /api/device/slots/{slot}`: removes the source (“Remove”). */
  async releaseSlot(slot: string): Promise<void> {
    await this.call(this.http.delete(`/api/device/slots/${encodeURIComponent(slot)}`));
  }

  /** `POST /api/device/bandwidth-test`: uploads the bytes of the technical check. */
  bandwidthTest(bytes: Uint8Array): Promise<BandwidthTestResultDto> {
    const body = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/octet-stream' });
    return this.call(
      this.http.post<BandwidthTestResultDto>('/api/device/bandwidth-test', body, {
        headers: new HttpHeaders({ 'Content-Type': 'application/octet-stream' }),
      }),
      UPLOAD_TIMEOUT_MS,
    );
  }

  /** `POST /api/device/unpair`: the device removes itself. */
  async unpair(): Promise<void> {
    await this.call(this.http.post('/api/device/unpair', null));
  }

  private async call<T>(request: Observable<T>, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
    try {
      return await firstValueFrom(request.pipe(timeout({ first: timeoutMs })));
    } catch (error) {
      throw toApiError(error);
    }
  }
}
