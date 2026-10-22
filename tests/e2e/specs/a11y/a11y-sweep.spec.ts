import fs from 'node:fs';
import path from 'node:path';
import type { BrowserContext, Page } from '@playwright/test';
import { OUTPUT_DIR } from '../../support/env';
import { seedBusyConsole } from '../../support/a11y/seed';
import { unexpectedConsole, watchContext, type ContextWatch } from '../../support/a11y/watch';
import { DE } from '../../support/constants';
import { LaptopSender, newUiContext, OutputPage, pairLaptopViaKnock, PhoneSender, pairViaApi } from '../../support/ui';
import { RegiePage } from '../../support/ui/regie';
import { expect, test } from '../../support/ui/fixtures';
import { t } from '../../support/tags';

/**
 * E2E-A11Y-01: CSP and external hosts across all pages (task list; the plan's E2E-AUTH-15 and E2E-OPS-16 cover the same
 * invariants for the auth and ops areas). Login, Regie (many states), monitoring, sender (form, waiting, phone and laptop
 * station), output (slates, debug overlay): no `securitypolicyviolation`, no console error or warning beyond the
 * browser's own line for the expected 401 of the anonymous session probe and of a wrong password, no uncaught error,
 * no failed request, no 5xx, and every request (pages, scripts, styles, fonts, icons, XHR, WebSockets, service worker)
 * goes to the stack origin. The web fonts really load from the same origin.
 */

const tags = t.with('@p0', '@a11y', '@csp');
const VIEWPORT = { width: 1440, height: 900 };

/** Responses with a 4xx status that are part of a normal session (the browser logs them as «Failed to load resource»). */
const EXPECTED_STATUSES = [
  { status: 401, pathPattern: /^\/api\/auth\/me$/ },
  { status: 401, pathPattern: /^\/api\/auth\/login$/ },
];

async function loadedFonts(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    await document.fonts.ready;
    return Array.from(document.fonts).filter((face) => face.status === 'loaded').map((face) => face.family.replace(/"/g, ''));
  });
}

async function verify(label: string, watch: ContextWatch, origin: string): Promise<void> {
  const external = watch.external(origin);
  const csp = await watch.cspViolations();
  const consoleProblems = unexpectedConsole(watch, EXPECTED_STATUSES);
  const summary = {
    label,
    requests: watch.requests.length,
    origins: [...new Set(watch.requests.filter((request) => /^(https?|wss?):/.test(request.url)).map((request) => new URL(request.url).origin))],
    sockets: [...new Set(watch.sockets.map((socket) => socket.replace(/\?.*$/, '')))],
    badResponses: watch.badResponses,
    console: watch.consoleErrors,
  };
  fs.mkdirSync(path.join(OUTPUT_DIR, 'a11y'), { recursive: true });
  fs.writeFileSync(path.join(OUTPUT_DIR, 'a11y', `sweep-${label}.json`), JSON.stringify(summary, null, 2));
  await test.info().attach(`sweep-${label}.json`, { body: JSON.stringify(summary, null, 2), contentType: 'application/json' });
  expect(external.map((request) => `${request.method} ${request.url} (${request.type}) from ${request.page}`), `${label}: no request to a host other than ${origin}`).toEqual([]);
  expect(csp, `${label}: no securitypolicyviolation`).toEqual([]);
  expect(consoleProblems.map((entry) => `${entry.type}: ${entry.text.slice(0, 200)} (${entry.page})`), `${label}: no console error or warning`).toEqual([]);
  expect(watch.pageErrors.map((entry) => `${entry.text} (${entry.page})`), `${label}: no uncaught error`).toEqual([]);
  expect(watch.failures.map((entry) => `${entry.url} ${entry.reason} (${entry.page})`), `${label}: no failed request`).toEqual([]);
  expect(watch.badResponses.filter((response) => response.status >= 500).map((response) => `${response.status} ${response.url}`), `${label}: no 5xx`).toEqual([]);
  const unexpected = watch.badResponses.filter((response) => !EXPECTED_STATUSES.some((entry) => entry.status === response.status && entry.pathPattern.test(new URL(response.url).pathname)));
  expect(unexpected.map((response) => `${response.status} ${response.method} ${response.url} (${response.page})`), `${label}: no unexpected 4xx response`).toEqual([]);
  // WebSockets: same host, secure
  for (const socket of watch.sockets) expect(new URL(socket).origin.replace(/^wss/, 'https'), `${label}: WebSocket ${socket} goes to the stack`).toBe(origin);
}

test.describe('CSP and external hosts', () => {
  test('E2E-A11Y-01 [regie] login, Regie in many states and /monitoring: no CSP violation, no console error, only the stack origin; web fonts from the same origin', tags, async ({ browser, pairContext, onCleanup, config, production, api }) => {
    test.setTimeout(240_000);
    await seedBusyConsole(pairContext, onCleanup, { incident: 'reconnecting' });
    const context = await newUiContext(browser, { context: { viewport: VIEWPORT } });
    onCleanup(() => context.close());
    const watch = await watchContext(context);

    // login: the anonymous session probe (401), a wrong password (401), then the real login through the form
    const page = await context.newPage();
    const regie = new RegiePage(page, config);
    await page.goto('/login');
    await expect(page.getByLabel('Benutzername')).toBeVisible();
    expect(await loadedFonts(page), 'the UI font of the login page is loaded').toContain('Sofia Sans Semi Condensed');
    expect(await regie.submitLoginForm({ username: 'nobody', password: 'falsches-Passwort-123' })).toBe(401);
    await regie.loginViaUi();
    await regie.waitReady();
    await expect(regie.station('Handy Eingang')).toBeVisible();

    // the Regie in its states
    const fonts = await loadedFonts(page);
    expect(fonts, 'Sofia Sans Semi Condensed and JetBrains Mono are loaded in the Regie').toEqual(expect.arrayContaining(['Sofia Sans Semi Condensed', 'JetBrains Mono']));
    await regie.transitionOption('Schnitt').click(); // a fade ignores a second switch while it runs
    await regie.clickScene('Pause');
    await expect(regie.scene('Pause')).toHaveAttribute('aria-pressed', 'true');
    await regie.clickScene('Begrüssung');
    await expect(regie.scene('Begrüssung')).toHaveAttribute('aria-pressed', 'true');
    await regie.setStudioMode(true);
    for (const trigger of [page.getByRole('button', { name: /^Output an Proxy/ }), page.getByRole('button', { name: 'Docks und Layout' }), page.getByRole('button', { name: /^Produktion .*, Menü$/ }), page.getByRole('button', { name: 'Quelle', exact: true })]) {
      await trigger.click();
      await expect(page.locator('.c-pop').first()).toBeVisible();
      await page.keyboard.press('Escape');
    }
    await regie.openPairing('phone');
    await expect(regie.pairingQr()).toBeVisible();
    await regie.openPairing('link');
    await regie.closePairing();
    await page.locator('.c-st__row').first().click();
    await page.getByRole('button', { name: /Auswählen: / }).first().click();
    await page.getByRole('button', { name: 'Sendung starten' }).click();
    await expect(page.getByRole('button', { name: 'Sendung beenden' }).first()).toBeVisible();
    expect((await api.endBroadcast(production.id)).status).toBe(200);
    await expect(page.getByText('BEENDET')).toBeVisible();
    await page.goto('/monitoring');
    await expect(page.getByRole('table')).toBeVisible();
    // every font request went to the stack
    const fontRequests = watch.requests.filter((request) => request.type === 'font');
    expect(fontRequests.length, 'web fonts were requested').toBeGreaterThan(0);
    for (const request of fontRequests) expect(new URL(request.url).origin, `font ${request.url}`).toBe(new URL(config.baseURL).origin);
    await verify('regie', watch, new URL(config.baseURL).origin);
  });

  test('E2E-A11Y-01 [sender] the pairing form, waiting, denied, the phone and the laptop station: only the stack origin, no CSP violation, no console error', tags, async ({ browser, regie, pairContext, config, production, onCleanup, api }) => {
    test.setTimeout(240_000);
    void production;
    const origin = new URL(config.baseURL).origin;
    // laptop: knock -> approval -> station, share a screen
    const laptopContext = await newUiContext(browser, { profile: 'desktop', context: { viewport: VIEWPORT } });
    onCleanup(() => laptopContext.close());
    const laptopWatch = await watchContext(laptopContext);
    const laptop = await LaptopSender.inContext(laptopContext, 'desktop');
    await pairLaptopViaKnock(regie, laptop, 'Laptop Sweep');
    expect(await loadedFonts(laptop.page), 'the sender UI font is loaded').toContain('Sofia Sans Semi Condensed');
    await laptop.shareScreen();
    await laptop.waitForSlot('screen-1', 'live');
    await verify('sender-laptop', laptopWatch, origin);

    // phone: form (with the error), waiting, denied, then a paired phone with camera and banner
    const phoneContext = await newUiContext(browser, { profile: 'pixel7' });
    onCleanup(() => phoneContext.close());
    const phoneWatch = await watchContext(phoneContext);
    const phone = await PhoneSender.inContext(phoneContext, 'pixel7');
    await phone.gotoStart();
    await phone.page.getByLabel('Name des Geräts').fill('');
    await phone.page.getByRole('button', { name: 'Weiter' }).click();
    await expect(phone.page.locator('#device-name-error')).toBeVisible();
    await phone.submitPairingForm('Handy Sweep', 'phone');
    await phone.checkCode();
    await regie.openPairing('laptop');
    await regie.denyKnock('Handy Sweep');
    await expect(phone.page.getByTestId('pairing-denied')).toBeVisible();
    const paired = await newUiContext(browser, { profile: 'pixel7' });
    onCleanup(() => paired.close());
    const pairedWatch = await watchContext(paired);
    const station = await PhoneSender.inContext(paired, 'pixel7');
    const device = await pairViaApi(pairContext, station, { name: 'Handy Sweep 2' });
    await station.waitForCamera('live');
    expect((await api.sendDeviceCommand(production.id, device.id, { kind: 'message', text: 'Alles gut, weiter so.' })).status).toBeLessThan(300);
    await expect(station.messageBanner()).toBeVisible();
    await phone.page.goto('/join/manifest.webmanifest');
    await verify('sender-phone', phoneWatch, origin);
    await verify('sender-phone-station', pairedWatch, origin);
  });

  test('E2E-A11Y-01 [output] the output page (standby, live, end, denied, debug overlay): only the stack origin, no CSP violation, no console error; the slate font is loaded', tags, async ({ browser, api, production, config, onCleanup }) => {
    test.setTimeout(150_000);
    const origin = new URL(config.baseURL).origin;
    const context = await newUiContext(browser, { context: { viewport: { width: 1280, height: 720 } } });
    onCleanup(() => context.close());
    const watch = await watchContext(context);
    const output = await OutputPage.open(context, production, { debug: true });
    await expect.poll(() => output.slateText(), { timeout: 20_000 }).toContain(DE.slateStandby);
    expect(await loadedFonts(output.page), 'the slate font of the output page is loaded').toContain('Sofia Sans Semi Condensed');
    expect((await api.startBroadcast(production.id)).status).toBe(200);
    await expect.poll(() => output.slateText(), { timeout: 20_000 }).not.toContain(DE.slateStandby);
    await expect(output.page.locator('.c-debug')).toBeVisible();
    expect((await api.endBroadcast(production.id)).status).toBe(200);
    await expect.poll(() => output.slateText(), { timeout: 20_000 }).toContain(DE.slateEnd);
    const fontRequests = watch.requests.filter((request) => request.type === 'font');
    expect(fontRequests.length, 'the font was requested').toBeGreaterThan(0);
    for (const request of fontRequests) expect(new URL(request.url).origin).toBe(origin);
    await verify('output', watch, origin);

    // a wrong key: the 403 is shown as the «Kein Zugang» slate; the page logs the refusal itself (console.error of its hub logger)
    const deniedContext = await newUiContext(browser, { context: { viewport: { width: 1280, height: 720 } } });
    onCleanup(() => deniedContext.close());
    const deniedWatch = await watchContext(deniedContext);
    const denied = await OutputPage.open(deniedContext, { slug: production.slug, outputKey: 'falscher-schluessel' });
    await expect.poll(() => denied.slateText(), { timeout: 20_000 }).toContain(DE.slateDenied);
    const allowed = [{ status: 403, pathPattern: /^\/(api|hubs)\/output/ }];
    const refusal = unexpectedConsole(deniedWatch, allowed).filter((entry) => !/^\[FlowStudio Output\] hub: /.test(entry.text));
    expect(refusal.map((entry) => entry.text.slice(0, 200)), 'denied: the console holds only the output page\'s own log lines about the refused key').toEqual([]);
    expect(await deniedWatch.cspViolations(), 'denied: no securitypolicyviolation').toEqual([]);
    expect(deniedWatch.external(origin).map((request) => request.url), 'denied: only the stack origin').toEqual([]);
    expect(deniedWatch.pageErrors).toEqual([]);
    await test.info().attach('sweep-output-denied.json', { body: JSON.stringify({ badResponses: deniedWatch.badResponses, console: deniedWatch.consoleErrors }, null, 2), contentType: 'application/json' });
  });
});

void (undefined as unknown as BrowserContext);
