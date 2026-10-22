import { Injectable, inject, signal } from '@angular/core';
import type { DeviceKind, TechCheckDto } from '@flowstudio/scene-model';
import { LOCAL_STORAGE, STORAGE_KEYS } from './browser-storage';

/** Front (`user`) or back (`environment`) camera. */
export type Facing = 'user' | 'environment';

/** Camera picture height. */
export type Resolution = 720 | 1080;

/** Per-browser settings of the station (`flowstudio.sender.settings`). */
export interface SenderSettings {
  /** Camera direction; null until the device kind is known (phones default to the back camera). */
  readonly facing: Facing | null;
  readonly resolution: Resolution;
  /** «Dunkel»: black screen with a thin tally frame. */
  readonly dark: boolean;
  /** The camera was running when the page was left: start it again after a reload. */
  readonly cameraOn: boolean;
  /** Screen slots that were shared when the page was left (they need a new click, see «Erneut teilen»). */
  readonly sharedScreens: readonly string[];
  /** Last technical check of this device, reported after reloads too. */
  readonly techCheck: { readonly deviceId: string; readonly result: TechCheckDto } | null;
}

/** Defaults of a fresh browser. */
export const DEFAULT_SETTINGS: SenderSettings = {
  facing: null,
  resolution: 720,
  dark: false,
  cameraOn: true,
  sharedScreens: [],
  techCheck: null,
};

const SCREEN_SLOT = /^screen-[1-9]$/;
const LEVELS = new Set(['unknown', 'ok', 'warn', 'bad']);

function parseTechCheck(value: unknown): SenderSettings['techCheck'] {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const { deviceId, result } = value as { deviceId?: unknown; result?: unknown };
  if (typeof deviceId !== 'string' || typeof result !== 'object' || result === null) {
    return null;
  }
  const check = result as Partial<Record<keyof TechCheckDto, unknown>>;
  const levelsValid = [check.overall, check.camera, check.network, check.bandwidth].every(
    (level) => typeof level === 'string' && LEVELS.has(level),
  );
  return levelsValid && typeof check.at === 'string'
    ? { deviceId, result: result as TechCheckDto }
    : null;
}

/** Validates stored settings; unknown or corrupt values fall back to the defaults one by one. */
export function parseSettings(value: unknown): SenderSettings {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return DEFAULT_SETTINGS;
  }
  const raw = value as Record<string, unknown>;
  const facing = raw['facing'] === 'user' || raw['facing'] === 'environment' ? raw['facing'] : null;
  const resolution = raw['resolution'] === 1080 ? 1080 : 720;
  const sharedScreens = Array.isArray(raw['sharedScreens'])
    ? raw['sharedScreens'].filter(
        (slot): slot is string => typeof slot === 'string' && SCREEN_SLOT.test(slot),
      )
    : [];
  return {
    facing,
    resolution,
    dark: raw['dark'] === true,
    cameraOn: raw['cameraOn'] !== false,
    sharedScreens: [...new Set(sharedScreens)],
    techCheck: parseTechCheck(raw['techCheck']),
  };
}

/** Default camera direction of a device kind: fixed phones film with the better back camera, laptops with the webcam. */
export function defaultFacing(kind: DeviceKind): Facing {
  return kind === 'phone' ? 'environment' : 'user';
}

/** Station settings persisted per browser, so a reloaded phone starts again with the last settings. */
@Injectable({ providedIn: 'root' })
export class SenderSettingsService {
  private readonly storage = inject(LOCAL_STORAGE);

  /** Current settings. */
  readonly settings = signal<SenderSettings>(
    parseSettings(this.storage.readJson(STORAGE_KEYS.settings)),
  );

  /** Merges and persists a change. */
  update(change: Partial<SenderSettings>): void {
    const next = parseSettings({ ...this.settings(), ...change });
    this.settings.set(next);
    this.storage.writeJson(STORAGE_KEYS.settings, next);
  }

  /** Camera direction for a device kind (the stored one, else the kind's default). */
  facingFor(kind: DeviceKind): Facing {
    return this.settings().facing ?? defaultFacing(kind);
  }

  /** Last technical check of the given device, if stored. */
  techCheckFor(deviceId: string): TechCheckDto | null {
    const stored = this.settings().techCheck;
    return stored !== null && stored.deviceId === deviceId ? stored.result : null;
  }
}
