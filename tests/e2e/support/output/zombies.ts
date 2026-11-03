import type { CDPSession, Frame, Page } from '@playwright/test';

/**
 * Counts the `HTMLVideoElement` objects that are alive in a page after two garbage collections, attached or not
 * (`Runtime.queryObjects` on the prototype). A removed `<video>` that still has its MediaStream as `srcObject` is kept
 * alive by the media pipeline: `document.querySelectorAll('video')` does not see it, the DevTools node counter does.
 */
export interface VideoCensus {
  total: number;
  attached: number;
  detached: number;
  /** Detached elements that still hold a live MediaStreamTrack. */
  detachedWithLiveTrack: number;
}

/** CDP object group of the census handles (released after every count). */
const CENSUS_GROUP = 'sf-video-census';

export class VideoCensusProbe {
  private constructor(private readonly session: CDPSession) {}

  static async attach(scope: Page | Frame): Promise<VideoCensusProbe> {
    const page = 'context' in scope && typeof (scope as Page).context === 'function' ? (scope as Page) : (scope as Frame).page();
    const session = await page.context().newCDPSession(scope);
    await session.send('Runtime.enable');
    return new VideoCensusProbe(session);
  }

  async count(): Promise<VideoCensus> {
    await this.session.send('HeapProfiler.collectGarbage');
    await this.session.send('HeapProfiler.collectGarbage');
    // The handles of a census live in an object group of their own and are released afterwards: a handle in the default
    // group keeps its object alive, so every census would keep the videos it saw (and their nodes) alive itself, and a
    // later census would count them as removed videos still alive.
    let list: Array<{ attached: boolean; live: number }>;
    try {
      const prototype = await this.session.send('Runtime.evaluate', { expression: 'HTMLVideoElement.prototype', objectGroup: CENSUS_GROUP });
      const objects = await this.session.send('Runtime.queryObjects', { prototypeObjectId: prototype.result.objectId!, objectGroup: CENSUS_GROUP });
      const described = await this.session.send('Runtime.callFunctionOn', {
        objectId: objects.objects.objectId!,
        functionDeclaration:
          'function() { return this.map(function (v) { return { attached: v.isConnected, live: v.srcObject ? v.srcObject.getVideoTracks().filter(function (t) { return t.readyState === "live"; }).length : 0 }; }); }',
        returnByValue: true,
        objectGroup: CENSUS_GROUP,
      });
      list = described.result.value as Array<{ attached: boolean; live: number }>;
    } finally {
      await this.session.send('Runtime.releaseObjectGroup', { objectGroup: CENSUS_GROUP });
    }
    return {
      total: list.length,
      attached: list.filter((video) => video.attached).length,
      detached: list.filter((video) => !video.attached).length,
      detachedWithLiveTrack: list.filter((video) => !video.attached && video.live > 0).length,
    };
  }

  async detach(): Promise<void> {
    await this.session.detach().catch(() => undefined);
  }
}
