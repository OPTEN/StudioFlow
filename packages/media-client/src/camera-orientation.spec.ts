import type { Rotation } from '@studioflow/scene-model';

import {
  CameraOrientation,
  HoldTracker,
  ORIENTATION_STABLE_MS,
  cameraRotation,
  quarterTurn,
  readHold,
  upVector,
  type CameraOrientationEnvironment,
  type DeviceTilt,
} from './camera-orientation';
import type { Clock } from './clock';

/** Tilts of a phone standing (not lying), as `deviceorientation` reports them. */
const UPRIGHT: DeviceTilt = { beta: 90, gamma: 0 };
/** Turned to the left (counter-clockwise, its top points left): the left edge goes down. */
const TURNED_LEFT: DeviceTilt = { beta: 0, gamma: -90 };
/** Turned to the right (clockwise, its top points right): the right edge goes down. */
const TURNED_RIGHT: DeviceTilt = { beta: 0, gamma: 90 };
/** Upside down. */
const UPSIDE_DOWN: DeviceTilt = { beta: -90, gamma: 0 };
const FLAT: DeviceTilt = { beta: 5, gamma: 3 };
const DIAGONAL: DeviceTilt = { beta: 45, gamma: -60 };

describe('how the phone is held', () => {
  it('finds up from beta and gamma', () => {
    const up = upVector(UPRIGHT);
    expect(up?.y).toBeCloseTo(1);
    expect(up?.x).toBeCloseTo(0);
    expect(upVector(TURNED_LEFT)?.x).toBeCloseTo(1);
    expect(upVector(FLAT)?.z).toBeCloseTo(1, 1);
    expect(upVector({ beta: null, gamma: 0 })).toBeNull();
  });

  it.each<[string, DeviceTilt, Rotation]>([
    ['upright', UPRIGHT, 0],
    ['turned left (counter-clockwise)', TURNED_LEFT, 90],
    ['upside down', UPSIDE_DOWN, 180],
    ['turned right (clockwise)', TURNED_RIGHT, 270],
    ['upright, leaning back', { beta: 60, gamma: 10 }, 0],
    ['turned left, leaning back', { beta: 20, gamma: -70 }, 90],
  ])('reads %s as %s°', (_name, tilt, angle) => {
    expect(readHold(tilt)).toEqual({ angle });
  });

  it('says nothing about a phone lying flat, held diagonally or without sensor', () => {
    expect(readHold(FLAT)).toBe('flat');
    expect(readHold({ beta: 180, gamma: 0 })).toBe('flat');
    expect(readHold(DIAGONAL)).toBe('unclear');
    expect(readHold({ beta: null, gamma: null })).toBe('unclear');
  });
});

describe('cameraRotation', () => {
  // Frames come turned like the screen. Back camera: the world appears turned by (device − screen) counter-clockwise
  // in the picture; the fix is the clockwise turn (screen − device). The front camera sees left and right swapped.
  it.each<[string, Rotation, number, 'environment' | 'user', Rotation]>([
    ['screen follows the phone, upright', 0, 0, 'environment', 0],
    ['screen follows the phone, turned left', 90, 90, 'environment', 0],
    ['screen follows the phone, turned right', 270, 270, 'environment', 0],
    ['screen locked upright, phone turned left: the head points right', 90, 0, 'environment', 270],
    ['screen locked upright, phone turned right: the head points left', 270, 0, 'environment', 90],
    ['screen locked upright, phone upside down', 180, 0, 'environment', 180],
    ['screen locked sideways, phone upright', 0, 90, 'environment', 90],
    ['old iOS angle −90 (= 270), phone upright', 0, -90, 'environment', 270],
    ['front camera, screen locked upright, phone turned left', 90, 0, 'user', 90],
    ['front camera, screen locked upright, phone turned right', 270, 0, 'user', 270],
    ['front camera, screen follows the phone', 90, 90, 'user', 0],
    ['front camera, upside down', 180, 0, 'user', 180],
  ])('%s', (_name, device, screen, facing, expected) => {
    expect(cameraRotation(device, screen, facing)).toBe(expected);
  });

  it('turns a portrait-locked phone held left and held right in opposite directions', () => {
    const left = cameraRotation(90, 0, 'environment');
    const right = cameraRotation(270, 0, 'environment');
    expect(left).not.toBe(right);
    expect(quarterTurn(left + right)).toBe(0);
  });

  it('rounds any angle to a quarter turn', () => {
    expect([quarterTurn(-90), quarterTurn(360), quarterTurn(91), quarterTurn(Number.NaN)]).toEqual([
      270, 0, 90, 0,
    ]);
  });
});

describe('HoldTracker', () => {
  const left = readHold(TURNED_LEFT);
  const upright = readHold(UPRIGHT);

  it('takes a new angle only after it was held for a while', () => {
    const tracker = new HoldTracker();
    expect(tracker.update(upright, 0)).toBeNull();
    expect(tracker.dueAt).toBe(ORIENTATION_STABLE_MS);
    expect(tracker.update(upright, ORIENTATION_STABLE_MS - 1)).toBeNull();
    expect(tracker.update(upright, ORIENTATION_STABLE_MS)).toBe(0);
    expect(tracker.dueAt).toBeNull();

    expect(tracker.update(left, 1000)).toBe(0);
    expect(tracker.update(left, 1000 + ORIENTATION_STABLE_MS)).toBe(90);
  });

  it('ignores a quick tilt: the waiting angle starts again when the reading changes', () => {
    const tracker = new HoldTracker();
    tracker.update(upright, 0);
    tracker.update(upright, ORIENTATION_STABLE_MS);
    tracker.update(left, 1000);
    tracker.update(upright, 1300);
    tracker.update(left, 1400);
    expect(tracker.update(left, 1000 + ORIENTATION_STABLE_MS)).toBe(0);
    expect(tracker.update(left, 1400 + ORIENTATION_STABLE_MS)).toBe(90);
  });

  it('keeps the angle while the phone lies flat or is held diagonally', () => {
    const tracker = new HoldTracker();
    tracker.update(left, 0);
    tracker.update(left, ORIENTATION_STABLE_MS);
    tracker.update(readHold(FLAT), 1000);
    tracker.update(readHold(FLAT), 5000);
    expect(tracker.current).toBe(90);
    tracker.update(readHold(DIAGONAL), 6000);
    expect(tracker.current).toBe(90);
    // Diagonal interrupts the waiting angle.
    tracker.update(upright, 7000);
    tracker.update(readHold(DIAGONAL), 7300);
    expect(tracker.update(upright, 7000 + ORIENTATION_STABLE_MS)).toBe(90);
  });
});

class FakeClock implements Clock {
  time = 0;
  private timers: { at: number; run: () => void; id: number }[] = [];
  private next = 1;

  now(): number {
    return this.time;
  }

  setTimeout(callback: () => void, delayMs: number): ReturnType<typeof setTimeout> {
    const id = this.next++;
    this.timers.push({ at: this.time + delayMs, run: callback, id });
    return id as unknown as ReturnType<typeof setTimeout>;
  }

  clearTimeout(handle: ReturnType<typeof setTimeout>): void {
    this.timers = this.timers.filter((timer) => timer.id !== (handle as unknown as number));
  }

  advance(ms: number): void {
    this.time += ms;
    for (const timer of this.timers.filter((entry) => entry.at <= this.time)) {
      this.timers = this.timers.filter((entry) => entry !== timer);
      timer.run();
    }
  }
}

function fakeEnvironment(options: { ask?: () => Promise<string>; supported?: boolean } = {}) {
  let tiltListener: ((tilt: DeviceTilt) => void) | null = null;
  let screenListener: (() => void) | null = null;
  const state = { angle: 0 as number | null, subscriptions: 0 };
  const env: CameraOrientationEnvironment = {
    supported: options.supported ?? true,
    screenAngle: () => state.angle,
    onTilt: (listener) => {
      tiltListener = listener;
      state.subscriptions++;
      return () => {
        tiltListener = null;
      };
    },
    onScreenChange: (listener) => {
      screenListener = listener;
      return () => {
        screenListener = null;
      };
    },
    ...(options.ask ? { requestPermission: options.ask } : {}),
  };
  return {
    env,
    state,
    tilt: (tilt: DeviceTilt) => tiltListener?.(tilt),
    turnScreen: (angle: number) => {
      state.angle = angle;
      screenListener?.();
    },
    listening: () => tiltListener !== null,
  };
}

describe('CameraOrientation', () => {
  it('reports the rotation once the phone was held sideways long enough, also when events pause', () => {
    const clock = new FakeClock();
    const fake = fakeEnvironment();
    const orientation = new CameraOrientation(fake.env, clock);
    const changes = vi.fn();
    orientation.onChange(changes);
    orientation.start();

    expect(orientation.needsPermission).toBe(false);
    expect(orientation.correction('environment')).toBeNull();
    fake.tilt(TURNED_LEFT);
    // No further event: the timer checks again when the angle is due.
    clock.advance(ORIENTATION_STABLE_MS);
    expect(orientation.deviceAngle).toBe(90);
    expect(orientation.correction('environment')).toBe(270);
    expect(orientation.correction('user')).toBe(90);
    expect(changes).toHaveBeenCalledTimes(1);

    // The screen follows the phone: nothing to turn any more.
    fake.turnScreen(90);
    expect(orientation.correction('environment')).toBe(0);
    expect(changes).toHaveBeenCalledTimes(2);
    fake.turnScreen(90);
    expect(changes).toHaveBeenCalledTimes(2);
    orientation.dispose();
    expect(fake.listening()).toBe(false);
  });

  it('asks an iPhone on a tap, listens anew once allowed and stays unknown after a refusal', async () => {
    const clock = new FakeClock();
    const ask = vi.fn(() => Promise.resolve('granted'));
    const fake = fakeEnvironment({ ask });
    const orientation = new CameraOrientation(fake.env, clock);
    orientation.start();
    expect(orientation.needsPermission).toBe(true);

    await expect(orientation.requestPermission()).resolves.toBe('granted');
    await orientation.requestPermission();
    expect(ask).toHaveBeenCalledTimes(1);
    expect(orientation.needsPermission).toBe(false);
    expect(fake.state.subscriptions).toBe(2);

    const refused = new CameraOrientation(
      fakeEnvironment({ ask: () => Promise.resolve('denied') }).env,
      clock,
    );
    await expect(refused.requestPermission()).resolves.toBe('denied');
    expect(refused.permission).toBe('denied');
    expect(refused.correction('environment')).toBeNull();
  });

  it('asks again on the next tap when asking failed (not from a tap)', async () => {
    const ask = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('NotAllowedError'))
      .mockResolvedValueOnce('granted');
    const orientation = new CameraOrientation(fakeEnvironment({ ask }).env, new FakeClock());
    await expect(orientation.requestPermission()).resolves.toBe('denied');
    expect(orientation.needsPermission).toBe(true);
    await expect(orientation.requestPermission()).resolves.toBe('granted');
  });

  it('does nothing without orientation events', async () => {
    const fake = fakeEnvironment({ supported: false });
    const orientation = new CameraOrientation(fake.env, new FakeClock());
    orientation.start();
    expect(fake.listening()).toBe(false);
    await expect(orientation.requestPermission()).resolves.toBe('unsupported');
    expect(orientation.correction('environment')).toBeNull();
  });
});
