import type { CDPSession, Frame, Page } from '@playwright/test';

/**
 * CDP memory and DOM counters for leak and soak checks (docs/testing.md 1.6, research section 5: the JS heap alone hides
 * leaked DOM nodes and listeners). One DevTools session per page or frame, a forced garbage collection before every
 * sample, plus what the page itself knows: `<video>`/`<canvas>`/`<iframe>` elements and the open WebSockets and
 * RTCPeerConnections of the init script (`window.__sfNet`).
 */

export interface Counters {
  /** `Performance.getMetrics`: JSHeapUsedSize in bytes. */
  jsHeapUsed: number;
  /** Nodes, JSEventListeners, Documents of the renderer (detached ones count until they are collected). */
  nodes: number;
  listeners: number;
  documents: number;
  /** Seconds of main-thread task time so far (CPU load between two samples). */
  taskDurationSeconds: number;
  /** `Date.now()` of the sample. */
  at: number;
  dom: { videos: number; canvases: number; iframes: number; elements: number };
  /** Open sockets and peer connections tracked by the init script, or null without it. */
  net: { sockets: number; peers: number } | null;
}

export type CounterGrowth = {
  [K in 'jsHeapUsed' | 'nodes' | 'listeners' | 'documents' | 'taskDurationSeconds']: number;
} & {
  videos: number;
  canvases: number;
  iframes: number;
  elements: number;
  sockets: number;
  peers: number;
  seconds: number;
};

export class CdpCounters {
  readonly series: Counters[] = [];

  private constructor(
    private readonly session: CDPSession,
    private readonly scope: Page | Frame,
  ) {}

  /** Attaches to a page or an (out-of-process) frame, e.g. the output iframe of an embedding page. */
  static async attach(scope: Page | Frame): Promise<CdpCounters> {
    const page =
      'context' in scope && typeof (scope as Page).context === 'function'
        ? (scope as Page)
        : (scope as Frame).page();
    const session = await page.context().newCDPSession(scope);
    await session.send('Performance.enable');
    return new CdpCounters(session, scope);
  }

  /** One sample (after two forced collections, unless `gc` is false). */
  async sample({ gc = true }: { gc?: boolean } = {}): Promise<Counters> {
    if (gc) {
      await this.session.send('HeapProfiler.collectGarbage');
      await this.session.send('HeapProfiler.collectGarbage');
    }
    const { metrics } = (await this.session.send('Performance.getMetrics')) as {
      metrics: Array<{ name: string; value: number }>;
    };
    const metric = (name: string) => metrics.find((entry) => entry.name === name)?.value ?? 0;
    const page = await this.scope.evaluate(() => ({
      videos: document.querySelectorAll('video').length,
      canvases: document.querySelectorAll('canvas').length,
      iframes: document.querySelectorAll('iframe').length,
      elements: document.getElementsByTagName('*').length,
      net:
        (
          window as unknown as { __sfNet?: { counts(): { sockets: number; peers: number } } }
        ).__sfNet?.counts() ?? null,
    }));
    const counters: Counters = {
      jsHeapUsed: metric('JSHeapUsedSize'),
      nodes: metric('Nodes'),
      listeners: metric('JSEventListeners'),
      documents: metric('Documents'),
      taskDurationSeconds: metric('TaskDuration'),
      at: Date.now(),
      dom: {
        videos: page.videos,
        canvases: page.canvases,
        iframes: page.iframes,
        elements: page.elements,
      },
      net: page.net,
    };
    this.series.push(counters);
    return counters;
  }

  /** Samples every `intervalMs` for `durationMs` (the series is kept in {@link series}). */
  async observe({
    intervalMs,
    durationMs,
    gc = true,
  }: {
    intervalMs: number;
    durationMs: number;
    gc?: boolean;
  }): Promise<Counters[]> {
    const taken: Counters[] = [];
    const end = Date.now() + durationMs;
    taken.push(await this.sample({ gc }));
    while (Date.now() + intervalMs <= end) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
      taken.push(await this.sample({ gc }));
    }
    return taken;
  }

  async detach(): Promise<void> {
    await this.session.detach().catch(() => undefined);
  }
}

/** Difference `after - before` of every counter. */
export function growth(before: Counters, after: Counters): CounterGrowth {
  return {
    jsHeapUsed: after.jsHeapUsed - before.jsHeapUsed,
    nodes: after.nodes - before.nodes,
    listeners: after.listeners - before.listeners,
    documents: after.documents - before.documents,
    taskDurationSeconds: after.taskDurationSeconds - before.taskDurationSeconds,
    videos: after.dom.videos - before.dom.videos,
    canvases: after.dom.canvases - before.dom.canvases,
    iframes: after.dom.iframes - before.dom.iframes,
    elements: after.dom.elements - before.dom.elements,
    sockets: (after.net?.sockets ?? 0) - (before.net?.sockets ?? 0),
    peers: (after.net?.peers ?? 0) - (before.net?.peers ?? 0),
    seconds: (after.at - before.at) / 1000,
  };
}

/** Least-squares slope of a counter over the series, per minute (a leak is a slope that stays positive). */
export function slopePerMinute(
  series: readonly Counters[],
  pick: (counters: Counters) => number,
): number {
  if (series.length < 2) return 0;
  const t0 = series[0]!.at;
  const xs = series.map((entry) => (entry.at - t0) / 60_000);
  const ys = series.map(pick);
  const meanX = xs.reduce((sum, x) => sum + x, 0) / xs.length;
  const meanY = ys.reduce((sum, y) => sum + y, 0) / ys.length;
  const denominator = xs.reduce((sum, x) => sum + (x - meanX) ** 2, 0);
  return denominator === 0
    ? 0
    : xs.reduce((sum, x, index) => sum + (x - meanX) * (ys[index]! - meanY), 0) / denominator;
}
