import type { BrowserContext, Page } from '@playwright/test';

/**
 * Stand-ins for the browser APIs a phone depends on and the harness cannot get from Chromium: the Screen Wake Lock, the
 * Battery API, the page visibility, and the OS suspending a camera. They are installed with `context.addInitScript` before the
 * sender starts (none of this ships in the product).
 */

const WAKE_LOCK_STUB = `(() => {
  if (window.__fsWake) return;
  const state = (window.__fsWake = { requests: 0, released: 0, active: 0, hiddenRequests: 0 });
  let hidden = false;
  let current = null;
  const sentinel = () => {
    const target = new EventTarget();
    const lock = Object.assign(target, {
      released: false,
      type: 'screen',
      release() {
        if (lock.released) return Promise.resolve();
        lock.released = true;
        state.released += 1;
        state.active -= 1;
        lock.dispatchEvent(new Event('release'));
        return Promise.resolve();
      },
    });
    return lock;
  };
  Object.defineProperty(navigator, 'wakeLock', {
    configurable: true,
    value: {
      request: async () => {
        if (hidden) {
          state.hiddenRequests += 1;
          throw new DOMException('The document is hidden', 'NotAllowedError');
        }
        state.requests += 1;
        state.active += 1;
        current = sentinel();
        return current;
      },
    },
  });
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') });
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  // What the browser does when the page goes to the background / comes back.
  state.setVisible = (visible) => {
    hidden = !visible;
    if (hidden && current && !current.released) current.release();
    document.dispatchEvent(new Event('visibilitychange'));
  };
})();`;

/** `navigator.wakeLock` that counts requests and releases and follows a simulated page visibility. */
export async function installWakeLockStub(context: BrowserContext): Promise<void> {
  await context.addInitScript({ content: WAKE_LOCK_STUB });
}

export interface WakeLockState {
  requests: number;
  released: number;
  active: number;
  hiddenRequests: number;
}

export async function wakeLockState(page: Page): Promise<WakeLockState | null> {
  return page.evaluate(() => {
    const state = (window as unknown as { __fsWake?: WakeLockState }).__fsWake;
    return state ? { requests: state.requests, released: state.released, active: state.active, hiddenRequests: state.hiddenRequests } : null;
  });
}

/** The page goes to the background (`false`: the lock is released, `visibilitychange` fires) or comes back. */
export async function setPageVisible(page: Page, visible: boolean): Promise<void> {
  await page.evaluate((value) => (window as unknown as { __fsWake: { setVisible(visible: boolean): void } }).__fsWake.setVisible(value), visible);
}

/** `navigator.getBattery()` with a fixed level (0..1) that can be changed through `window.__fsBattery`. */
export async function installBatteryStub(context: BrowserContext, level = 0.15, charging = false): Promise<void> {
  await context.addInitScript(
    ({ initialLevel, initialCharging }) => {
      const battery = Object.assign(new EventTarget(), { level: initialLevel, charging: initialCharging, chargingTime: 0, dischargingTime: 3600 });
      Object.defineProperty(navigator, 'getBattery', { configurable: true, value: () => Promise.resolve(battery) });
      (window as unknown as { __fsBattery: unknown }).__fsBattery = battery;
    },
    { initialLevel: level, initialCharging: charging },
  );
}

/**
 * What the operating system does to a phone camera that goes to the background: the capture track fires `mute` (and `unmute`
 * when it is back). livekit-client turns that into `upstreamPaused` after 5 s and `upstreamResumed` on `unmute`, which the
 * publisher reports as slot state `paused` and `live`. The track is found through the page's video senders.
 * Returns the number of tracks that were touched.
 */
export async function suspendCamera(page: Page, suspended: boolean): Promise<number> {
  return page.evaluate((mute) => {
    const w = window as unknown as { __fsNet?: { peers: Set<RTCPeerConnection> }; __fsSuspended?: MediaStreamTrack[] };
    if (!mute) {
      // After upstreamPaused the sender holds no track any more: the remembered ones get their `unmute`.
      const tracks = w.__fsSuspended ?? [];
      for (const track of tracks) track.dispatchEvent(new Event('unmute'));
      w.__fsSuspended = [];
      return tracks.length;
    }
    const found: MediaStreamTrack[] = [];
    for (const peer of w.__fsNet?.peers ?? []) {
      for (const sender of peer.getSenders()) {
        const track = sender.track;
        if (track && track.kind === 'video' && track.readyState === 'live') found.push(track);
      }
    }
    for (const track of found) track.dispatchEvent(new Event('mute'));
    w.__fsSuspended = found;
    return found.length;
  }, suspended);
}
