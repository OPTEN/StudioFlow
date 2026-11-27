import type { Rotation } from '@studioflow/scene-model';

import { systemClock, type Clock, type TimerHandle } from './clock';

/**
 * Automatic rotation of a phone camera picture.
 *
 * A browser delivers camera frames turned like the screen, not like the phone: a phone held sideways whose screen
 * stays upright (rotation lock on an iPhone, or a browser that keeps portrait) sends a sideways picture. The phone
 * therefore measures how it is held (gravity from `deviceorientation`) and how its screen is turned
 * (`screen.orientation.angle`, `window.orientation` on older iOS), and reports the clockwise rotation that makes the
 * picture upright again (`CameraSettingsDto.rotation`). The Regie and the output turn the picture by it.
 *
 * Angles: a *device angle* is how far the phone is turned counter-clockwise from upright portrait, as seen from its
 * screen, in the convention of `screen.orientation.angle` (90 = turned to the left, its top points left; 270 = turned
 * to the right). The correction is a CSS angle (clockwise), like the rotation of a scene item.
 *
 * Why `deviceorientation` and not `devicemotion.accelerationIncludingGravity`: Safari on iOS reports the acceleration
 * with the opposite sign of Chrome on Android (and of the specification), which would swap 90 and 270 on one of the two
 * platforms. `beta` and `gamma` mean the same on both, and gravity follows from them exactly.
 */

/** Tilt of the phone from a `deviceorientation` event, in degrees (null where the browser has no sensor). */
export interface DeviceTilt {
  /** Front-back tilt, −180…180: 90 when the phone stands upright. */
  readonly beta: number | null;
  /** Left-right tilt, −90…90: positive when the right edge goes down. */
  readonly gamma: number | null;
}

/** Which way the camera looks: `user` is the front (selfie) camera, `environment` the back camera. */
export type CameraFacing = 'user' | 'environment';

/** What one tilt reading says about how the phone is held. */
export type HoldReading =
  /** Clearly held in this device angle. */
  | { readonly angle: Rotation }
  /** Lying (nearly) flat: the picture says nothing about up and down. */
  | 'flat'
  /** Between two angles (diagonal) or no sensor data. */
  | 'unclear';

/** The device angle must last this long before it counts (a quick tilt does not turn the picture). */
export const ORIENTATION_STABLE_MS = 600;
/**
 * Share of gravity that must lie in the plane of the screen; below it the phone counts as lying flat (about 30° from
 * horizontal).
 */
export const ORIENTATION_MIN_UPRIGHT = 0.5;
/** Largest deviation from the middle of a device angle that still counts as clearly in it (45° is the diagonal). */
export const ORIENTATION_TOLERANCE_DEG = 30;

/** Any angle in degrees as 0, 90, 180 or 270 (rounded to the nearest quarter turn). */
export function quarterTurn(degrees: number): Rotation {
  if (!Number.isFinite(degrees)) {
    return 0;
  }
  const turns = ((Math.round(degrees / 90) % 4) + 4) % 4;
  return (turns * 90) as Rotation;
}

/**
 * The direction “up” (against gravity) in the coordinates of the phone (x to the right of the screen, y to its top, z
 * out of it), from `beta` and `gamma` (the Z-X'-Y'' angles of the specification); null without both values.
 */
export function upVector(tilt: DeviceTilt): { x: number; y: number; z: number } | null {
  const { beta, gamma } = tilt;
  if (
    typeof beta !== 'number' ||
    typeof gamma !== 'number' ||
    !Number.isFinite(beta) ||
    !Number.isFinite(gamma)
  ) {
    return null;
  }
  const b = (beta * Math.PI) / 180;
  const g = (gamma * Math.PI) / 180;
  return { x: -Math.cos(b) * Math.sin(g), y: Math.sin(b), z: Math.cos(b) * Math.cos(g) };
}

/** How the phone is held according to one tilt reading. */
export function readHold(tilt: DeviceTilt): HoldReading {
  const up = upVector(tilt);
  if (up === null) {
    return 'unclear';
  }
  const upright = Math.hypot(up.x, up.y);
  if (upright < ORIENTATION_MIN_UPRIGHT) {
    return 'flat';
  }
  // Upright: up is +y (0°). Turned left (counter-clockwise): the right edge points up, +x (90°).
  const degrees = ((((Math.atan2(up.x, up.y) * 180) / Math.PI) % 360) + 360) % 360;
  const angle = quarterTurn(degrees);
  const off = Math.abs(((degrees - angle + 540) % 360) - 180);
  return off <= ORIENTATION_TOLERANCE_DEG ? { angle } : 'unclear';
}

/**
 * The clockwise rotation that turns the delivered picture upright. The frames come turned like the screen
 * (`screenAngle`); the world is turned by the device angle against the phone. For the back camera the picture is
 * therefore off by (deviceAngle − screenAngle) counter-clockwise and needs (screenAngle − deviceAngle) clockwise; the
 * front camera sees the scene from the other side (left and right swapped, not mirrored on the wire), so a quarter
 * turn goes the other way.
 */
export function cameraRotation(
  deviceAngle: Rotation,
  screenAngle: number,
  facing: CameraFacing,
): Rotation {
  const screen = quarterTurn(screenAngle);
  return quarterTurn(facing === 'user' ? deviceAngle - screen : screen - deviceAngle);
}

/**
 * Hysteresis of the device angle: a new angle only counts once it was read clearly for {@link ORIENTATION_STABLE_MS}
 * without interruption; lying flat or holding the phone diagonally keeps the last angle. Pure: the caller passes the
 * time.
 */
export class HoldTracker {
  #current: Rotation | null = null;
  #candidate: { readonly angle: Rotation; readonly since: number } | null = null;

  /** The device angle that counts; null until one was held long enough. */
  get current(): Rotation | null {
    return this.#current;
  }

  /** The time at which the waiting angle would count, or null when none waits. */
  get dueAt(): number | null {
    return this.#candidate === null ? null : this.#candidate.since + ORIENTATION_STABLE_MS;
  }

  /** Takes a reading at time `now` (ms) and returns the device angle that counts. */
  update(reading: HoldReading, now: number): Rotation | null {
    if (typeof reading !== 'object') {
      this.#candidate = null;
      return this.#current;
    }
    if (reading.angle === this.#current) {
      this.#candidate = null;
      return this.#current;
    }
    if (this.#candidate?.angle !== reading.angle) {
      this.#candidate = { angle: reading.angle, since: now };
    }
    if (now - this.#candidate.since >= ORIENTATION_STABLE_MS) {
      this.#current = reading.angle;
      this.#candidate = null;
    }
    return this.#current;
  }
}

/** Answer of the motion permission (iOS asks the user; other browsers do not ask). */
export type MotionPermission = 'granted' | 'denied' | 'unsupported';

/** What {@link CameraOrientation} needs of the browser (injectable for tests). */
export interface CameraOrientationEnvironment {
  /** The browser has orientation events at all. */
  readonly supported: boolean;
  /** Angle of the screen (`screen.orientation.angle`, else `window.orientation`); null when unknown. */
  screenAngle(): number | null;
  /** Subscribes to `deviceorientation`; returns the unsubscribe function. */
  onTilt(listener: (tilt: DeviceTilt) => void): () => void;
  /** Subscribes to changes of the screen angle; returns the unsubscribe function. */
  onScreenChange(listener: () => void): () => void;
  /**
   * `DeviceOrientationEvent.requestPermission` (iOS 13+), which must be called from a tap; undefined where the browser
   * does not ask.
   */
  readonly requestPermission?: () => Promise<string>;
}

interface OrientationEventStatic {
  requestPermission?: () => Promise<string>;
}

/** The running browser (`window`). */
export function browserOrientationEnvironment(
  win: (Window & typeof globalThis) | undefined = typeof window === 'undefined'
    ? undefined
    : window,
): CameraOrientationEnvironment {
  const eventType = win?.DeviceOrientationEvent as OrientationEventStatic | undefined;
  const request = eventType?.requestPermission;
  return {
    supported: eventType !== undefined,
    screenAngle: () => {
      const angle = win?.screen?.orientation?.angle;
      if (typeof angle === 'number') {
        return angle;
      }
      // Older iOS: −90, 0, 90 or 180.
      const legacy = (win as { orientation?: unknown } | undefined)?.orientation;
      return typeof legacy === 'number' ? legacy : null;
    },
    onTilt: (listener) => {
      const handler = (event: Event): void => {
        const { beta, gamma } = event as DeviceOrientationEvent;
        listener({ beta, gamma });
      };
      win?.addEventListener('deviceorientation', handler);
      return () => win?.removeEventListener('deviceorientation', handler);
    },
    onScreenChange: (listener) => {
      const orientation = win?.screen?.orientation;
      orientation?.addEventListener('change', listener);
      win?.addEventListener('orientationchange', listener);
      return () => {
        orientation?.removeEventListener('change', listener);
        win?.removeEventListener('orientationchange', listener);
      };
    },
    ...(typeof request === 'function' ? { requestPermission: () => request.call(eventType) } : {}),
  };
}

/**
 * Watches how a phone is held and turned and tells the camera rotation (see the module comment). Without sensor, before
 * the permission (iOS) and after a refusal the device angle is unknown and {@link correction} is null: the Regie can
 * still set the rotation by hand. Never throws.
 */
export class CameraOrientation {
  readonly #env: CameraOrientationEnvironment;
  readonly #clock: Clock;
  readonly #tracker = new HoldTracker();
  readonly #listeners = new Set<() => void>();
  #unsubscribe: (() => void)[] = [];
  #lastReading: HoldReading = 'unclear';
  #timer: TimerHandle | null = null;
  #permission: MotionPermission | 'unknown';
  #screenAngle: number;

  constructor(
    environment: CameraOrientationEnvironment = browserOrientationEnvironment(),
    clock: Clock = systemClock,
  ) {
    this.#env = environment;
    this.#clock = clock;
    this.#permission = !environment.supported
      ? 'unsupported'
      : environment.requestPermission
        ? 'unknown'
        : 'granted';
    this.#screenAngle = this.#readScreen();
  }

  /** True while the browser still has to ask (iOS): call {@link requestPermission} from a tap. */
  get needsPermission(): boolean {
    return this.#permission === 'unknown';
  }

  /** The answer so far: `unknown` until a tap asked on iOS. */
  get permission(): MotionPermission | 'unknown' {
    return this.#permission;
  }

  /** How the phone is held (device angle), or null when unknown. */
  get deviceAngle(): Rotation | null {
    return this.#tracker.current;
  }

  /** Angle of the screen (0, 90, 180, 270). */
  get screenAngle(): Rotation {
    return quarterTurn(this.#screenAngle);
  }

  /** The rotation that turns the picture of the camera upright, or null when the device angle is unknown. */
  correction(facing: CameraFacing): Rotation | null {
    const angle = this.#tracker.current;
    return angle === null ? null : cameraRotation(angle, this.#screenAngle, facing);
  }

  /** Starts listening (idempotent). On iOS nothing arrives before the permission. */
  start(): void {
    if (this.#unsubscribe.length > 0 || this.#permission === 'unsupported') {
      return;
    }
    try {
      this.#unsubscribe = [
        this.#env.onTilt((tilt) => this.#onTilt(tilt)),
        this.#env.onScreenChange(() => this.#onScreen()),
      ];
    } catch {
      this.#unsubscribe = [];
    }
  }

  /**
   * Asks for the motion sensor where the browser requires it (iOS). MUST be called from a tap (user gesture). Asks at
   * most until there is an answer; a refusal keeps the device angle unknown.
   */
  async requestPermission(): Promise<MotionPermission> {
    if (this.#permission !== 'unknown' || !this.#env.requestPermission) {
      return this.#permission === 'unknown' ? 'granted' : this.#permission;
    }
    let answer: string;
    try {
      answer = await this.#env.requestPermission();
    } catch {
      // Not from a tap (or another failure): the next tap asks again.
      return 'denied';
    }
    if (this.#permission !== 'unknown') {
      return this.#permission;
    }
    this.#permission = answer === 'granted' ? 'granted' : 'denied';
    if (this.#permission === 'granted' && this.#unsubscribe.length > 0) {
      // Listen anew: some versions only deliver to listeners added after the permission.
      this.#stopListening();
      this.start();
    }
    this.#emit();
    return this.#permission;
  }

  /** Called whenever the device angle or the screen angle changed. Returns the unsubscribe function. */
  onChange(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Stops listening and forgets the listeners. */
  dispose(): void {
    this.#stopListening();
    this.#listeners.clear();
  }

  #onTilt(tilt: DeviceTilt): void {
    this.#lastReading = readHold(tilt);
    this.#evaluate();
  }

  #onScreen(): void {
    const angle = this.#readScreen();
    if (quarterTurn(angle) !== quarterTurn(this.#screenAngle)) {
      this.#screenAngle = angle;
      this.#emit();
    }
  }

  /** Feeds the last reading to the tracker; a waiting angle is checked again when it is due (events may pause). */
  #evaluate(): void {
    const before = this.#tracker.current;
    this.#tracker.update(this.#lastReading, this.#clock.now());
    this.#clearTimer();
    const due = this.#tracker.dueAt;
    if (due !== null) {
      this.#timer = this.#clock.setTimeout(
        () => {
          this.#timer = null;
          this.#evaluate();
        },
        Math.max(0, due - this.#clock.now()),
      );
    }
    if (this.#tracker.current !== before) {
      this.#emit();
    }
  }

  #readScreen(): number {
    try {
      return this.#env.screenAngle() ?? 0;
    } catch {
      return 0;
    }
  }

  #emit(): void {
    for (const listener of [...this.#listeners]) {
      try {
        listener();
      } catch {
        // A listener must not stop the others.
      }
    }
  }

  #clearTimer(): void {
    if (this.#timer !== null) {
      this.#clock.clearTimeout(this.#timer);
      this.#timer = null;
    }
  }

  #stopListening(): void {
    this.#clearTimer();
    for (const unsubscribe of this.#unsubscribe) {
      try {
        unsubscribe();
      } catch {
        // Already gone.
      }
    }
    this.#unsubscribe = [];
  }
}
