/// <reference path="./browser-apis.d.ts" />
/**
 * Remote camera control of a phone (issue #11), the browser side without livekit-client: what the camera in use can do
 * (`getCapabilities()`), what it does now (`getSettings()`), its lenses (`enumerateDevices()`), and the constraints
 * that apply a Regie command. Only controls the browser reports are touched; everything else is left alone.
 */
import type {
  CameraCapabilitiesDto,
  CameraControlDto,
  CameraFocusMode,
  CameraLensDto,
  CameraLensKind,
  CameraRangeDto,
  CameraSettingsDto,
} from '@studioflow/scene-model';

/** Version of the camera messages this client speaks (`CameraProtocol.Version` on the server). */
export const CAMERA_PROTOCOL_VERSION = 1;

/** Image settings requested for the camera (zoom, focus, brightness, light); unset ones are left to the camera. */
export interface CameraImageSettings {
  readonly zoom?: number;
  readonly focusMode?: CameraFocusMode;
  readonly focusDistance?: number;
  readonly exposureCompensation?: number;
  readonly torch?: boolean;
}

/** Why the camera refused the last command (`CameraStateDto.problem`). */
export type CameraProblem = 'overconstrained' | 'failed';

/** Browser focus modes that mean "the camera focuses by itself", in order of preference. */
const AUTO_FOCUS_MODES = ['continuous', 'single-shot'] as const;

/** Lens names of iOS ("Back Ultra Wide Camera") and Android ("camera2 1, facing front"), most specific first. */
const LENS_RULES: readonly (readonly [RegExp, CameraLensKind])[] = [
  [/front|user|selfie|facetime/i, 'front'],
  [/ultra[\s-]?wide|0[.,]5/i, 'ultraWide'],
  [/tele/i, 'tele'],
  [/back|rear|environment|wide|triple|dual/i, 'standard'],
];

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/** What a lens is, from the name the browser gives it; `other` when the name says nothing. */
export function classifyLens(label: string): CameraLensKind {
  return LENS_RULES.find(([pattern]) => pattern.test(label))?.[1] ?? 'other';
}

/** The cameras of the device; empty when the browser cannot list them. */
export async function listLenses(
  listDevices: () => Promise<readonly MediaDeviceInfo[]>,
): Promise<CameraLensDto[]> {
  try {
    const devices = await listDevices();
    return devices
      .filter((device) => device.kind === 'videoinput' && device.deviceId !== '')
      .map((device) => ({
        id: device.deviceId,
        label: device.label === '' ? null : device.label,
        kind: classifyLens(device.label),
      }));
  } catch {
    return [];
  }
}

function range(value: MediaSettingsRange | undefined): CameraRangeDto | null {
  const { min, max, step } = value ?? {};
  if (
    typeof min !== 'number' ||
    typeof max !== 'number' ||
    !Number.isFinite(min) ||
    !Number.isFinite(max) ||
    min >= max
  ) {
    return null;
  }
  return { min, max, step: typeof step === 'number' && step > 0 ? step : 0 };
}

function focusModeOf(mode: string | undefined): CameraFocusMode | null {
  if (mode === 'manual') {
    return 'manual';
  }
  return mode === 'continuous' || mode === 'single-shot' ? 'auto' : null;
}

function finite(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * What the camera can do. A zoom, focus distance or brightness range with nothing to choose (min = max) counts as
 * missing, so the Regie does not show a slider that cannot move.
 */
export function mapCapabilities(
  capabilities: MediaTrackCapabilities,
  lenses: readonly CameraLensDto[],
): CameraCapabilitiesDto {
  const modes = new Set(
    (capabilities.focusMode ?? []).map(focusModeOf).filter((mode) => mode !== null),
  );
  return {
    lenses: [...lenses],
    zoom: range(capabilities.zoom),
    focusModes: (['auto', 'manual'] as const).filter((mode) => modes.has(mode)),
    focusDistance: modes.has('manual') ? range(capabilities.focusDistance) : null,
    exposureCompensation: range(capabilities.exposureCompensation),
    torch: capabilities.torch === true,
  };
}

/** What the camera does now. */
export function mapSettings(settings: MediaTrackSettings): CameraSettingsDto {
  return {
    lensId: settings.deviceId === undefined || settings.deviceId === '' ? null : settings.deviceId,
    zoom: finite(settings.zoom),
    focusMode: focusModeOf(settings.focusMode),
    focusDistance: finite(settings.focusDistance),
    exposureCompensation: finite(settings.exposureCompensation),
    torch: typeof settings.torch === 'boolean' ? settings.torch : null,
  };
}

/** Clamps a value to a range and snaps it to the range's step (rounded to four decimals against float noise). */
export function clampToRange(value: number, limits: CameraRangeDto): number {
  const snapped =
    limits.step > 0
      ? limits.min + Math.round((value - limits.min) / limits.step) * limits.step
      : value;
  const clamped = Math.round(Math.min(limits.max, Math.max(limits.min, snapped)) * 10_000) / 10_000;
  return clamped === 0 ? 0 : clamped; // no -0 from a negative minimum
}

/**
 * The newer value of each field wins (the last command wins, wherever it comes from). A newer reset drops the older
 * values but keeps an older lens switch, because a reset leaves the lens alone. Mirrors `CameraControlRules.Merge`.
 */
export function mergeCameraControl(
  older: CameraControlDto,
  newer: CameraControlDto,
): CameraControlDto {
  if (newer.reset === true) {
    return { ...newer, lensId: newer.lensId ?? older.lensId };
  }
  return {
    v: CAMERA_PROTOCOL_VERSION,
    lensId: newer.lensId ?? older.lensId,
    zoom: newer.zoom ?? older.zoom,
    focusMode: newer.focusMode ?? older.focusMode,
    focusDistance: newer.focusDistance ?? older.focusDistance,
    exposureCompensation: newer.exposureCompensation ?? older.exposureCompensation,
    torch: newer.torch ?? older.torch,
    reset: older.reset,
  };
}

/** The image settings after a command: a reset starts from nothing, set fields override. */
export function applyCommand(
  current: CameraImageSettings,
  command: CameraControlDto,
): CameraImageSettings {
  const image: Mutable<CameraImageSettings> = command.reset === true ? {} : { ...current };
  if (command.zoom != null) {
    image.zoom = command.zoom;
  }
  if (command.focusMode != null) {
    image.focusMode = command.focusMode;
    if (command.focusMode === 'auto') {
      delete image.focusDistance;
    }
  }
  if (command.focusDistance != null) {
    image.focusDistance = command.focusDistance;
  }
  if (command.exposureCompensation != null) {
    image.exposureCompensation = command.exposureCompensation;
  }
  if (command.torch != null) {
    image.torch = command.torch;
  }
  return image;
}

/**
 * The constraint set that applies `image` to a camera with `capabilities`: unsupported controls are left out, values are
 * clamped to range and step. With `reset` the controls the image does not set go back to automatic (zoom out,
 * automatic focus, no brightness shift, light off). Manual focus without a distance locks the current one. Null when
 * there is nothing to apply.
 */
export function imageConstraints(
  image: CameraImageSettings,
  capabilities: MediaTrackCapabilities,
  current: MediaTrackSettings,
  reset: boolean,
): MediaTrackConstraintSet | null {
  const mapped = mapCapabilities(capabilities, []);
  const constraints: MediaTrackConstraintSet = {};
  const zoom = image.zoom ?? (reset ? mapped.zoom?.min : undefined);
  if (zoom !== undefined && mapped.zoom !== null) {
    constraints.zoom = clampToRange(zoom, mapped.zoom);
  }
  const exposure = image.exposureCompensation ?? (reset ? 0 : undefined);
  if (exposure !== undefined && mapped.exposureCompensation !== null) {
    constraints.exposureCompensation = clampToRange(exposure, mapped.exposureCompensation);
  }
  const torch = image.torch ?? (reset ? false : undefined);
  if (torch !== undefined && mapped.torch) {
    constraints.torch = torch;
  }
  const focusMode = image.focusMode ?? (reset ? 'auto' : undefined);
  if (focusMode === 'auto' && mapped.focusModes.includes('auto')) {
    constraints.focusMode = AUTO_FOCUS_MODES.find((mode) => capabilities.focusMode?.includes(mode));
  } else if (focusMode === 'manual' && mapped.focusModes.includes('manual')) {
    constraints.focusMode = 'manual';
    const distance = image.focusDistance ?? finite(current.focusDistance);
    if (distance !== null && mapped.focusDistance !== null) {
      constraints.focusDistance = clampToRange(distance, mapped.focusDistance);
    }
  }
  return Object.keys(constraints).length === 0 ? null : constraints;
}

/**
 * The image settings really in effect after applying `applied`: a value the camera silently ignored is replaced by
 * the one it reports (the Regie must see reality), and `refused` tells whether that happened.
 */
export function settleImage(
  applied: MediaTrackConstraintSet,
  actual: MediaTrackSettings,
  capabilities: MediaTrackCapabilities,
): { readonly image: CameraImageSettings; readonly refused: boolean } {
  const mapped = mapCapabilities(capabilities, []);
  let refused = false;
  const settle = (
    wanted: number | undefined,
    reported: number | undefined,
    limits: CameraRangeDto | null,
  ): number | undefined => {
    if (wanted === undefined || finite(reported) === null) {
      return wanted;
    }
    if (Math.abs(wanted - (reported as number)) > Math.max(limits?.step ?? 0, 1e-3)) {
      refused = true;
      return reported;
    }
    return wanted;
  };
  const image: Mutable<CameraImageSettings> = {};
  const zoom = settle(applied.zoom, actual.zoom, mapped.zoom);
  const exposure = settle(
    applied.exposureCompensation,
    actual.exposureCompensation,
    mapped.exposureCompensation,
  );
  const distance = settle(applied.focusDistance, actual.focusDistance, mapped.focusDistance);
  if (zoom !== undefined) {
    image.zoom = zoom;
  }
  if (exposure !== undefined) {
    image.exposureCompensation = exposure;
  }
  if (distance !== undefined) {
    image.focusDistance = distance;
  }
  if (applied.focusMode !== undefined) {
    const wanted = focusModeOf(applied.focusMode);
    const reported = focusModeOf(actual.focusMode);
    refused ||= reported !== null && reported !== wanted;
    const mode = reported ?? wanted;
    if (mode !== null) {
      image.focusMode = mode;
    }
  }
  if (applied.torch !== undefined) {
    const reported = typeof actual.torch === 'boolean' ? actual.torch : applied.torch;
    refused ||= reported !== applied.torch;
    image.torch = reported;
  }
  return { image, refused };
}

/** True for a structurally valid camera control command of the version this client speaks (hub data is unchecked). */
export function isCameraControl(value: unknown): value is CameraControlDto {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const command = value as Partial<Record<keyof CameraControlDto, unknown>>;
  const optionalNumber = (field: unknown): boolean =>
    field == null || (typeof field === 'number' && Number.isFinite(field));
  const optionalBoolean = (field: unknown): boolean => field == null || typeof field === 'boolean';
  return (
    command.v === CAMERA_PROTOCOL_VERSION &&
    (command.lensId == null || (typeof command.lensId === 'string' && command.lensId !== '')) &&
    optionalNumber(command.zoom) &&
    optionalNumber(command.focusDistance) &&
    optionalNumber(command.exposureCompensation) &&
    (command.focusMode == null || command.focusMode === 'auto' || command.focusMode === 'manual') &&
    optionalBoolean(command.torch) &&
    optionalBoolean(command.reset)
  );
}

/** The problem code of a failed `applyConstraints` or lens switch. */
export function cameraProblemOf(error: unknown): CameraProblem {
  const name =
    typeof error === 'object' && error !== null ? (error as { name?: unknown }).name : null;
  return name === 'OverconstrainedError' ? 'overconstrained' : 'failed';
}
