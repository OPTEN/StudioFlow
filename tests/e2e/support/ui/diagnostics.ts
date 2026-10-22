import type { Page } from '@playwright/test';

/**
 * What a page reports while a UI test runs (docs/testing.md E2E-AUTH-14: no CSP violation, no console error beyond
 * logged network errors): uncaught errors, console errors and warnings, `securitypolicyviolation` events and
 * requests that failed or came back with a 5xx status.
 */
export interface PageProblems {
  pageErrors: string[];
  consoleErrors: string[];
  cspViolations: string[];
  failedRequests: string[];
  serverErrors: string[];
  /** Everything above in one list (for a failure message). */
  all(): string[];
  clear(): void;
}

/** Starts collecting on a page. Call it before the first navigation; the listeners live as long as the page. */
export function watchPage(page: Page): PageProblems {
  const problems: PageProblems = {
    pageErrors: [],
    consoleErrors: [],
    cspViolations: [],
    failedRequests: [],
    serverErrors: [],
    all: () => [
      ...problems.pageErrors.map((text) => `pageerror: ${text}`),
      ...problems.consoleErrors.map((text) => `console.error: ${text}`),
      ...problems.cspViolations.map((text) => `csp: ${text}`),
      ...problems.failedRequests.map((text) => `requestfailed: ${text}`),
      ...problems.serverErrors.map((text) => `5xx: ${text}`),
    ],
    clear: () => {
      problems.pageErrors.length = 0;
      problems.consoleErrors.length = 0;
      problems.cspViolations.length = 0;
      problems.failedRequests.length = 0;
      problems.serverErrors.length = 0;
    },
  };
  page.on('pageerror', (error) => problems.pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (/Content Security Policy|Refused to (?:frame|load|execute|connect)/i.test(text))
      problems.cspViolations.push(text);
    else problems.consoleErrors.push(text);
  });
  page.on('requestfailed', (request) => {
    // Cancelled navigations and replaced requests are not failures of the product.
    const reason = request.failure()?.errorText ?? '';
    if (!/ERR_ABORTED|NS_BINDING_ABORTED|cancelled/i.test(reason))
      problems.failedRequests.push(`${request.method()} ${request.url()} ${reason}`);
  });
  page.on('response', (response) => {
    if (response.status() >= 500)
      problems.serverErrors.push(
        `${response.status()} ${response.request().method()} ${response.url()}`,
      );
  });
  return problems;
}
