import { Injectable, computed, inject, signal } from '@angular/core';
import type { DeviceCredentialsDto } from '@flowstudio/scene-model';
import { LOCAL_STORAGE, STORAGE_KEYS } from './browser-storage';
import { createClientId } from './random-id';

/** Credentials of this paired device. The secret is shown to the device once and never logged. */
export interface DeviceCredentials {
  readonly deviceId: string;
  readonly secret: string;
  readonly productionId: string;
}

/** Stored record (`flowstudio.sender.v1`): credentials once paired, the redeem client id before. */
interface StoredRecord {
  readonly deviceId?: string;
  readonly secret?: string;
  readonly productionId?: string;
  readonly clientId?: string;
}

const DEVICE_ID = /^dev_[a-z0-9]{4,40}$/;
const PRODUCTION_ID = /^prd_[a-z0-9]{4,40}$/;
const CLIENT_ID = /^[\x21-\x7e]{8,128}$/;
const MAX_SECRET_LENGTH = 200;

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

/** Validates the stored record; corrupt or foreign data is dropped field by field. */
function parseRecord(value: unknown): StoredRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {};
  }
  const record = value as Record<string, unknown>;
  const clientId =
    isString(record['clientId']) && CLIENT_ID.test(record['clientId'])
      ? record['clientId']
      : undefined;
  const { deviceId, secret, productionId } = record;
  const credentialsValid =
    isString(deviceId) &&
    DEVICE_ID.test(deviceId) &&
    isString(secret) &&
    secret.length > 0 &&
    secret.length <= MAX_SECRET_LENGTH &&
    !/[\s.]/.test(secret) &&
    isString(productionId) &&
    PRODUCTION_ID.test(productionId);
  return credentialsValid ? { deviceId, secret, productionId, clientId } : { clientId };
}

/**
 * Device credentials in `localStorage` (spec 4.6 «Re-recognition»). Reading never throws: corrupt data counts as
 * «not paired». The secret never leaves this service except as the bearer value.
 */
@Injectable({ providedIn: 'root' })
export class CredentialsService {
  private readonly storage = inject(LOCAL_STORAGE);
  private readonly record = signal<StoredRecord>(this.load());

  /** The credentials, or null when this browser is not paired. */
  readonly credentials = computed<DeviceCredentials | null>(() => {
    const { deviceId, secret, productionId } = this.record();
    return deviceId !== undefined && secret !== undefined && productionId !== undefined
      ? { deviceId, secret, productionId }
      : null;
  });

  /** True when this browser holds device credentials. */
  readonly paired = computed(() => this.credentials() !== null);

  /** Bearer value `{deviceId}.{secret}` for REST and the device hub, or null when not paired. */
  bearer(): string | null {
    const credentials = this.credentials();
    return credentials === null ? null : `${credentials.deviceId}.${credentials.secret}`;
  }

  /**
   * Client id for redeeming an invite. Generated once and stored before the first redeem request, so a retry after a
   * lost response (or a reload) sends the same id and gets the same device back.
   */
  clientId(): string {
    const existing = this.record().clientId;
    if (existing !== undefined) {
      return existing;
    }
    const clientId = createClientId();
    this.persist({ ...this.record(), clientId });
    return clientId;
  }

  /** Stores the credentials returned by an approved knock or a redeemed invite. */
  save(credentials: DeviceCredentialsDto): void {
    const next = parseRecord({
      ...this.record(),
      deviceId: credentials.deviceId,
      secret: credentials.deviceSecret,
      productionId: credentials.productionId,
    });
    if (next.deviceId === undefined) {
      throw new Error('The server returned malformed device credentials.');
    }
    this.persist(next);
  }

  /** Forgets the device (removed by the Regie or unpaired). */
  clear(): void {
    this.record.set({});
    this.storage.remove(STORAGE_KEYS.credentials);
  }

  /** Re-reads the storage (another tab paired or unpaired this browser). */
  reload(): void {
    this.record.set(this.load());
  }

  private load(): StoredRecord {
    const record = parseRecord(this.storage.readJson(STORAGE_KEYS.credentials));
    if (record.deviceId === undefined && record.clientId === undefined) {
      // Nothing usable (missing, corrupt JSON or foreign data): leave a clean slate.
      this.storage.remove(STORAGE_KEYS.credentials);
    }
    return record;
  }

  private persist(record: StoredRecord): void {
    this.record.set(record);
    this.storage.writeJson(STORAGE_KEYS.credentials, record);
  }
}
