import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import type { AdminApi } from '../api';
import { SESSION_COOKIE } from '../constants';
import { stackConfig, type StackConfig } from '../env';
import type { Production } from '../production';
import { RegiePage } from '../ui/regie';
import { watchContext, unexpectedConsole, type ContextWatch } from './watch';

/**
 * Smoke flows of the Regie and the output page for the browser projects (docs/testing.md E2E-DEV-19): Firefox and
 * WebKit open the stack, show the Regie, switch scenes, drag an element and a dock with the pointer, open the pairing
 * dock and read the output. Contexts are plain (no Chrome user agent, no fake media): the hooks flag and the CSP /
 * request watch are the only additions. WebKit reaches the stack as https://127.0.0.1 (the stack serves that address
 * as an extra host; "localhost" resolves to ::1 on Windows, where Docker Desktop never answers).
 */

export function baseUrlFor(browserName: string, config: StackConfig = stackConfig()): string {
  return browserName === 'webkit' ? config.baseURL.replace('//localhost', '//127.0.0.1') : config.baseURL;
}

export interface BrowserSession {
  context: BrowserContext;
  watch: ContextWatch;
  baseURL: string;
  origin: string;
  config: StackConfig;
}

export async function newBrowserContext(
  browser: Browser,
  browserName: string,
  options: { viewport?: { width: number; height: number }; cookie?: string; extra?: Parameters<Browser['newContext']>[0] } = {},
): Promise<BrowserSession> {
  const config = stackConfig();
  const baseURL = baseUrlFor(browserName, config);
  const context = await browser.newContext({
    baseURL,
    ignoreHTTPSErrors: true,
    locale: 'de-CH',
    timezoneId: 'Europe/Zurich',
    viewport: options.viewport ?? { width: 1440, height: 900 },
    ...options.extra,
  });
  await context.addInitScript(() => {
    try {
      window.localStorage.setItem('studioflow.testHooks', '1');
    } catch {
      // opaque origins have no storage
    }
  });
  const watch = await watchContext(context);
  if (options.cookie) await injectCookie(context, options.cookie, baseURL);
  return { context, watch, baseURL, origin: new URL(baseURL).origin, config };
}

/** The session cookie of an API login (`sf_session=...`) for the origin the browser uses. */
export async function injectCookie(context: BrowserContext, cookie: string, baseURL: string): Promise<void> {
  const [name, ...rest] = cookie.split('=');
  await context.addCookies([{ name: name || SESSION_COOKIE, value: rest.join('='), url: baseURL, httpOnly: true, sameSite: 'Lax' }]);
}

/** A Regie page object on the session's context, logged in by cookie. */
export async function openRegieIn(session: BrowserSession, api: AdminApi): Promise<RegiePage> {
  const page = await session.context.newPage();
  const regie = new RegiePage(page, { ...session.config, baseURL: session.baseURL });
  regie.admin = api;
  await page.goto('/');
  await regie.waitReady();
  return regie;
}

/** Console messages the browser project cannot avoid, each with its reason (recorded, not hidden). */
export interface KnownDifference {
  pattern: RegExp;
  reason: string;
}

export function consoleProblems(watch: ContextWatch, known: KnownDifference[], expectedStatuses: Array<{ status: number; pathPattern: RegExp }> = []): { unexpected: string[]; known: string[] } {
  const rest = unexpectedConsole(watch, expectedStatuses);
  const knownHits: string[] = [];
  const unexpected: string[] = [];
  for (const entry of rest) {
    const hit = known.find((difference) => difference.pattern.test(entry.text));
    if (hit) knownHits.push(`${hit.reason}: ${entry.text.slice(0, 160)}`);
    else unexpected.push(`${entry.type}: ${entry.text.slice(0, 240)} (${entry.page})`);
  }
  return { unexpected, known: knownHits };
}

export async function expectStackOnly(watch: ContextWatch, origin: string, label: string): Promise<void> {
  expect(watch.external(origin).map((request) => `${request.method} ${request.url}`), `${label}: every request goes to ${origin}`).toEqual([]);
  expect(await watch.cspViolations(), `${label}: no securitypolicyviolation`).toEqual([]);
  expect(watch.pageErrors.map((entry) => entry.text), `${label}: no uncaught error`).toEqual([]);
}

export async function loadedFontFamilies(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    await document.fonts.ready;
    return Array.from(document.fonts).filter((face) => face.status === 'loaded').map((face) => face.family.replace(/"/g, ''));
  });
}

export async function browserFacts(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(() => ({
    userAgent: navigator.userAgent,
    rtc: typeof RTCPeerConnection,
    mediaDevices: typeof navigator.mediaDevices,
    getDisplayMedia: typeof navigator.mediaDevices?.getDisplayMedia,
    resizeObserver: typeof ResizeObserver,
    pointerEvents: typeof PointerEvent,
    webAnimations: typeof Element.prototype.animate,
    containerQueries: CSS.supports('container-type: size'),
    dvh: CSS.supports('height: 100dvh'),
    hasSelector: CSS.supports('selector(:has(a))'),
    secure: window.isSecureContext,
  }));
}

export type { Production };
