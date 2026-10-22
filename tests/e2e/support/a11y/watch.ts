import type { BrowserContext, Page } from '@playwright/test';

/**
 * Collects what every page of a context does (task: no CSP violation anywhere, no request to any external host, no
 * console error): all requests with their origin, WebSockets, responses with a 4xx/5xx status, console errors and
 * warnings, `securitypolicyviolation` events and uncaught errors. One watch per context, attached before the first
 * navigation.
 */

export interface WatchedRequest {
  url: string;
  method: string;
  type: string;
  page: string;
}

export interface ContextWatch {
  requests: WatchedRequest[];
  sockets: string[];
  badResponses: Array<{ url: string; status: number; method: string; page: string }>;
  consoleErrors: Array<{ text: string; page: string; type: string }>;
  pageErrors: Array<{ text: string; page: string }>;
  failures: Array<{ url: string; reason: string; page: string }>;
  /** `securitypolicyviolation` events read from the pages. */
  cspViolations(): Promise<string[]>;
  /** Requests whose origin is not `origin` (http, https, ws, wss only; data: and blob: stay in the page). */
  external(origin: string): WatchedRequest[];
  pages: Page[];
}

const CSP_INIT = `
(() => {
  if (window.__fsCspLog) return;
  window.__fsCspLog = [];
  document.addEventListener('securitypolicyviolation', (event) => {
    window.__fsCspLog.push(event.violatedDirective + ' blocked ' + event.blockedURI + ' on ' + event.documentURI);
  });
})();
`;

export async function watchContext(context: BrowserContext): Promise<ContextWatch> {
  await context.addInitScript({ content: CSP_INIT });
  const watch: ContextWatch = {
    requests: [],
    sockets: [],
    badResponses: [],
    consoleErrors: [],
    pageErrors: [],
    failures: [],
    pages: [],
    cspViolations: async () => {
      const found: string[] = [];
      for (const page of watch.pages) {
        if (page.isClosed()) continue;
        const log = await page.evaluate(() => (window as unknown as { __fsCspLog?: string[] }).__fsCspLog ?? []).catch(() => []);
        found.push(...log);
      }
      return found;
    },
    external: (origin) =>
      watch.requests.filter((request) => {
        if (!/^(https?|wss?):/.test(request.url)) return false;
        return new URL(request.url).origin !== origin;
      }),
  };
  const attach = (page: Page) => {
    watch.pages.push(page);
    const label = () => page.url().replace(/\?.*$/, '');
    page.on('request', (request) => watch.requests.push({ url: request.url(), method: request.method(), type: request.resourceType(), page: label() }));
    page.on('websocket', (socket) => {
      watch.sockets.push(socket.url());
      watch.requests.push({ url: socket.url().replace(/^ws/, 'http'), method: 'WS', type: 'websocket', page: label() });
    });
    page.on('response', (response) => {
      if (response.status() >= 400) watch.badResponses.push({ url: response.url(), status: response.status(), method: response.request().method(), page: label() });
    });
    page.on('requestfailed', (request) => {
      const reason = request.failure()?.errorText ?? '';
      if (!/ERR_ABORTED|NS_BINDING_ABORTED|cancelled/i.test(reason)) watch.failures.push({ url: request.url(), reason, page: label() });
    });
    page.on('console', (message) => {
      if (message.type() === 'error' || message.type() === 'warning') watch.consoleErrors.push({ text: message.text(), page: label(), type: message.type() });
    });
    page.on('pageerror', (error) => watch.pageErrors.push({ text: error.message, page: label() }));
  };
  for (const page of context.pages()) attach(page);
  context.on('page', attach);
  return watch;
}

/** Console messages that are the browser's own report of a response with a status the test expects (listed by the caller). */
export function unexpectedConsole(watch: ContextWatch, allowedStatuses: Array<{ status: number; pathPattern: RegExp }>): Array<{ text: string; page: string; type: string }> {
  const allowedCount = watch.badResponses.filter((response) => allowedStatuses.some((entry) => entry.status === response.status && entry.pathPattern.test(new URL(response.url).pathname))).length;
  let budget = allowedCount;
  return watch.consoleErrors.filter((entry) => {
    if (/Failed to load resource: the server responded with a status of (\d{3})/.test(entry.text) && budget > 0) {
      budget -= 1;
      return false;
    }
    return true;
  });
}
