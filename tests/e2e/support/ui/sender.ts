import {
  expect,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from '@playwright/test';
import { stackConfig, type StackConfig } from '../env';
import { watchPage, type PageProblems } from './diagnostics';
import { newUiContext, PROFILE_FACTS, type DeviceProfile, type NewUiContextOptions } from './init';

/**
 * Page objects of the sender PWA (`apps/sender`, base `/join/`, docs/testing.md 1.7, spec 9.2) for a phone
 * (Pixel 7 / iPhone 15 profiles on Chromium) and a laptop (Desktop profile), each in a context of its own with fake
 * media, the test hooks flag and the init script. The page reports itself through `data-testid`s
 * (`connection-state`, `tally`, `slot-<slot>`, `check-code`, `message-banner`) and `window.__fsSender`.
 */

export type SenderConnection =
  'connected' | 'connecting' | 'reconnecting' | 'offline' | 'blocked' | 'replaced' | 'removed';
export type SlotState = 'starting' | 'live' | 'paused' | 'ended' | 'failed' | string;
export type Tally = 'program' | 'preview' | 'off';

/**
 * The device credentials the sender stored. The product keeps them in `localStorage['flowstudio.sender.v1']` as
 * `{deviceId, secret, productionId, clientId}`; docs/testing.md 1.7 pins `flowstudio.device` with `deviceSecret`. Both
 * are read and normalised to this shape.
 */
export interface StoredDevice {
  deviceId: string;
  deviceSecret: string;
  productionId: string;
}

export interface SenderHooks {
  slots: Record<string, string>;
  rtc: string;
  sessionId: string;
}

export abstract class SenderPage {
  readonly problems: PageProblems;
  abstract readonly kind: 'phone' | 'laptop';

  protected constructor(
    readonly context: BrowserContext,
    readonly page: Page,
    readonly profile: DeviceProfile,
    readonly config: StackConfig,
    private readonly ownsContext: boolean,
  ) {
    this.problems = watchPage(page);
  }

  /** Closes the page and, when this object created it, the context. */
  async close(): Promise<void> {
    if (this.ownsContext) await this.context.close().catch(() => undefined);
    else await this.page.close().catch(() => undefined);
  }

  // --- navigation ------------------------------------------------------------------------------------------------

  /** `/join/`: resumes with stored credentials, else the pairing form. */
  async gotoStart(): Promise<void> {
    await this.page.goto('/join/');
  }

  /** Opens an invite link (the text of a QR code or `/j/{token}`) in this sender. */
  async gotoInvite(url: string): Promise<void> {
    await this.page.goto(url);
  }

  // --- pairing form and waiting screen -----------------------------------------------------------------------------

  /** Fills the pairing form (`/join/`): device name and kind, then «Weiter». */
  async submitPairingForm(name: string, kind: 'phone' | 'laptop' = this.kind): Promise<void> {
    await this.page.getByLabel('Name des Geräts').fill(name);
    await this.page
      .getByRole('radio', { name: kind === 'phone' ? 'Handy (Kamera)' : 'Laptop (Bildschirm)' })
      .check();
    await this.page.getByRole('button', { name: 'Weiter' }).click();
  }

  /** The check code shown while the Regie has not answered, e.g. «47 12». */
  async checkCode(): Promise<string> {
    const code = this.page.getByTestId('check-code');
    await expect(code).toBeVisible();
    return ((await code.textContent()) ?? '').trim();
  }

  /** Checks the kind the form selected on its own (`phone` for mobile profiles, `laptop` for desktop). */
  async defaultKind(): Promise<'phone' | 'laptop'> {
    const phone = this.page.getByRole('radio', { name: 'Handy (Kamera)' });
    await expect(phone).toBeVisible();
    return (await phone.isChecked()) ? 'phone' : 'laptop';
  }

  // --- station state ---------------------------------------------------------------------------------------------

  connectionState(): Locator {
    return this.page.getByTestId('connection-state');
  }

  async connection(): Promise<SenderConnection | null> {
    const element = this.connectionState().first();
    if ((await element.count()) === 0) return null;
    return (await element.getAttribute('data-state')) as SenderConnection | null;
  }

  /** Waits for the station route and the «Verbunden» line. */
  async waitConnected(timeout = 30_000): Promise<void> {
    await this.page.waitForURL(/\/join\/station/, { timeout });
    await expect(this.connectionState().first(), 'sender hub connected').toHaveAttribute(
      'data-state',
      'connected',
      { timeout },
    );
  }

  async waitForConnection(state: SenderConnection, timeout = 30_000): Promise<void> {
    await expect(this.connectionState().first()).toHaveAttribute('data-state', state, { timeout });
  }

  async tally(): Promise<Tally | null> {
    const element = this.page.getByTestId('tally').first();
    if ((await element.count()) === 0) return null;
    return (await element.getAttribute('data-tally')) as Tally | null;
  }

  async waitForTally(tally: Tally, timeout = 10_000): Promise<void> {
    await expect(this.page.getByTestId('tally').first()).toHaveAttribute('data-tally', tally, {
      timeout,
    });
  }

  slot(slot: string): Locator {
    return this.page.getByTestId(`slot-${slot}`);
  }

  async slotState(slot: string): Promise<SlotState | null> {
    const element = this.slot(slot).first();
    if ((await element.count()) === 0) return null;
    return await element.getAttribute('data-state');
  }

  async waitForSlot(slot: string, state: SlotState, timeout = 20_000): Promise<void> {
    await expect(this.slot(slot).first(), `slot ${slot} is ${state}`).toHaveAttribute(
      'data-state',
      state,
      { timeout },
    );
  }

  /** The message banner of a Regie message (`message-banner`), or null. */
  messageBanner(): Locator {
    return this.page.getByTestId('message-banner');
  }

  /** `window.__fsSender` (needs the test hooks), or null. */
  async hooks(): Promise<SenderHooks | null> {
    return this.page.evaluate(() => {
      const view = (
        window as unknown as {
          __fsSender?: { slots(): Record<string, string>; rtc(): string; sessionId: string };
        }
      ).__fsSender;
      return view ? { slots: view.slots(), rtc: view.rtc(), sessionId: view.sessionId } : null;
    });
  }

  /** Credentials the sender stored (`flowstudio.sender.v1`, or the documented `flowstudio.device`), or null before pairing. */
  async storedDevice(): Promise<StoredDevice | null> {
    return this.page.evaluate(() => {
      for (const key of ['flowstudio.sender.v1', 'flowstudio.device']) {
        try {
          const raw = window.localStorage.getItem(key);
          const record = raw ? (JSON.parse(raw) as Record<string, string | undefined>) : null;
          const secret = record?.['secret'] ?? record?.['deviceSecret'];
          if (record?.['deviceId'] && secret && record['productionId'])
            return {
              deviceId: record['deviceId'],
              deviceSecret: secret,
              productionId: record['productionId'],
            };
        } catch {
          // storage blocked or not JSON: not paired as far as the test can tell
        }
      }
      return null;
    });
  }

  /**
   * Hands the sender the credentials of a device that was paired through the API (`pairPhone`, `pairLaptopByLink` of
   * support/production.ts), the way a browser that paired earlier holds them: written to the sender's storage before
   * the app starts. `gotoStart()` then resumes straight into the station. This is the fast path for tests that are not
   * about pairing (docs/testing.md 1.2.5 `pairPhone(via:'api')`); it uses no pairing request and no redeem allowance.
   */
  async seedCredentials(credentials: {
    deviceId: string;
    deviceSecret: string;
    productionId: string;
  }): Promise<void> {
    await this.page.route(`${this.config.baseURL}/__e2e/seed`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<!doctype html><title>seed</title>',
      }),
    );
    await this.page.goto('/__e2e/seed');
    await this.page.evaluate(
      (record) => window.localStorage.setItem('flowstudio.sender.v1', JSON.stringify(record)),
      {
        deviceId: credentials.deviceId,
        secret: credentials.deviceSecret,
        productionId: credentials.productionId,
      },
    );
  }

  /** Waits until the sender has stored its device credentials (pairing finished) and returns them. */
  async waitForStoredDevice(timeout = 15_000): Promise<StoredDevice> {
    let stored: StoredDevice | null = null;
    await expect
      .poll(async () => (stored = await this.storedDevice()) !== null, {
        timeout,
        message: 'the sender stored its credentials (flowstudio.sender.v1)',
      })
      .toBe(true);
    return stored!;
  }

  /** Counters of the media fixture: calls of `getUserMedia` / `getDisplayMedia` (init script, support/browser). */
  async mediaCalls(): Promise<{ userMedia: number; display: number }> {
    return this.page.evaluate(() => {
      const media = (
        window as unknown as { __fsMedia?: { userMediaCalls: unknown[]; displayCalls: number } }
      ).__fsMedia;
      return { userMedia: media?.userMediaCalls.length ?? 0, display: media?.displayCalls ?? 0 };
    });
  }

  /** The fake sources made so far and whether their tracks are live (`window.__fsFake`). */
  async fakeSources(): Promise<
    Array<{ kind: string; index: number; frames: number; live: boolean }>
  > {
    return this.page.evaluate(
      () =>
        (
          window as unknown as {
            __fsFake?: {
              frames(): Array<{ kind: string; index: number; frames: number; live: boolean }>;
            };
          }
        ).__fsFake?.frames() ?? [],
    );
  }

  /** What the browser's «Stop sharing» does to the n-th fake screen (default: the last one). */
  async browserStopsSharing(index?: number): Promise<boolean> {
    return this.page.evaluate(
      (i) =>
        (
          window as unknown as { __fsFake?: { endScreen(i?: number): boolean } }
        ).__fsFake?.endScreen(i) ?? false,
      index,
    );
  }
}

export class PhoneSender extends SenderPage {
  readonly kind = 'phone' as const;

  /** A phone in a context of its own. `profile` is `pixel7` (default) or `iphone15`; `desktop` makes a webcam sender. */
  static async open(browser: Browser, options: NewUiContextOptions = {}): Promise<PhoneSender> {
    const profile = options.profile ?? 'pixel7';
    const context = await newUiContext(browser, { ...options, profile });
    return new PhoneSender(context, await context.newPage(), profile, stackConfig(), true);
  }

  /** A phone page in a context that already exists (the context must have `installUiInit`). */
  static async inContext(
    context: BrowserContext,
    profile: DeviceProfile = 'pixel7',
  ): Promise<PhoneSender> {
    return new PhoneSender(context, await context.newPage(), profile, stackConfig(), false);
  }

  cameraState(): Promise<SlotState | null> {
    return this.slotState('camera');
  }

  async waitForCamera(state: SlotState = 'live', timeout = 30_000): Promise<void> {
    await this.waitForSlot('camera', state, timeout);
  }

  /** The preview of the own camera (`<video aria-label="Vorschau der Kamera">`). */
  preview(): Locator {
    return this.page.getByLabel('Vorschau der Kamera');
  }

  startButton(): Locator {
    return this.page.getByRole('button', { name: 'Kamera starten' });
  }

  stopButton(): Locator {
    return this.page.getByRole('button', { name: 'Kamera stoppen' });
  }

  async startCamera(): Promise<void> {
    await this.startButton().click();
  }

  async stopCamera(): Promise<void> {
    await this.stopButton().click();
  }

  darkToggle(): Locator {
    return this.page.getByRole('button', { name: 'Dunkel' });
  }

  async facing(): Promise<'user' | 'environment'> {
    return (await this.page.getByRole('radio', { name: 'Rück' }).isChecked())
      ? 'environment'
      : 'user';
  }

  async setResolution(height: 720 | 1080): Promise<void> {
    await this.page.getByRole('radio', { name: `${height}p` }).check();
  }
}

export class LaptopSender extends SenderPage {
  readonly kind = 'laptop' as const;

  /** A laptop in a context of its own (Desktop profile by default). */
  static async open(browser: Browser, options: NewUiContextOptions = {}): Promise<LaptopSender> {
    const profile = options.profile ?? 'desktop';
    const context = await newUiContext(browser, { ...options, profile });
    return new LaptopSender(context, await context.newPage(), profile, stackConfig(), true);
  }

  static async inContext(
    context: BrowserContext,
    profile: DeviceProfile = 'desktop',
  ): Promise<LaptopSender> {
    return new LaptopSender(context, await context.newPage(), profile, stackConfig(), false);
  }

  /** «Bildschirm teilen» of the first slot, or «+ weiteren Bildschirm» for a further one: a user gesture, then the (fake) capture. */
  async shareScreen(): Promise<void> {
    const first = this.page.getByRole('button', { name: 'Bildschirm teilen', exact: true });
    if (await first.count()) await first.first().click();
    else await this.page.getByRole('button', { name: '+ weiteren Bildschirm' }).click();
  }

  async addScreen(): Promise<void> {
    await this.page.getByRole('button', { name: '+ weiteren Bildschirm' }).click();
  }

  /** «Teilen beenden» of a screen slot (`screen-1`, ...). */
  async endShare(slot = 'screen-1'): Promise<void> {
    await this.slot(slot).getByRole('button', { name: 'Teilen beenden' }).click();
  }

  /** «Erneut teilen» of an ended slot (also the large banner button when the Regie asks). */
  async reshare(slot = 'screen-1'): Promise<void> {
    await this.slot(slot).getByRole('button', { name: 'Erneut teilen' }).click();
  }

  async removeSlot(slot: string): Promise<void> {
    await this.slot(slot).getByRole('button', { name: 'Entfernen' }).click();
  }

  async addCamera(): Promise<void> {
    await this.page.getByRole('button', { name: 'Kamera hinzufügen' }).click();
  }

  /** The banner shown when the Regie asked to share again. */
  reshareBanner(): Locator {
    return this.page.getByText('Die Regie bittet dich, den Bildschirm erneut zu teilen');
  }
}

/** Facts the project/profile promises about the device (for the fixture smoke tests). */
export async function describeDevice(sender: SenderPage) {
  const facts = await sender.page.evaluate(() => ({
    userAgent: navigator.userAgent,
    touchPoints: navigator.maxTouchPoints,
    width: window.innerWidth,
    height: window.innerHeight,
    pixelRatio: window.devicePixelRatio,
    hasDisplayMedia: typeof navigator.mediaDevices?.getDisplayMedia === 'function',
    secure: window.isSecureContext,
  }));
  return { ...facts, expected: PROFILE_FACTS[sender.profile] };
}
