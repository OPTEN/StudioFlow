import { formatNumber, t, type PlainMessageKey } from '@studioflow/i18n';
import type {
  CameraFocusMode,
  CameraLensDto,
  CameraLensKind,
  CameraRangeDto,
  CameraStateDto,
  DeviceDto,
} from '@studioflow/scene-model';

/**
 * View model of the camera panel of a station (issue #11): only the controls the phone reported are present, every
 * value is the one the phone reports back (never the requested one). No Angular, no DOM; the texts are looked up when
 * the model is built, so build it inside a `computed`.
 */

/** A slider of the panel. */
export interface SliderView {
  readonly range: CameraRangeDto;
  /** What the phone really has now. */
  readonly value: number;
  /** The value in text, e.g. "2.0×". */
  readonly text: string;
}

/** One lens of the picker. */
export interface LensView {
  readonly id: string;
  readonly label: string;
  readonly active: boolean;
}

/** Everything the panel shows for a phone whose camera state is known. */
export interface CameraControlsView {
  /** The lens picker (two or more lenses), else empty. */
  readonly lenses: readonly LensView[];
  readonly zoom: SliderView | null;
  /** Automatic / lock buttons; null when the camera has no focus control. */
  readonly focus: {
    readonly mode: CameraFocusMode;
    readonly canLock: boolean;
    readonly canAuto: boolean;
    /** Manual focus distance, only while the focus is locked. */
    readonly distance: SliderView | null;
  } | null;
  readonly brightness: SliderView | null;
  readonly torch: { readonly on: boolean } | null;
  /** Message about the last command the phone refused, or null. */
  readonly problem: string | null;
}

/** What the panel shows. */
export type CameraPanelView =
  | { readonly kind: 'offline' | 'notReported' | 'unavailable' }
  | ({ readonly kind: 'controls' } & CameraControlsView);

const LENS_KIND_KEYS = {
  front: 'regie.camera.lens.front',
  ultraWide: 'regie.camera.lens.ultraWide',
  standard: 'regie.camera.lens.standard',
  tele: 'regie.camera.lens.tele',
  other: null,
} as const satisfies Readonly<Record<CameraLensKind, PlainMessageKey | null>>;

/** Name of a lens by its kind when that is unambiguous, else "Camera 2" by position. */
export function lensLabels(lenses: readonly CameraLensDto[]): string[] {
  return lenses.map((lens, index) => {
    const key = LENS_KIND_KEYS[lens.kind];
    const unique = lenses.filter((other) => other.kind === lens.kind).length === 1;
    return key !== null && unique ? t(key) : t('regie.camera.lens.numbered', { number: index + 1 });
  });
}

const ONE_DECIMAL = { minimumFractionDigits: 1, maximumFractionDigits: 1 } as const;

/** "2.0×". */
export function zoomText(value: number): string {
  return t('regie.camera.zoom.value', { value: formatNumber(value, ONE_DECIMAL) });
}

/** "+0.7 EV". */
export function brightnessText(value: number): string {
  return t('regie.camera.brightness.value', {
    value: formatNumber(value, { ...ONE_DECIMAL, signDisplay: 'exceptZero' }),
  });
}

/** "0.50 m". */
export function distanceText(value: number): string {
  return t('regie.camera.focus.distanceValue', {
    value: formatNumber(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  });
}

function slider(
  range: CameraRangeDto | null,
  value: number | null,
  fallback: number,
  text: (value: number) => string,
): SliderView | null {
  if (range === null || !(range.max > range.min)) {
    return null;
  }
  const actual = Math.min(range.max, Math.max(range.min, value ?? fallback));
  return { range, value: actual, text: text(actual) };
}

const PROBLEM_KEYS = {
  overconstrained: 'regie.camera.problem.overconstrained',
  failed: 'regie.camera.problem.failed',
} as const satisfies Readonly<Record<string, PlainMessageKey>>;

function problemText(problem: string | null): string | null {
  return problem !== null && problem in PROBLEM_KEYS
    ? t(PROBLEM_KEYS[problem as keyof typeof PROBLEM_KEYS])
    : null;
}

function controls(state: CameraStateDto): CameraControlsView {
  const { capabilities, settings } = state;
  const labels = lensLabels(capabilities.lenses);
  const canAuto = capabilities.focusModes.includes('auto');
  const canLock = capabilities.focusModes.includes('manual');
  const mode: CameraFocusMode = settings.focusMode ?? 'auto';
  return {
    lenses:
      capabilities.lenses.length > 1
        ? capabilities.lenses.map((lens, index) => ({
            id: lens.id,
            label: labels[index],
            active: lens.id === settings.lensId,
          }))
        : [],
    zoom: slider(capabilities.zoom, settings.zoom, capabilities.zoom?.min ?? 1, zoomText),
    focus:
      canAuto || canLock
        ? {
            mode,
            canAuto,
            canLock,
            distance:
              mode === 'manual'
                ? slider(capabilities.focusDistance, settings.focusDistance, 0, distanceText)
                : null,
          }
        : null,
    brightness: slider(
      capabilities.exposureCompensation,
      settings.exposureCompensation,
      0,
      brightnessText,
    ),
    torch: capabilities.torch ? { on: settings.torch === true } : null,
    problem: problemText(state.problem),
  };
}

function hasAnyControl(view: CameraControlsView): boolean {
  return (
    view.lenses.length > 0 ||
    view.zoom !== null ||
    view.focus !== null ||
    view.brightness !== null ||
    view.torch !== null
  );
}

/**
 * The panel of a phone: "offline" while it is not connected (the last known controls are not offered), "not reported"
 * before its first camera report, "unavailable" when the camera has no control at all (an iPhone without a second
 * lens), else the controls.
 */
export function cameraPanelView(device: DeviceDto): CameraPanelView {
  if (device.connection === 'offline') {
    return { kind: 'offline' };
  }
  const state = device.telemetry?.camera ?? null;
  if (state === null) {
    return { kind: device.telemetry === null ? 'notReported' : 'unavailable' };
  }
  const view = controls(state);
  return hasAnyControl(view) ? { kind: 'controls', ...view } : { kind: 'unavailable' };
}
