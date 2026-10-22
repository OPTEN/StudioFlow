import { expect, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { AdminApi } from '../api';
import { SESSION_COOKIE } from '../constants';
import { stackConfig, type StackConfig } from '../env';
import { watchPage, type PageProblems } from './diagnostics';
import { decodeQr, PixelImage } from './pixels';

/**
 * Page object of the Regie (`apps/studio`, docs/testing.md 1.5 and 1.7): login through the UI or by injecting the
 * session cookie of an API login, waiting until the hub is live, reading state through `window.__fsStudio` and through
 * the API, and the actions the pairing, switching and station tests need. Locators prefer roles and German labels;
 * `data-testid` hooks are used where the product has them.
 *
 * The read-only state view `window.__fsStudio` only exists with `localStorage['flowstudio.testHooks'] = '1'` (set by
 * `installUiInit`, support/ui/init.ts).
 */

/** Shape of `window.__fsStudio` (docs/testing.md 1.7). */
export interface StudioHooks {
  revision: number | null;
  lastSync: 'delta' | 'snapshot' | null;
  /** HubState of the realtime client. */
  hub: string;
}

export type PairingTab = 'phone' | 'laptop' | 'link';

const TAB_LABEL: Record<PairingTab, string> = { phone: 'Handy', laptop: 'Laptop', link: 'Link' };

/** `fs_session=value` to a cookie for `context.addCookies`. */
function sessionCookie(cookie: string, baseURL: string) {
  const [name, ...rest] = cookie.split('=');
  return {
    name: name || SESSION_COOKIE,
    value: rest.join('='),
    url: baseURL,
    httpOnly: true,
    sameSite: 'Lax' as const,
  };
}

export class RegiePage {
  readonly problems: PageProblems;
  /** Admin API client bound to the session of this Regie (undefined when the Regie logged in through the UI only). */
  admin: AdminApi | undefined;

  constructor(
    readonly page: Page,
    readonly config: StackConfig = stackConfig(),
  ) {
    this.problems = watchPage(page);
  }

  // --- opening ----------------------------------------------------------------------------------------------------

  /** Installs a session cookie (the value of `AdminApi.cookie`, `fs_session=...`) in a context: no login screen needed. */
  static async injectSession(
    context: BrowserContext,
    cookie: string,
    config: StackConfig = stackConfig(),
  ): Promise<void> {
    await context.addCookies([sessionCookie(cookie, config.baseURL)]);
  }

  /**
   * Opens the Regie in a new page of the context, logged in by cookie injection (default; pass the cookie of an
   * existing admin session to save a login, else one is made through the API) or through the login form.
   */
  static async open(
    context: BrowserContext,
    options: {
      login?: 'api' | 'ui';
      cookie?: string;
      waitReady?: boolean;
      config?: StackConfig;
    } = {},
  ): Promise<RegiePage> {
    const config = options.config ?? stackConfig();
    const regie = new RegiePage(await context.newPage(), config);
    if ((options.login ?? 'api') === 'ui') {
      await regie.loginViaUi();
    } else {
      await regie.loginViaApi(options.cookie);
      await regie.page.goto('/');
    }
    if (options.waitReady ?? true) await regie.waitReady();
    return regie;
  }

  /** Login form: «Benutzername», «Passwort», «Anmelden»; resolves when the Regie route is reached. */
  async loginViaUi(
    credentials: { username: string; password: string } = this.config.admin,
  ): Promise<void> {
    await this.submitLoginForm(credentials);
    await this.page.waitForURL((url) => !url.pathname.startsWith('/login'));
    // The API client of the test shares the session the browser just got.
    const cookie = (await this.page.context().cookies(this.config.baseURL)).find(
      (entry) => entry.name === SESSION_COOKIE,
    );
    if (cookie) this.admin = new AdminApi(this.config.baseURL, `${cookie.name}=${cookie.value}`);
  }

  /**
   * Fills and submits the login form (opens `/login` first when the page is somewhere else) and resolves with the HTTP
   * status of the login request; the page shows the result (error line, or the Regie after a success).
   */
  async submitLoginForm(credentials: { username: string; password: string }): Promise<number> {
    if (!new URL(this.page.url(), this.config.baseURL).pathname.startsWith('/login')) {
      await this.page.goto('/login');
    }
    await this.page.getByLabel('Benutzername').fill(credentials.username);
    await this.page.getByLabel('Passwort').fill(credentials.password);
    const [response] = await Promise.all([
      this.page.waitForResponse(
        (candidate) =>
          candidate.url().endsWith('/api/auth/login') && candidate.request().method() === 'POST',
      ),
      this.page.getByRole('button', { name: 'Anmelden' }).click(),
    ]);
    return response.status();
  }

  /** The error line of the login form (wrong credentials, lockout). */
  loginError(): Locator {
    return this.page.locator('.c-login__error');
  }

  /** Cookie injection: logs in through the API (or takes `cookie`) and sets the session cookie in the browser context. */
  async loginViaApi(cookie?: string): Promise<AdminApi> {
    const admin = cookie
      ? new AdminApi(this.config.baseURL, cookie)
      : await AdminApi.login(this.config.baseURL, this.config.admin);
    await RegiePage.injectSession(this.page.context(), admin.cookie, this.config);
    this.admin = admin;
    return admin;
  }

  async goto(path = '/'): Promise<void> {
    await this.page.goto(path);
  }

  // --- readiness and state -----------------------------------------------------------------------------------------

  /** Reads `window.__fsStudio`; null when the hooks are off or the Regie has not started. */
  async hooks(): Promise<StudioHooks | null> {
    return this.page.evaluate(() => {
      const view = (window as unknown as { __fsStudio?: Record<string, unknown> }).__fsStudio;
      if (!view) return null;
      const read = (value: unknown) =>
        typeof value === 'function' ? (value as () => unknown)() : value;
      return {
        revision: (read(view['revision']) as number | null) ?? null,
        lastSync: (read(view['lastSync']) as 'delta' | 'snapshot' | null) ?? null,
        hub: String(read(view['hub'])),
      };
    });
  }

  /**
   * What the page says about itself: the hook if it exists, else the `data-testid` markers, else what the DOM shows
   * (stations and scenes rendered, no connection banner). `source` tells which one answered.
   */
  async readiness(): Promise<{
    ready: boolean;
    source: 'hooks' | 'testid' | 'dom';
    detail: string;
  }> {
    return this.page.evaluate(() => {
      const read = (value: unknown) =>
        typeof value === 'function' ? (value as () => unknown)() : value;
      const view = (window as unknown as { __fsStudio?: Record<string, unknown> }).__fsStudio;
      if (view) {
        const hub = String(read(view['hub']));
        const revision = read(view['revision']);
        return {
          ready: hub === 'connected' && typeof revision === 'number' && revision >= 0,
          source: 'hooks' as const,
          detail: `hub ${hub}, revision ${String(revision)}`,
        };
      }
      const marker = document.querySelector('[data-testid=regie-ready]');
      const connection = document.querySelector<HTMLElement>('[data-testid=connection-state]');
      if (marker || connection) {
        const state = connection?.dataset['state'] ?? 'unknown';
        return {
          ready: Boolean(marker) && (state === 'connected' || state === 'unknown'),
          source: 'testid' as const,
          detail: `regie-ready ${Boolean(marker)}, connection ${state}`,
        };
      }
      const page = document.querySelector('fs-studio-page');
      const loading = [...document.querySelectorAll('.c-empty strong')].some((element) =>
        /werden geladen/.test(element.textContent ?? ''),
      );
      const banner = document.querySelector('.c-status__net');
      const scenes = document.querySelectorAll('button.c-scene[aria-pressed]').length;
      return {
        ready: Boolean(page) && !loading && !banner && scenes > 0,
        source: 'dom' as const,
        detail: `page ${Boolean(page)}, loading ${loading}, banner ${Boolean(banner)}, scenes ${scenes}`,
      };
    });
  }

  /** Waits until the Regie shows the production and its hub is live. Resolves with the answer that made it ready. */
  async waitReady(
    timeout = 30_000,
  ): Promise<{ source: 'hooks' | 'testid' | 'dom'; detail: string }> {
    let last: Awaited<ReturnType<RegiePage['readiness']>> | undefined;
    await expect
      .poll(
        async () => {
          last = await this.readiness().catch(() => undefined);
          return last?.ready ?? false;
        },
        {
          timeout,
          intervals: [100, 250, 500],
          message: 'the Regie is ready (hub connected, production rendered)',
        },
      )
      .toBe(true);
    return { source: last!.source, detail: last!.detail };
  }

  /** Waits until the hub reports `state` (needs the hooks). */
  async waitForHub(state: string, timeout = 30_000): Promise<void> {
    await expect
      .poll(async () => (await this.hooks())?.hub, { timeout, message: `hub state ${state}` })
      .toBe(state);
  }

  /** Waits until the Regie has applied revision `atLeast` (hooks; else the API snapshot is compared by the caller). */
  async waitForRevision(atLeast: number, timeout = 15_000): Promise<number> {
    await expect
      .poll(async () => (await this.hooks())?.revision ?? -1, {
        timeout,
        message: `revision >= ${atLeast}`,
      })
      .toBeGreaterThanOrEqual(atLeast);
    return (await this.hooks())!.revision!;
  }

  /** The revision the server holds for a production (API), to compare with what the Regie shows. */
  async serverRevision(productionId: string): Promise<number> {
    return (await this.requireAdmin().getSnapshot(productionId)).body.revision;
  }

  /** Waits until the Regie's revision equals the server's (the UI converged). */
  async waitForConvergence(productionId: string, timeout = 15_000): Promise<number> {
    await expect
      .poll(
        async () =>
          ((await this.hooks())?.revision ?? -1) - (await this.serverRevision(productionId)),
        { timeout, message: 'the Regie converged to the server revision' },
      )
      .toBe(0);
    return this.serverRevision(productionId);
  }

  requireAdmin(): AdminApi {
    if (!this.admin)
      throw new Error(
        'this Regie has no API client: log in with loginViaApi() or loginViaUi() first',
      );
    return this.admin;
  }

  // --- scenes and switching ----------------------------------------------------------------------------------------

  /** A scene button («Präsentation», aria-pressed; the accessible name may add «, live im Program» etc.). */
  scene(name: string): Locator {
    return this.page
      .getByRole('button', { name: new RegExp(`^${escapeRegExp(name)}(,|$)`) })
      .and(this.page.locator('[aria-pressed]'));
  }

  async clickScene(name: string): Promise<void> {
    await this.scene(name).click();
  }

  studioModeSwitch(): Locator {
    return this.page.getByRole('switch', { name: 'Studio-Modus' });
  }

  async setStudioMode(on: boolean): Promise<void> {
    const toggle = this.studioModeSwitch();
    if ((await toggle.isChecked()) !== on) await toggle.setChecked(on);
  }

  /** «Take» (only in Studio-Modus). */
  take(): Locator {
    return this.page.getByRole('button', { name: /^Take/ });
  }

  transitionOption(kind: 'Schnitt' | 'Blende'): Locator {
    return this.page
      .getByRole('group', { name: 'Art des Übergangs' })
      .getByRole('button', { name: kind });
  }

  // --- stations and pairing ----------------------------------------------------------------------------------------

  /** A station row by slot code («K1», «S1») or device name. */
  station(codeOrName: string): Locator {
    return this.page.locator('.c-st[data-device]').filter({ hasText: codeOrName });
  }

  /** Waits for the station row of a freshly paired device and returns it. */
  async waitForStation(codeOrName: string, timeout = 15_000): Promise<Locator> {
    const row = this.station(codeOrName).first();
    await expect(row, `station ${codeOrName} appears in the Stationen dock`).toBeVisible({
      timeout,
    });
    return row;
  }

  pairButton(): Locator {
    return this.page.getByRole('button', { name: 'Gerät koppeln', exact: true });
  }

  pairingDock(): Locator {
    return this.page.locator('#fs-pairing-dock');
  }

  pairingTab(tab: PairingTab): Locator {
    return this.page.getByRole('tab', { name: TAB_LABEL[tab] });
  }

  /** Opens the pairing dock («Gerät koppeln») on a tab (Handy | Laptop | Link) and waits for the panel. */
  async openPairing(tab: PairingTab = 'phone'): Promise<void> {
    const button = this.pairButton();
    if ((await button.getAttribute('aria-expanded')) !== 'true') await button.click();
    const selected = this.pairingTab(tab);
    await expect(selected).toBeVisible();
    if ((await selected.getAttribute('aria-selected')) !== 'true') await selected.click();
    await expect(selected).toHaveAttribute('aria-selected', 'true');
  }

  async closePairing(): Promise<void> {
    const close = this.page.getByRole('button', { name: 'Gerät koppeln schliessen' });
    if (await close.isVisible()) await close.click();
    await expect(this.pairingTab('phone')).toBeHidden();
  }

  /** The QR code of the phone tab (`role=img`, «QR-Code zum Koppeln eines Handys»). */
  pairingQr(): Locator {
    return this.page.getByRole('img', { name: 'QR-Code zum Koppeln eines Handys' });
  }

  /**
   * Reads the pairing QR code of the phone tab the way a phone camera would: screenshot of the code, `jsqr`.
   * Returns the decoded text (the invite URL) and its token.
   */
  async readPairingQr(): Promise<{ url: string; token: string }> {
    await this.openPairing('phone');
    const qr = this.pairingQr();
    await expect(qr).toBeVisible();
    // The code at its normal size (168 px, about 4 px per module) decodes; the dock scrolls, so the element is brought
    // into view first and the read is repeated while the invite is being replaced (renewal, redeem).
    let url: string | null = null;
    for (let attempt = 0; attempt < 5 && !url; attempt++) {
      await qr.scrollIntoViewIfNeeded();
      url = decodeQr(PixelImage.fromPng(await qr.screenshot({ animations: 'disabled' })));
      if (!url) await this.page.waitForTimeout(300);
    }
    if (!url) throw new Error('the QR code of the pairing dock could not be decoded');
    const token = /\/join\/i\/([^/?#]+)/.exec(url)?.[1];
    if (!token) throw new Error(`the QR code does not hold an invite link: ${url}`);
    return { url, token };
  }

  /** The knock card (laptop waiting for approval) of a device name. The pairing dock may show it twice; this is the first. */
  knockCard(name: string): Locator {
    return this.page
      .getByRole('group', { name: 'Kopplungsanfrage' })
      .filter({ hasText: name })
      .first();
  }

  /** The check code on a knock card, e.g. «47 12». */
  async knockCheckCode(name: string): Promise<string> {
    const card = this.knockCard(name);
    await expect(card, `knock card of ${name}`).toBeVisible();
    return ((await card.locator('.c-knock__code').textContent()) ?? '').trim();
  }

  async approveKnock(name: string): Promise<void> {
    await this.knockCard(name).getByRole('button', { name: 'Zulassen' }).click();
  }

  async denyKnock(name: string): Promise<void> {
    await this.knockCard(name).getByRole('button', { name: 'Ablehnen' }).click();
  }

  // --- feedback ---------------------------------------------------------------------------------------------------

  /** The toast region (`role=status`). */
  toast(): Locator {
    return this.page.getByRole('status').filter({ hasText: /\S/ });
  }

  /** Text of the visible incident strip («K1 verbindet neu …»). */
  statusLine(): Locator {
    return this.page.locator('fs-status-line');
  }
}

export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
