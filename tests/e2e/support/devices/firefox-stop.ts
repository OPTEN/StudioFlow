import type { BrowserContext, Page } from '@playwright/test';

/**
 * Firefox ignores a script-dispatched `ended` event on a MediaStreamTrack (listeners are not called; checked on a plain canvas
 * capture track), so the harness cannot end a fake screen share there with `track.dispatchEvent(new Event('ended'))` like it
 * does in Chromium (support/browser/fake-sources.js `endScreen`). This shim records the `ended` listeners of every track and
 * calls them itself: what Firefox's own «Stop sharing» does to the page is the same call. Install it before the sender loads.
 */
const SHIM = `(() => {
  if (window.__fsEndedShim) return;
  const original = MediaStreamTrack.prototype.addEventListener;
  const listeners = new WeakMap();
  MediaStreamTrack.prototype.addEventListener = function (type, listener, options) {
    if (type === 'ended' && listener) {
      let list = listeners.get(this);
      if (!list) listeners.set(this, (list = []));
      list.push(listener);
    }
    return original.call(this, type, listener, options);
  };
  window.__fsEndedShim = {
    fire(track) {
      for (const listener of listeners.get(track) || []) {
        try {
          const event = new Event('ended');
          if (typeof listener === 'function') listener.call(track, event);
          else listener.handleEvent(event);
        } catch (error) {
          console.error(error);
        }
      }
    },
  };
})();`;

export async function installEndedShim(context: BrowserContext): Promise<void> {
  await context.addInitScript({ content: SHIM });
}

/** The browser's «Stop sharing» of the n-th fake screen: the capture stops and the recorded `ended` listeners run. */
export async function stopSharingInFirefox(page: Page, index?: number): Promise<boolean> {
  return page.evaluate((i) => {
    const w = window as unknown as { __fsFake?: { streams: Array<{ kind: string; track: MediaStreamTrack; stop(): void }> }; __fsEndedShim?: { fire(track: MediaStreamTrack): void } };
    const screens = (w.__fsFake?.streams ?? []).filter((entry) => entry.kind === 'screen');
    const entry = i === undefined ? screens[screens.length - 1] : screens[i];
    if (!entry || !w.__fsEndedShim) return false;
    entry.stop();
    w.__fsEndedShim.fire(entry.track);
    return true;
  }, index);
}
