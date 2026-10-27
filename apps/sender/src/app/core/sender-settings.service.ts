import { Injectable, inject, signal } from '@angular/core';
import type {
  CameraImageSettings,
  TechCheckResult,
  TechProblem,
} from '@studioflow/media-client/device';
import type { DeviceKind, TechCheckDto } from '@studioflow/scene-model';
import { LOCAL_STORAGE, STORAGE_KEYS } from './browser-storage';

/** Front (`user`) or back (`environment`) camera. */
export type Facing = 'user' | 'environment';

/** Camera picture height. */
export type Resolution = 720 | 1080;

/** Per-browser settings of the station (`studioflow.sender.settings`). */
export interface SenderSettings {
  /** Camera direction; null until the device kind is known (phones default to the back camera). */
  readonly facing: Facing | null;
  readonly resolution: Resolution;
  /** “Dark”: black screen with a thin tally frame. */
  readonly dark: boolean;
  /** The camera was running when the page was left: start it again after a reload. */
  readonly cameraOn: boolean;
  /**
   * The microphone was on (true) or switched off on purpose (false) when the page was left; null if it was never
   * touched: an audio station then starts its microphone by itself, phones and laptops keep it off.
   */
  readonly micOn: boolean | null;
  /** Audio input chosen for the microphone (browser device id), null for the default input. */
  readonly micInput: string | null;
  /** “Share audio” is ticked for the next screen share. */
  readonly shareScreenAudio: boolean;
  /** Screen slots that were shared when the page was left (they need a new click, see “Share again”). */
  readonly sharedScreens: readonly string[];
  /** Screen slots with the option “Video in screen” (30 instead of 15 frames per second), kept across reloads. */
  readonly videoScreens: readonly string[];
  /** Last technical check of this device, reported after reloads too. */
  readonly techCheck: { readonly deviceId: string; readonly result: TechCheckResult } | null;
  /** Lens chosen by the control room (browser device id), null for the default camera of {@link facing}. */
  readonly lens: string | null;
  /** Zoom, focus, brightness and light last applied by the control room (restored after a reload or reconnect). */
  readonly image: CameraImageSettings;
}

/** Defaults of a fresh browser. */
export const DEFAULT_SETTINGS: SenderSettings = {
  facing: null,
  resolution: 720,
  dark: false,
  cameraOn: true,
  micOn: null,
  micInput: null,
  shareScreenAudio: false,
  sharedScreens: [],
  videoScreens: [],
  techCheck: null,
  lens: null,
  image: {},
};

const MAX_LENS_ID_LENGTH = 512;

function finiteOrSkip(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** Stored image settings; corrupt fields are dropped one by one. */
export function parseImage(value: unknown): CameraImageSettings {
  if (typeof value !== 'object' || value === null) {
    return {};
  }
  const raw = value as Record<string, unknown>;
  const image = {
    zoom: finiteOrSkip(raw['zoom']),
    focusMode:
      raw['focusMode'] === 'auto' || raw['focusMode'] === 'manual' ? raw['focusMode'] : undefined,
    focusDistance: finiteOrSkip(raw['focusDistance']),
    exposureCompensation: finiteOrSkip(raw['exposureCompensation']),
    torch: typeof raw['torch'] === 'boolean' ? raw['torch'] : undefined,
  };
  return Object.fromEntries(
    Object.entries(image).filter(([, field]) => field !== undefined),
  ) as CameraImageSettings;
}

const SCREEN_SLOT = /^screen-[1-9]$/;

/** Valid, distinct screen slots of a stored list. */
function parseScreenSlots(value: unknown): string[] {
  const slots = Array.isArray(value)
    ? (value as unknown[]).filter(
        (slot): slot is string => typeof slot === 'string' && SCREEN_SLOT.test(slot),
      )
    : [];
  return [...new Set(slots)];
}

const LEVELS = new Set(['unknown', 'ok', 'warn', 'bad']);

/** Prefix of the messages a tech check stores (`media.techcheck.*`). */
const TECH_PROBLEM_PREFIX = 'media.techcheck.';

/**
 * The problems of a stored check. A check stored by an older version has none (its `note` is shown instead), and so
 * does an entry that is not a message of the tech check.
 */
function parseProblems(value: unknown): readonly TechProblem[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const problems: TechProblem[] = [];
  for (const entry of value as unknown[]) {
    const { key, params } = (entry ?? {}) as { key?: unknown; params?: unknown };
    if (typeof key !== 'string' || !key.startsWith(TECH_PROBLEM_PREFIX)) {
      return [];
    }
    const values = typeof params === 'object' && params !== null ? Object.entries(params) : [];
    if (values.some(([, item]) => typeof item !== 'string' && typeof item !== 'number')) {
      return [];
    }
    problems.push({
      key,
      ...(values.length > 0 ? { params: Object.fromEntries(values) } : {}),
    } as TechProblem);
  }
  return problems;
}

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
    ? {
        deviceId,
        result: {
          ...(result as TechCheckDto),
          problems: parseProblems((result as { problems?: unknown }).problems),
        },
      }
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
  return {
    facing,
    resolution,
    dark: raw['dark'] === true,
    cameraOn: raw['cameraOn'] !== false,
    micOn: typeof raw['micOn'] === 'boolean' ? raw['micOn'] : null,
    micInput:
      typeof raw['micInput'] === 'string' &&
      raw['micInput'] !== '' &&
      raw['micInput'].length <= MAX_LENS_ID_LENGTH
        ? raw['micInput']
        : null,
    shareScreenAudio: raw['shareScreenAudio'] === true,
    sharedScreens: parseScreenSlots(raw['sharedScreens']),
    videoScreens: parseScreenSlots(raw['videoScreens']),
    techCheck: parseTechCheck(raw['techCheck']),
    lens:
      typeof raw['lens'] === 'string' &&
      raw['lens'] !== '' &&
      raw['lens'].length <= MAX_LENS_ID_LENGTH
        ? raw['lens']
        : null,
    image: parseImage(raw['image']),
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
  techCheckFor(deviceId: string): TechCheckResult | null {
    const stored = this.settings().techCheck;
    return stored !== null && stored.deviceId === deviceId ? stored.result : null;
  }
}
