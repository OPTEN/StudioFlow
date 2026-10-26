import type { BrowserContext, Page } from '@playwright/test';

/**
 * A phone camera with known capabilities for the remote camera control specs (issue #11). Chromium's fake camera device
 * reports what the build gives it, so the specs install this init script before the sender starts: every video track
 * of `getUserMedia` answers `getCapabilities()` / `getSettings()` / `applyConstraints()` like the profile says, and
 * `navigator.mediaDevices.enumerateDevices()` lists the lenses of the profile. `getUserMedia({ video: { deviceId } })`
 * switches the lens the way a real phone does (a new track, back to the default settings). Nothing here ships in the
 * product.
 */

export interface CameraRange {
  min: number;
  max: number;
  step: number;
}

export interface CameraProfile {
  /** The cameras of the phone; the first one is the default. */
  lenses: { deviceId: string; label: string; facing: 'user' | 'environment' }[];
  /** What `getCapabilities()` returns besides width and height; absent members are not supported. */
  capabilities: {
    zoom?: CameraRange;
    focusMode?: string[];
    focusDistance?: CameraRange;
    exposureCompensation?: CameraRange;
    torch?: boolean;
  };
}

/** An Android phone with three cameras and every control. */
export const ANDROID_CAMERA: CameraProfile = {
  lenses: [
    { deviceId: 'cam-back', label: 'Back Camera', facing: 'environment' },
    { deviceId: 'cam-wide', label: 'Back Ultra Wide Camera', facing: 'environment' },
    { deviceId: 'cam-front', label: 'Front Camera', facing: 'user' },
  ],
  capabilities: {
    zoom: { min: 1, max: 8, step: 0.1 },
    focusMode: ['continuous', 'manual'],
    focusDistance: { min: 0.1, max: 2, step: 0.05 },
    exposureCompensation: { min: -2, max: 2, step: 0.5 },
    torch: true,
  },
};

/** A camera that reports nothing (an old browser, a webcam): one lens, no control. */
export const BARE_CAMERA: CameraProfile = {
  lenses: [{ deviceId: 'cam-only', label: 'Camera', facing: 'user' }],
  capabilities: {},
};

/** State of the stub camera, `window.__sfCam`. */
export interface CameraStubState {
  deviceId: string;
  zoom: number;
  focusMode: string;
  focusDistance: number;
  exposureCompensation: number;
  torch: boolean;
  /** Constraint members the camera refuses with an `OverconstrainedError` (set by a test). */
  refuse: string[];
  /** Number of `getUserMedia` calls with a video request (a lens switch is one more). */
  captures: number;
  /** Every `advanced` constraint set applied so far. */
  applied: Record<string, unknown>[];
}

const STUB = `((profile) => {
  if (window.__sfCam) return;
  const devices = navigator.mediaDevices;
  if (!devices) return;
  const caps = profile.capabilities;
  const state = (window.__sfCam = {
    deviceId: profile.lenses[0].deviceId,
    zoom: caps.zoom ? caps.zoom.min : 1,
    focusMode: caps.focusMode ? caps.focusMode[0] : 'none',
    focusDistance: caps.focusDistance ? caps.focusDistance.min : 0,
    exposureCompensation: 0,
    torch: false,
    refuse: [],
    captures: 0,
    applied: [],
  });
  const defaults = () => {
    state.zoom = caps.zoom ? caps.zoom.min : 1;
    state.focusMode = caps.focusMode ? caps.focusMode[0] : 'none';
    state.exposureCompensation = 0;
    state.torch = false;
  };
  const snap = (value, range) => {
    const stepped = range.min + Math.round((value - range.min) / range.step) * range.step;
    return Math.round(Math.min(range.max, Math.max(range.min, stepped)) * 10000) / 10000;
  };
  const lensOf = (id) => profile.lenses.find((lens) => lens.deviceId === id) || profile.lenses[0];
  devices.enumerateDevices = async () =>
    profile.lenses.map((lens) => ({ kind: 'videoinput', deviceId: lens.deviceId, groupId: 'g-' + lens.deviceId, label: lens.label, toJSON() { return this; } }));

  function decorate(track, deviceId) {
    const original = { settings: track.getSettings.bind(track), apply: track.applyConstraints.bind(track) };
    track.getCapabilities = () => {
      const result = { deviceId: state.deviceId, facingMode: [lensOf(state.deviceId).facing], width: { min: 1, max: 1920 }, height: { min: 1, max: 1080 } };
      if (caps.zoom) result.zoom = { ...caps.zoom };
      if (caps.focusMode) result.focusMode = [...caps.focusMode];
      if (caps.focusDistance) result.focusDistance = { ...caps.focusDistance };
      if (caps.exposureCompensation) result.exposureCompensation = { ...caps.exposureCompensation };
      if (caps.torch) result.torch = true;
      return result;
    };
    track.getSettings = () => {
      const result = { ...original.settings(), deviceId: state.deviceId, facingMode: lensOf(state.deviceId).facing };
      if (caps.zoom) result.zoom = state.zoom;
      if (caps.focusMode) result.focusMode = state.focusMode;
      if (caps.focusMode && state.focusMode === 'manual') result.focusDistance = state.focusDistance;
      if (caps.exposureCompensation) result.exposureCompensation = state.exposureCompensation;
      if (caps.torch) result.torch = state.torch;
      return result;
    };
    track.applyConstraints = async (constraints) => {
      const sets = (constraints && constraints.advanced) || [];
      for (const set of sets) {
        for (const key of Object.keys(set)) {
          if (state.refuse.includes(key)) {
            const error = new DOMException('The camera cannot do ' + key, 'OverconstrainedError');
            throw error;
          }
        }
        state.applied.push(JSON.parse(JSON.stringify(set)));
        if (set.zoom !== undefined && caps.zoom) state.zoom = snap(set.zoom, caps.zoom);
        if (set.focusMode !== undefined && caps.focusMode && caps.focusMode.includes(set.focusMode)) state.focusMode = set.focusMode;
        if (set.focusDistance !== undefined && caps.focusDistance) state.focusDistance = snap(set.focusDistance, caps.focusDistance);
        if (set.exposureCompensation !== undefined && caps.exposureCompensation) state.exposureCompensation = snap(set.exposureCompensation, caps.exposureCompensation);
        if (set.torch !== undefined && caps.torch) state.torch = set.torch === true;
      }
      const { advanced, ...rest } = constraints || {};
      void advanced;
      if (Object.keys(rest).length > 0) await original.apply(rest);
    };
  }

  const previous = devices.getUserMedia.bind(devices);
  devices.getUserMedia = async function (constraints) {
    // The ids of the profile do not exist in the browser's own (fake) camera: ask it for any camera.
    const video = constraints && typeof constraints.video === 'object' ? { ...constraints.video } : constraints && constraints.video;
    if (video && typeof video === 'object') delete video.deviceId;
    const stream = await previous(video === undefined ? constraints : { ...constraints, video });
    if (constraints && constraints.video) {
      const wanted = typeof constraints.video === 'object' ? constraints.video.deviceId : undefined;
      const id = typeof wanted === 'string' ? wanted : wanted && (wanted.exact || wanted.ideal);
      state.deviceId = id && profile.lenses.some((lens) => lens.deviceId === id) ? id : state.deviceId;
      state.captures += 1;
      defaults();
      stream.getVideoTracks().forEach((track) => decorate(track, state.deviceId));
    }
    return stream;
  };
})`;

/** Installs the camera of `profile` on a context, before the sender starts. */
export async function installCameraStub(context: BrowserContext, profile: CameraProfile): Promise<void> {
  await context.addInitScript({ content: `${STUB}(${JSON.stringify(profile)});` });
}

/** What the stub camera has now (`window.__sfCam`). */
export async function readCamera(page: Page): Promise<CameraStubState> {
  return page.evaluate(() => JSON.parse(JSON.stringify((window as unknown as { __sfCam: CameraStubState }).__sfCam)) as CameraStubState);
}

/** Makes the camera refuse the given constraint members from now on (an `OverconstrainedError`). */
export async function refuseConstraints(page: Page, members: string[]): Promise<void> {
  await page.evaluate((list) => {
    (window as unknown as { __sfCam: CameraStubState }).__sfCam.refuse = list;
  }, members);
}
