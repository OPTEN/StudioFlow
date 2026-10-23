import fs from 'node:fs';
import path from 'node:path';
import type { BrowserContext, CDPSession, Page } from '@playwright/test';

/**
 * Network and resource control for browser pages (docs/testing.md 1.6/1.5): the init script, offline/cut/restore,
 * CDP throttling, route faults, CPU throttling and memory counters.
 */

const INIT_SCRIPT = fs.readFileSync(path.join(__dirname, 'browser', 'init-script.js'), 'utf8');
const CODEC = fs.readFileSync(path.join(__dirname, 'browser', 'latency-codec.js'), 'utf8');

/** Installs the init script (and the latency codec) in every page of the context. */
export async function installInitScript(context: BrowserContext): Promise<void> {
  await context.addInitScript({ content: CODEC });
  await context.addInitScript({ content: INIT_SCRIPT });
}

export const net = {
  /** `context.setOffline`: blocks new fetch/XHR/WebSocket; existing sockets stall; WebRTC media is not affected. */
  async browserOffline(context: BrowserContext, offline: boolean): Promise<void> {
    await context.setOffline(offline);
  },
  /** Offline plus closing every tracked WebSocket and RTCPeerConnection: the closest software "Wi-Fi is gone". */
  async cut(context: BrowserContext): Promise<void> {
    await context.setOffline(true);
    await Promise.all(context.pages().map((page) => page.evaluate(() => (window as unknown as { __sfNet?: { cut(): void } }).__sfNet?.cut()).catch(() => undefined)));
  },
  async restore(context: BrowserContext): Promise<void> {
    await context.setOffline(false);
  },
  /** Throttles HTTP of one page through CDP (WebSocket frames and WebRTC are not reliably affected). */
  async cdpThrottle(page: Page, profile: { latencyMs: number; downKbps: number; upKbps: number } | null): Promise<CDPSession> {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: profile?.latencyMs ?? 0,
      downloadThroughput: profile ? (profile.downKbps * 1000) / 8 : -1,
      uploadThroughput: profile ? (profile.upKbps * 1000) / 8 : -1,
    });
    return cdp;
  },
  /** Fails, delays or aborts the requests of a URL glob for one page. */
  async routeFault(page: Page, urlGlob: string | RegExp, fault: { status?: number; delayMs?: number; abort?: boolean; body?: string }): Promise<() => Promise<void>> {
    const handler = async (route: import('@playwright/test').Route) => {
      if (fault.delayMs) await new Promise((resolve) => setTimeout(resolve, fault.delayMs));
      if (fault.abort) return route.abort('connectionreset');
      if (fault.status) return route.fulfill({ status: fault.status, contentType: 'application/json', body: fault.body ?? '{}' });
      return route.continue();
    };
    await page.route(urlGlob, handler);
    return () => page.unroute(urlGlob, handler);
  },
};

export interface MemorySample {
  jsHeapUsed: number;
  nodes: number;
  listeners: number;
  documents: number;
  rtcPeerConnections: number;
  taskDurationSeconds: number;
  timestamp: number;
}

/** CDP counters after a forced garbage collection (research section 5: heap alone hides leaked DOM nodes). */
export async function sampleMemory(page: Page): Promise<MemorySample> {
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send('Performance.enable');
    await cdp.send('HeapProfiler.collectGarbage');
    await cdp.send('HeapProfiler.collectGarbage');
    const { metrics } = (await cdp.send('Performance.getMetrics')) as { metrics: Array<{ name: string; value: number }> };
    const get = (name: string) => metrics.find((metric) => metric.name === name)?.value ?? 0;
    return {
      jsHeapUsed: get('JSHeapUsedSize'),
      nodes: get('Nodes'),
      listeners: get('JSEventListeners'),
      documents: get('Documents'),
      rtcPeerConnections: get('RTCPeerConnections'),
      taskDurationSeconds: get('TaskDuration'),
      timestamp: get('Timestamp'),
    };
  } finally {
    await cdp.detach().catch(() => undefined);
  }
}

/** `Emulation.setCPUThrottlingRate`; returns the session so the caller can reset it. */
export async function throttleCpu(page: Page, rate: number): Promise<CDPSession> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate });
  return cdp;
}
