import type { BrowserContext, Page } from '@playwright/test';
import { AdminApi } from '../../support/api';
import { LIMITS, SESSION_COOKIE } from '../../support/constants';
import { t } from '../../support/tags';
import { newUiContext } from '../../support/ui';
import { expect, test } from '../../support/ui/fixtures';
import { RegiePage } from '../../support/ui/regie';
import { randomClientIp, recordRequests } from '../../support/regie/kit';

/**
 * The login, the session and the presence of the Regie in the browser (docs/testing.md 2.1: E2E-AUTH-01 ... 05, 25, 26). The
 * API level (cookie flags, lockout counters, revocation, CSRF) is covered in specs/auth; these tests drive the form, the
 * redirects and what two browsers see. Every context has a client address of its own (support/ui/init.ts), so failed
 * logins never lock another test out.
 */

test.use({ viewport: { width: 1440, height: 900 } });

const WRONG = 'Wrong username or password.';
/**
 * Failed logins use an unknown user name: failures with the admin's own name also count towards the per-user lock (20 per
 * 15 minutes, spec 5), which would lock the harness out of its own login for a quarter of an hour. The per-address lock
 * (5 failures) counts every name, so the lockout test needs no real one either.
 */
/** A user name that was never used: the per-user lock counts unknown names as well, across test runs (15 minutes). */
const strangerName = () => `nobody-${Math.random().toString(36).slice(2, 10)}`;

async function cookieOf(context: BrowserContext, baseURL: string) {
  return (await context.cookies(baseURL)).find((cookie) => cookie.name === SESSION_COOKIE);
}

test.describe('REGIE login and session', () => {
  test(
    'E2E-AUTH-01 [regie ui] an unauthenticated visit lands on the login form; signing in opens the Regie with the production and a clock; the session cookie is httpOnly, Secure, SameSite=Strict',
    t.smoke,
    async ({ browser, config, production, onCleanup }) => {
      const context = await newUiContext(browser);
      onCleanup(() => context.close());
      const regie = new RegiePage(await context.newPage(), config);
      const page = regie.page;
      await page.goto('/');
      await expect(page).toHaveURL(/\/login$/);
      await expect(page.getByRole('heading', { name: /StudioFlow/ })).toBeVisible();
      await expect(page.getByLabel('Username')).toBeVisible();
      await expect(page.getByLabel('Password')).toHaveAttribute('type', 'password');
      expect(
        await cookieOf(context, config.baseURL),
        'no cookie before signing in',
      ).toBeUndefined();

      const started = Date.now();
      expect(await regie.submitLoginForm(config.admin)).toBe(200);
      await page.waitForURL((url) => url.pathname === '/');
      await regie.waitReady();
      const loadMs = Date.now() - started;
      test.info().annotations.push({
        type: 'measurement',
        description: `T-LOAD: submit -> Regie ready ${loadMs} ms (cold, includes the login request)`,
      });
      expect(
        loadMs,
        'hard limit 3 s (T-LOAD) on an idle machine; the harness allows 10 s',
      ).toBeLessThan(10_000);

      const cookie = (await cookieOf(context, config.baseURL))!;
      expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Strict', path: '/' });
      expect(
        await page.evaluate(() => document.cookie),
        'the script cannot read the session',
      ).not.toContain(SESSION_COOKIE);
      await expect(page.locator('.c-prod__name')).toHaveText(production.name);
      await expect(page.locator('.c-header__clock')).toHaveText(/^\d{2}:\d{2}:\d{2}$/);
      await expect(page.locator('.c-header__brand')).toContainText('StudioFlow');
      expect(regie.problems.pageErrors).toEqual([]);
      expect(regie.problems.cspViolations).toEqual([]);
    },
  );

  test(
    'E2E-AUTH-02 [regie ui] a wrong password and an unknown user show the same message, no cookie, and keep the form',
    t.p1,
    async ({ browser, config, onCleanup }) => {
      const context = await newUiContext(browser, { clientIp: randomClientIp() });
      onCleanup(() => context.close());
      const regie = new RegiePage(await context.newPage(), config);
      const page = regie.page;
      await page.goto('/login');
      // Wrong password.
      expect(
        await regie.submitLoginForm({
          username: config.admin.username,
          password: 'wrong-password-1',
        }),
      ).toBe(401);
      await expect(regie.loginError()).toHaveText(WRONG);
      await expect(page).toHaveURL(/\/login$/);
      // Unknown user.
      expect(
        await regie.submitLoginForm({ username: strangerName(), password: 'wrong-password-2' }),
      ).toBe(401);
      await expect(regie.loginError(), 'the same text for both cases').toHaveText(WRONG);
      await expect(page.getByRole('alert')).toContainText(WRONG);
      await expect(page.getByLabel('Password'), 'the password is cleared').toHaveValue('');
      await expect(
        page.getByRole('button', { name: 'Sign in' }),
        'the form stays usable',
      ).toBeEnabled();
      expect(await cookieOf(context, config.baseURL), 'no session cookie').toBeUndefined();
      // Empty fields: a hint, no request.
      const posts = recordRequests(
        page,
        (path, method) => method === 'POST' && path === '/api/auth/login',
      );
      await page.getByLabel('Username').fill('');
      await page.getByRole('button', { name: 'Sign in' }).click();
      await expect(regie.loginError()).toHaveText('Please enter your username and password.');
      expect(posts).toHaveLength(0);
      expect(regie.problems.pageErrors).toEqual([]);
    },
  );

  test(
    'E2E-AUTH-02 [regie ui, focus] after a failed login the focus returns to the password field',
    t.p1,
    async ({ browser, config, onCleanup }) => {
      const context = await newUiContext(browser, { clientIp: randomClientIp() });
      onCleanup(() => context.close());
      const regie = new RegiePage(await context.newPage(), config);
      await regie.page.goto('/login');
      expect(
        await regie.submitLoginForm({
          username: strangerName(),
          password: 'wrong-password-3',
        }),
      ).toBe(401);
      await expect(regie.loginError()).toHaveText(WRONG);
      await expect(
        regie.page.getByLabel('Password'),
        'the password field has the focus again',
      ).toBeFocused({ timeout: 2000 });
    },
  );

  test(
    'E2E-AUTH-03 [regie ui, lockout] the fifth wrong login shows the lock message with the remaining minutes and disables the form; the right password is refused with Retry-After; another address is not affected',
    t.p1,
    async ({ browser, config, onCleanup }) => {
      const ip = randomClientIp();
      const locked = await newUiContext(browser, { clientIp: ip });
      const bystander = await newUiContext(browser, { clientIp: randomClientIp() });
      onCleanup(() => locked.close());
      onCleanup(() => bystander.close());
      const regie = new RegiePage(await locked.newPage(), config);
      const page = regie.page;
      await page.goto('/login');
      const stranger = { username: strangerName(), password: 'wrong-password-9' };
      for (let attempt = 1; attempt < LIMITS.loginFailuresPerIp; attempt++) {
        expect(await regie.submitLoginForm(stranger), `failure ${attempt}`).toBe(401);
        await expect(regie.loginError()).toHaveText(WRONG);
      }
      expect(await regie.submitLoginForm(stranger), 'the fifth failure starts the lock').toBe(429);
      await expect(regie.loginError()).toContainText(
        /Too many failed attempts\. Please try again in \d+ minutes?\./,
      );
      await expect(regie.loginError()).toContainText(/\d+ minutes?/);
      await expect(page.getByRole('button', { name: 'Sign in' })).toBeDisabled();
      expect(await cookieOf(locked, config.baseURL)).toBeUndefined();

      // The right password does not help while the address is locked (REST with the same client address).
      const retry = await new AdminApi(config.apiDirect, '', ip).login(
        config.admin.username,
        config.admin.password,
      );
      expect(retry.status).toBe(429);
      expect(
        Number(retry.headers['retry-after']),
        'Retry-After in seconds, at most 15 minutes',
      ).toBeGreaterThan(0);
      expect(Number(retry.headers['retry-after'])).toBeLessThanOrEqual(LIMITS.loginLockoutSeconds);

      // Another client address logs in normally.
      const other = new RegiePage(await bystander.newPage(), config);
      await other.loginViaUi();
      expect(new URL(other.page.url()).pathname).toBe('/');
      expect(regie.problems.pageErrors).toEqual([]);
    },
  );

  test(
    'E2E-AUTH-04 [regie ui] logout in one tab: that tab goes to the login form, the session is dead on the server, the other tab leaves the Regie within 10 s without reconnecting forever, back does not show the Regie',
    t.p1,
    async ({ browser, config, production, onCleanup }) => {
      void production;
      const context = await newUiContext(browser);
      onCleanup(() => context.close());
      const first = await RegiePage.open(context, { login: 'ui', config });
      const second = new RegiePage(await context.newPage(), config);
      await second.page.goto('/');
      await second.waitReady();
      const cookie = (await cookieOf(context, config.baseURL))!;
      const probe = new AdminApi(config.baseURL, `${cookie.name}=${cookie.value}`);
      expect((await probe.getSession()).status, 'the session is valid before').toBe(200);
      const negotiates = recordRequests(second.page, (path) =>
        path.startsWith('/hubs/studio/negotiate'),
      );

      await first.page.getByRole('button', { name: /^Production .*, menu$/ }).click();
      await first.page.getByRole('button', { name: 'Sign out' }).click();
      const loggedOutAt = Date.now();
      await expect(first.page).toHaveURL(/\/login$/);
      expect((await probe.getSession()).status, 'the old cookie is dead on the server').toBe(401);

      await expect(second.page, 'the second tab leaves the Regie').toHaveURL(/\/login/, {
        timeout: 10_000,
      });
      test.info().annotations.push({
        type: 'measurement',
        description: `second tab on /login ${Date.now() - loggedOutAt} ms after the logout; ${negotiates.length} negotiate attempts`,
      });
      await second.page.waitForTimeout(3000);
      expect(
        negotiates.length,
        'no endless reconnect: at most 3 negotiate attempts',
      ).toBeLessThanOrEqual(3);
      await expect(second.page.locator('sf-studio-page')).toHaveCount(0);

      // Back does not show Regie content.
      await first.page.goBack();
      await first.page.waitForLoadState('domcontentloaded');
      await expect(first.page).toHaveURL(/\/login/);
      await expect(first.page.locator('sf-studio-page')).toHaveCount(0);
      await expect(first.page.getByLabel('Username')).toBeVisible();
      expect(first.problems.pageErrors).toEqual([]);
    },
  );

  test(
    'E2E-AUTH-05 [regie ui] protected pages redirect to the login form before any Regie data is requested; the target is remembered for in-app paths only',
    t.p0,
    async ({ browser, config, onCleanup }) => {
      const context = await newUiContext(browser);
      onCleanup(() => context.close());
      const regie = new RegiePage(await context.newPage(), config);
      const page = regie.page;
      const requests = recordRequests(
        page,
        (path) => path.startsWith('/api/') || path.startsWith('/hubs/'),
      );
      for (const target of ['/', '/monitoring', '/some/deep/link']) {
        await page.goto(target);
        await expect(page, `${target} -> login`).toHaveURL(/\/login/);
        await expect(page.locator('sf-studio-page')).toHaveCount(0);
        await expect(page.locator('sf-monitoring-page')).toHaveCount(0);
      }
      expect(
        requests.map((entry) => entry.path).filter((path) => !['/api/auth/me', '/api/auth/setup'].some((allowed) => path.startsWith(allowed))),
        'nothing but the session check and the setup status was requested',
      ).toEqual([]);
      expect(requests.length).toBeGreaterThan(0);

      // The target of a protected page is remembered: after login the operator lands there.
      await page.goto('/monitoring');
      await expect(page).toHaveURL(/\/login\?next=%2Fmonitoring$/);
      expect(await regie.submitLoginForm(config.admin)).toBe(200);
      await expect(page).toHaveURL(/\/monitoring$/);
      await expect(page.getByRole('heading', { name: 'Monitoring' })).toBeVisible();

      // Unsafe next values are ignored (no open redirect); a signed-in operator opening /login goes straight to the Regie.
      for (const unsafe of [
        '//evil.example/x',
        'https://evil.example/',
        '/login',
        'javascript:alert(1)',
      ]) {
        const fresh = await newUiContext(browser);
        onCleanup(() => fresh.close());
        const view = new RegiePage(await fresh.newPage(), config);
        await view.page.goto(`/login?next=${encodeURIComponent(unsafe)}`);
        expect(await view.submitLoginForm(config.admin)).toBe(200);
        await expect(view.page, `next=${unsafe}`).toHaveURL(
          (url) => url.pathname === '/' && url.origin === new URL(config.baseURL).origin,
        );
      }
      await page.goto('/login');
      await expect(page, 'a valid session skips the form').toHaveURL(/\/$/);
    },
  );

  test(
    'E2E-AUTH-25 [regie ui] two operators: both stay signed in across a reload, both see the presence count 2, closing one brings the other back to one within 8 s',
    t.p2,
    async ({ openRegie }) => {
      const first = await openRegie({ login: 'ui' });
      const second = await openRegie({ login: 'ui' });
      const label = (page: Page) => page.locator('.c-header__presence-count');
      const reader = (page: Page) => page.locator('.c-header__presence .u-sr-only');
      await expect(label(first.page)).toHaveText('2', { timeout: 8000 });
      await expect(label(second.page)).toHaveText('2', { timeout: 8000 });
      await expect(reader(first.page), 'screen readers get the full sentence').toHaveText(
        '2 people in the control room',
      );

      await first.page.reload();
      await first.waitReady();
      await second.page.reload();
      await second.waitReady();
      expect(new URL(first.page.url()).pathname).toBe('/');
      expect(new URL(second.page.url()).pathname).toBe('/');
      await expect(label(first.page)).toHaveText('2', { timeout: 8000 });

      const closed = Date.now();
      await second.page.context().close();
      await expect(label(first.page)).toHaveText('1', { timeout: 8000 });
      await expect(reader(first.page)).toHaveText('One person in the control room');
      test.info().annotations.push({
        type: 'measurement',
        description: `presence went back to 1 after ${Date.now() - closed} ms`,
      });
      expect(first.problems.pageErrors).toEqual([]);
    },
  );

  test(
    'E2E-AUTH-26 [regie ui] the session cookie vanishes while the Regie is open: the next action leads to the login form within 10 s, the hub does not retry forever, no uncaught error',
    t.p1,
    async ({ browser, config, production, onCleanup }) => {
      void production;
      const context = await newUiContext(browser);
      onCleanup(() => context.close());
      const regie = await RegiePage.open(context, { login: 'ui', config });
      const page = regie.page;
      const negotiates = recordRequests(page, (path) => path.startsWith('/hubs/studio/negotiate'));
      await context.clearCookies();
      const start = Date.now();
      // An action: switch to another scene.
      await regie.scene('Presentation').click();
      await expect(page, 'back on the login form within 10 s').toHaveURL(/\/login/, {
        timeout: 10_000,
      });
      test.info().annotations.push({
        type: 'measurement',
        description: `login form ${Date.now() - start} ms after the first rejected action; ${negotiates.length} negotiate attempts`,
      });
      await page.waitForTimeout(3000);
      expect(
        negotiates.filter((entry) => entry.status === 401 || entry.status === 403).length,
        'at most 3 refused negotiate attempts',
      ).toBeLessThanOrEqual(3);
      expect(regie.problems.pageErrors, 'no uncaught exception').toEqual([]);
      await expect(page.getByLabel('Username')).toBeVisible();
    },
  );
});
