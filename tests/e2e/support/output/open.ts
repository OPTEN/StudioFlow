import type { Browser, BrowserContext, Page } from '@playwright/test';
import type { AdminApi } from '../api';
import type { Production } from '../production';
import { newUiContext, type NewUiContextOptions } from '../ui/init';
import { OutputPage, type EmbedOptions, type OutputFlags, type OutputTarget } from '../ui/output';
import { OutputProbe, installProbe } from './probe';

/** An output page with the probe installed (direct, or inside an iframe on a fake origin). */
export interface ProbedOutput {
  output: OutputPage;
  probe: OutputProbe;
  context: BrowserContext;
}

export interface OpenOptions {
  /** Open inside an iframe on `https://embed.test` (or `embed.origin`) with these embed options. */
  embed?: Omit<EmbedOptions, keyof OutputFlags>;
  /** Options of the browser context (device scale factor, viewport, ...). */
  context?: NewUiContextOptions;
  /** Viewport of a direct page (default 1920 x 1080 so the stage is not scaled). */
  viewport?: { width: number; height: number };
  /** Called for every page the context opens, before it navigates (listeners for requests, sockets, console). */
  onPage?: (page: Page) => void;
}

/**
 * Opens the output of a production in a context of its own, with the probe installed before the first navigation.
 * The context is closed after the test (`onCleanup`).
 */
export async function openProbedOutput(
  fx: { browser: Browser; onCleanup: (fn: () => Promise<unknown> | unknown) => void },
  target: OutputTarget,
  flags: OutputFlags = {},
  options: OpenOptions = {},
): Promise<ProbedOutput> {
  const context = await newUiContext(fx.browser, options.context);
  fx.onCleanup(() => context.close());
  await installProbe(context);
  if (options.onPage) context.on('page', options.onPage);
  const output = options.embed
    ? await OutputPage.embed(context, target, { ...flags, ...options.embed })
    : await OutputPage.open(context, target, flags, { viewport: options.viewport ?? { width: 1920, height: 1080 } });
  return { output, probe: new OutputProbe(output), context };
}

/**
 * Waits until an output page reports a picture on screen (`outputStatus`: connected, with a latency estimate, which only
 * exists with a subscribed source, and a frame rate above 0, which is the rate at which the busiest video presents frames
 * since issue #12 and so exists only once a video plays) without ever talking to the output's frame or taking a
 * screenshot of it. A subscription alone is not a picture: on a busy computer the first frame comes a moment later. Playwright
 * counts `evaluate()` (and, in an iframe, screenshots) as user gestures of the page, so this is how a test can ask
 * afterwards whether autoplay needed one (`probe.activationAtFirstPlay()`).
 */
export async function waitForReportedPicture(api: AdminApi, production: Pick<Production, 'id'>, timeoutMs = 45_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const status = (await api.getSnapshot(production.id)).body.outputStatus;
    if (status.state === 'connected' && status.latencyMs !== null && (status.fps ?? 0) > 0) break;
    if (Date.now() > deadline) throw new Error(`the output did not report a picture within ${timeoutMs} ms: ${JSON.stringify(status)}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  await new Promise((resolve) => setTimeout(resolve, 1500));
}

/** One message of the SignalR JSON protocol (type 1 = invocation, 3 = completion, 6 = ping ...). */
export interface HubMessage {
  /** Epoch ms of the frame. */
  t: number;
  type?: number;
  target?: string;
  arguments?: unknown[];
  [key: string]: unknown;
}

/** Records the SignalR frames a page sends and receives on a hub path (the output page's hub by default). */
export function recordHubFrames(page: Page, path = '/hubs/output'): { sent: HubMessage[]; received: HubMessage[] } {
  const sent: HubMessage[] = [];
  const received: HubMessage[] = [];
  const parse = (payload: string | Buffer, into: HubMessage[]) => {
    const text = typeof payload === 'string' ? payload : payload.toString('utf8');
    for (const part of text.split('')) {
      if (!part) continue;
      try {
        into.push({ t: Date.now(), ...(JSON.parse(part) as object) });
      } catch {
        // a partial frame or the handshake: not interesting
      }
    }
  };
  page.on('websocket', (socket) => {
    if (!socket.url().includes(path)) return;
    socket.on('framesent', (event) => parse(event.payload, sent));
    socket.on('framereceived', (event) => parse(event.payload, received));
  });
  return { sent, received };
}
