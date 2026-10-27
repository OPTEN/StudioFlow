import type { Browser, BrowserContext, CDPSession, Page } from '@playwright/test';

/**
 * CPU accounting of the performance harness (issue #12, docs/testing.md 2.18). Two views that complement each other:
 *
 *  - {@link BrowserCpu}: the CPU time of every process of one browser (`SystemInfo.getProcessInfo` of the browser target:
 *    browser, renderers, GPU, utility). The harness launches one browser per role (senders, Regie, output), so the
 *    processes of a role are exactly the processes of its browser, and software decoding, encoding and compositing are
 *    counted wherever they happen (renderer or GPU process).
 *  - {@link PageMetrics}: `Performance.getMetrics` of one page, i.e. its main thread: task, script, layout and style time.
 *
 * Both are cumulative counters; a measuring window is the difference of two samples.
 */

/** CPU seconds per process type at one moment, plus the per-process values the difference needs. */
export interface CpuSample {
  /** `Date.now()` of the sample. */
  at: number;
  /** Cumulative CPU seconds per process id. */
  byProcess: ReadonlyMap<number, { type: string; cpuTime: number }>;
}

/** CPU use of a browser over a window. */
export interface CpuUse {
  seconds: number;
  /** CPU seconds consumed per wall-clock second by all processes ("cores used"; 1.0 = one core fully busy). */
  cores: number;
  /** The same per process type (`renderer`, `GPU`, `browser`, `utility` ...). */
  coresByType: Record<string, number>;
}

export class BrowserCpu {
  private constructor(private readonly session: CDPSession) {}

  static async attach(browser: Browser): Promise<BrowserCpu> {
    return new BrowserCpu(await browser.newBrowserCDPSession());
  }

  async sample(): Promise<CpuSample> {
    const { processInfo } = (await this.session.send('SystemInfo.getProcessInfo')) as {
      processInfo: Array<{ type: string; id: number; cpuTime: number }>;
    };
    return {
      at: Date.now(),
      byProcess: new Map(processInfo.map((entry) => [entry.id, { type: entry.type, cpuTime: entry.cpuTime }])),
    };
  }

  async detach(): Promise<void> {
    await this.session.detach().catch(() => undefined);
  }
}

/**
 * CPU use between two samples. A process that appears in the second sample only (a new renderer) counts with its whole
 * CPU time; one that is gone has no second value and is left out.
 */
export function cpuUse(before: CpuSample, after: CpuSample): CpuUse {
  const seconds = Math.max(0.001, (after.at - before.at) / 1000);
  const coresByType: Record<string, number> = {};
  let total = 0;
  for (const [id, now] of after.byProcess) {
    const delta = Math.max(0, now.cpuTime - (before.byProcess.get(id)?.cpuTime ?? 0));
    total += delta;
    coresByType[now.type] = (coresByType[now.type] ?? 0) + delta / seconds;
  }
  return { seconds, cores: total / seconds, coresByType };
}

/** Main-thread counters of a page (`Performance.getMetrics`). */
export interface MetricsSample {
  at: number;
  taskDuration: number;
  scriptDuration: number;
  layoutDuration: number;
  recalcStyleDuration: number;
  layoutCount: number;
  recalcStyleCount: number;
  nodes: number;
  jsHeapUsed: number;
}

/** Main-thread load of a page over a window: busy share of the wall time per kind of work. */
export interface MainThreadUse {
  seconds: number;
  /** Task time / wall time. */
  busyShare: number;
  scriptShare: number;
  layoutShare: number;
  styleShare: number;
  layoutsPerSecond: number;
  styleRecalcsPerSecond: number;
}

export class PageMetrics {
  private constructor(private readonly session: CDPSession) {}

  static async attach(context: BrowserContext, page: Page): Promise<PageMetrics> {
    const session = await context.newCDPSession(page);
    await session.send('Performance.enable');
    return new PageMetrics(session);
  }

  async sample(): Promise<MetricsSample> {
    const { metrics } = (await this.session.send('Performance.getMetrics')) as {
      metrics: Array<{ name: string; value: number }>;
    };
    const metric = (name: string): number => metrics.find((entry) => entry.name === name)?.value ?? 0;
    return {
      at: Date.now(),
      taskDuration: metric('TaskDuration'),
      scriptDuration: metric('ScriptDuration'),
      layoutDuration: metric('LayoutDuration'),
      recalcStyleDuration: metric('RecalcStyleDuration'),
      layoutCount: metric('LayoutCount'),
      recalcStyleCount: metric('RecalcStyleCount'),
      nodes: metric('Nodes'),
      jsHeapUsed: metric('JSHeapUsedSize'),
    };
  }

  async detach(): Promise<void> {
    await this.session.detach().catch(() => undefined);
  }
}

export function mainThreadUse(before: MetricsSample, after: MetricsSample): MainThreadUse {
  const seconds = Math.max(0.001, (after.at - before.at) / 1000);
  return {
    seconds,
    busyShare: (after.taskDuration - before.taskDuration) / seconds,
    scriptShare: (after.scriptDuration - before.scriptDuration) / seconds,
    layoutShare: (after.layoutDuration - before.layoutDuration) / seconds,
    styleShare: (after.recalcStyleDuration - before.recalcStyleDuration) / seconds,
    layoutsPerSecond: (after.layoutCount - before.layoutCount) / seconds,
    styleRecalcsPerSecond: (after.recalcStyleCount - before.recalcStyleCount) / seconds,
  };
}

/** One function in a sampled CPU profile. */
export interface ProfileEntry {
  name: string;
  /** `file:line` of the function, '' for native code. */
  where: string;
  /** Self time per wall-clock second (0.1 = 10 % of one core). */
  selfShare: number;
}

export interface MainThreadProfile {
  seconds: number;
  /** Share of the sampled time the thread was idle (waiting for work). */
  idleShare: number;
  /** The busiest functions by self time (idle, program and garbage collector rows included). */
  top: ProfileEntry[];
}

/** A sampled CPU profile of the main thread of a page (DevTools `Profiler`, 1 ms interval) over `seconds`. */
export async function profileMainThread(
  context: BrowserContext,
  page: Page,
  seconds: number,
  topCount = 25,
): Promise<MainThreadProfile> {
  const session = await context.newCDPSession(page);
  try {
    await session.send('Profiler.enable');
    await session.send('Profiler.setSamplingInterval', { interval: 1000 });
    await session.send('Profiler.start');
    await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
    const { profile } = (await session.send('Profiler.stop')) as {
      profile: {
        nodes: Array<{ id: number; callFrame: { functionName: string; url: string; lineNumber: number } }>;
        samples: number[];
        timeDeltas: number[];
      };
    };
    const byId = new Map(profile.nodes.map((node) => [node.id, node.callFrame]));
    const selfMicros = new Map<string, { entry: ProfileEntry; micros: number }>();
    let total = 0;
    let idle = 0;
    profile.samples.forEach((id, index) => {
      const delta = profile.timeDeltas[index] ?? 0;
      const frame = byId.get(id);
      const name = frame?.functionName || '(anonymous)';
      const where = frame?.url ? `${frame.url.split('/').slice(-2).join('/')}:${frame.lineNumber + 1}` : '';
      const key = `${name}@${where}`;
      const row = selfMicros.get(key) ?? { entry: { name, where, selfShare: 0 }, micros: 0 };
      row.micros += delta;
      selfMicros.set(key, row);
      total += delta;
      if (name === '(idle)') idle += delta;
    });
    const wall = Math.max(1, total / 1e6);
    const top = [...selfMicros.values()]
      .sort((a, b) => b.micros - a.micros)
      .slice(0, topCount)
      .map((row) => ({ ...row.entry, selfShare: row.micros / 1e6 / wall }));
    return { seconds: wall, idleShare: idle / Math.max(1, total), top };
  } finally {
    await session.detach().catch(() => undefined);
  }
}
