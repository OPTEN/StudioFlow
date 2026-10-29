import { devices, type Page } from '@playwright/test';
import { FULL, livePhone, putInScene } from '../../support/devices/fleet';
import { crowdedTargets, expectNoOverflow, readOverflow, readTargets, readTextFacts, smallTargets } from '../../support/devices/layout';
import { LONG_NAME, visitLaptopStates, visitPhoneStates, type SenderStateEnv } from '../../support/devices/states';
import { livekitAdmin } from '../../support/livekit';
import { sleep } from '../../support/shell';
import { expect, test } from '../../support/ui/fixtures';
import { t } from '../../support/tags';

/**
 * DEV, the sender parts (docs/testing.md 2.8): portrait and landscape, iPhone and iPad profiles, 320 px, tap targets.
 * Every state of the sender is reached with support/devices/states.ts, so each check looks at the same screens: pairing form,
 * expired invite, waiting screen with the check code, live station, Regie message, technical check, dark mode, replaced tab,
 * blocked; for the laptop the idle, live, ended and reshare states and nine screens.
 *
 * The profiles run on Chromium here (WebKit has no WebRTC on Windows, playwright.config.ts): `pixel7` and `iphone15` give the
 * device descriptors (touch, mobile, pixel ratio, user agent); the sizes are set explicitly.
 */

const portrait = { width: 412, height: 915 };
const landscape = { width: 915, height: 412 };

function env(fixtures: { api: SenderStateEnv['api']; production: SenderStateEnv['production']; pairContext: SenderStateEnv['pairContext']; openPhone: SenderStateEnv['openPhone']; openLaptop: SenderStateEnv['openLaptop'] }): SenderStateEnv {
  return fixtures;
}

/** What the tally frame of the sender covers. */
async function frame(page: Page) {
  return page.evaluate(() => {
    const element = document.querySelector('[data-testid=tally]') as HTMLElement | null;
    if (!element) return null;
    const box = element.getBoundingClientRect();
    return { tally: element.getAttribute('data-tally'), covers: box.width >= window.innerWidth - 1 && box.height >= window.innerHeight - 1, shadow: getComputedStyle(element).boxShadow };
  });
}

/** True when the element is inside the viewport and is what a finger hits at its centre (nothing covers it). */
async function reachable(page: Page, selector: string): Promise<{ inside: boolean; hit: boolean }> {
  return page.evaluate((query) => {
    const element = document.querySelector(query) as HTMLElement | null;
    if (!element) return { inside: false, hit: false };
    const box = element.getBoundingClientRect();
    const inside = box.top >= 0 && box.left >= 0 && box.bottom <= window.innerHeight && box.right <= window.innerWidth && box.width > 0 && box.height > 0;
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return { inside, hit: Boolean(hit && (hit === element || element.contains(hit) || (hit.closest('label') && hit.closest('label')!.contains(element)))) };
  }, selector);
}

test.describe('DEV sender, orientation', () => {
  test(
    'E2E-DEV-07 [ui, pixel7] every sender state in portrait and landscape: no horizontal scroll, the controls of the station reachable without scrolling',
    t.p0,
    async ({ regie, openPhone, openLaptop, api, production, pairContext }, testInfo) => {
      test.setTimeout(300_000);
      const notes: string[] = [];
      await visitPhoneStates(env({ api, production, pairContext, openPhone, openLaptop }), async (label, page) => {
        for (const [orientation, size] of [['portrait', portrait], ['landscape', landscape]] as const) {
          await page.setViewportSize(size);
          await sleep(250);
          await expectNoOverflow(page, `${label} ${orientation}`);
          if (label === 'station') {
            for (const [name, selector] of [
              ['switch camera', '.c-phone__control--switch'],
              ['quality', '.c-phone__control--quality'],
              ['microphone', '.c-phone__control--mic'],
              ['screen off', '.c-phone__control--screen-off'],
              ['technical check', '.c-phone__control--check'],
              ['stop', '.c-phone__control--stop'],
            ] as const) {
              const found = await reachable(page, selector);
              expect(found.inside, `${name} inside the ${orientation} viewport without scrolling`).toBe(true);
              expect(found.hit, `${name} is what a finger hits at its centre (${orientation})`).toBe(true);
            }
          }
          if (label === 'form') {
            const overflow = await readOverflow(page);
            const need = overflow.scroll.height > overflow.viewport.height;
            notes.push(`form ${orientation}: document ${overflow.scroll.height} px high in ${overflow.viewport.height} px (${need ? 'scrolls' : 'fits'})`);
            // The kind switch and “Continue” are reachable, with a scroll where the page is higher than the viewport.
            for (const selector of ['.c-choices__list', 'button[type=submit]']) {
              await page.locator(selector).first().scrollIntoViewIfNeeded();
              expect((await reachable(page, selector)).hit, `${selector} reachable (${orientation})`).toBe(true);
            }
          }
        }
        await page.setViewportSize(portrait);
      });
      await testInfo.attach('orientation-notes.txt', { body: notes.join('\n'), contentType: 'text/plain' });
    },
  );

  test(
    'E2E-DEV-07 [ui, pixel7, tally and rotation] the tally frame surrounds the whole viewport in both orientations; rotating while publishing keeps the LiveKit track and does not restart the camera',
    t.p0,
    async ({ regie, openPhone, pairContext, api, production }) => {
      test.setTimeout(180_000);
      const k1 = await livePhone({ openPhone }, pairContext, regie, 'Phone One', { profile: 'pixel7', context: { viewport: portrait } });
      await putInScene(api, production, 0, k1.sourceId, FULL);
      await api.startBroadcast(production.id);
      await k1.phone.waitForTally('program');
      const page = k1.phone.page;
      const trackSid = async () => (await livekitAdmin.listParticipants(production.id)).find((participant) => participant.identity === k1.device.id)?.tracks.find((track) => track.name === 'camera')?.sid;
      const sidBefore = await trackSid();
      expect(sidBefore, 'the camera is published').toBeTruthy();
      const callsBefore = (await k1.phone.mediaCalls()).userMedia;
      const sessionBefore = (await k1.phone.hooks())!.sessionId;

      for (const size of [landscape, portrait, landscape, portrait]) {
        await page.setViewportSize(size);
        await sleep(400);
        const outline = await frame(page);
        expect(outline!.tally).toBe('program');
        expect(outline!.covers, `the tally frame covers ${size.width}x${size.height}`).toBe(true);
        expect(outline!.shadow).toContain('rgb(255, 105, 97)');
        await expectNoOverflow(page, `rotated to ${size.width}x${size.height}`);
        expect(await k1.phone.cameraState(), 'the camera keeps sending while the phone rotates').toBe('live');
      }
      expect(await trackSid(), 'the same LiveKit publication (SID unchanged)').toBe(sidBefore);
      expect((await k1.phone.mediaCalls()).userMedia, 'the camera was not asked for again').toBe(callsBefore);
      expect((await k1.phone.hooks())!.sessionId, 'the same page session').toBe(sessionBefore);
      expect(await k1.phone.connection()).toBe('connected');
    },
  );

  test(
    'E2E-DEV-08 [ui, iphone15] the sender on the iPhone profile: invite redeem and station in portrait and landscape, no overflow, safe-area padding at the bottom, viewport-fit=cover',
    t.p1,
    async ({ regie, openPhone, api, production }, testInfo) => {
      test.setTimeout(180_000);
      const phone = await openPhone({ profile: 'iphone15' });
      const invite = (await api.getPhoneInvite(production.id)).body;
      await phone.gotoInvite(invite.url);
      await phone.waitConnected();
      await phone.waitForCamera('live', 45_000);
      expect((await phone.mediaCalls()).userMedia, 'getUserMedia is available: the full subset runs').toBeGreaterThan(0);
      const page = phone.page;
      for (const [orientation, size] of [['portrait', { width: 390, height: 844 }], ['landscape', { width: 844, height: 390 }]] as const) {
        await page.setViewportSize(size);
        await sleep(300);
        await expectNoOverflow(page, `iPhone station ${orientation}`);
        const targets = await readTargets(page);
        expect(smallTargets(targets).map((target) => `${target.tag} ${target.label} ${target.width}x${target.height}`), `tap targets ${orientation}`).toEqual([]);
      }
      const facts = await readTextFacts(page);
      expect(facts.viewportMeta, 'viewport-fit=cover lets the page use the notch area').toContain('viewport-fit=cover');
      // The bottom controls clear the home indicator: the safe-area inset is part of their padding.
      const safe = await page.evaluate(() => {
        const sheets = [...document.styleSheets];
        let usesInset = false;
        for (const sheet of sheets) {
          try {
            for (const rule of [...sheet.cssRules]) if (rule.cssText.includes('safe-area-inset-bottom')) usesInset = true;
          } catch {
            // a cross-origin sheet
          }
        }
        // The translucent rail holds the round controls; its bottom padding is the gutter plus the safe-area inset.
        const rail = document.querySelector('.c-phone__rail') as HTMLElement | null;
        return {
          usesInset,
          rootVariable: getComputedStyle(document.documentElement).getPropertyValue('--safe-bottom').trim(),
          controlsPaddingBottom: rail ? getComputedStyle(rail).paddingBottom : null,
          lastButtonBottomGap: (() => {
            const buttons = [...document.querySelectorAll('.c-phone__controls button, .c-phone__controls label')] as HTMLElement[];
            return buttons.length ? window.innerHeight - Math.max(...buttons.map((button) => button.getBoundingClientRect().bottom)) : null;
          })(),
        };
      });
      testInfo.annotations.push({ type: 'device', description: `iPhone 15 profile: ${JSON.stringify(safe)}` });
      expect(safe.usesInset || safe.rootVariable.includes('safe-area-inset-bottom'), 'env(safe-area-inset-bottom) is used').toBe(true);
      expect(parseFloat(safe.controlsPaddingBottom!), 'padding below the controls: the gutter plus the safe-area inset').toBeGreaterThanOrEqual(16);
      expect(safe.lastButtonBottomGap!, 'the lowest control keeps its distance from the bottom edge (inset 0 in the emulation)').toBeGreaterThanOrEqual(16);
      const tally = await frame(page);
      expect(tally!.tally).toBe('off');
    },
  );

  test(
    'E2E-DEV-09 [ui, ipad] the sender on an iPad: kind defaults to phone (no getDisplayMedia), portrait 810 x 1080 and landscape 1080 x 810, no overflow, targets of 44 px',
    t.p1,
    async ({ regie, browser, api, production, onCleanup }) => {
      test.setTimeout(180_000);
      const { newUiContext } = await import('../../support/ui/init');
      const { defaultBrowserType: _ignored, ...descriptor } = devices['iPad (gen 7)'];
      void _ignored;
      const context = await newUiContext(browser, { context: { ...descriptor, viewport: { width: 810, height: 1080 } } });
      onCleanup(() => context.close());
      // Safari on an iPad has no getDisplayMedia (the Chromium emulation has).
      await context.addInitScript(() => Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', { value: undefined, configurable: true }));
      const page = await context.newPage();
      const invite = (await api.getPhoneInvite(production.id)).body;
      await page.goto('/join/');
      await expect(page.getByRole('radio', { name: 'Phone camera' })).toBeChecked();
      for (const [orientation, size] of [['portrait', { width: 810, height: 1080 }], ['landscape', { width: 1080, height: 810 }]] as const) {
        await page.setViewportSize(size);
        await sleep(250);
        await expectNoOverflow(page, `iPad form ${orientation}`);
        expect(smallTargets(await readTargets(page)).map((target) => `${target.tag} ${target.label} ${target.width}x${target.height}`), `form targets ${orientation}`).toEqual([]);
      }
      await page.goto(invite.url);
      await expect(page.locator('[data-testid=connection-state]').first()).toHaveAttribute('data-state', 'connected', { timeout: 30_000 });
      await expect(page.getByTestId('slot-camera')).toHaveAttribute('data-state', 'live', { timeout: 45_000 });
      for (const [orientation, size] of [['portrait', { width: 810, height: 1080 }], ['landscape', { width: 1080, height: 810 }]] as const) {
        await page.setViewportSize(size);
        await sleep(300);
        await expectNoOverflow(page, `iPad station ${orientation}`);
        const targets = await readTargets(page);
        expect(smallTargets(targets).map((target) => `${target.tag} ${target.label} ${target.width}x${target.height}`), `station targets ${orientation}`).toEqual([]);
        const stage = await page.locator('.c-phone__stage').boundingBox();
        expect(stage!.width, `the camera picture uses the width (${orientation})`).toBeGreaterThanOrEqual(size.width * 0.95);
        const controls = await page.locator('.c-phone__controls').boundingBox();
        expect(controls!.width, `the controls use the width, not a phone-sized column (${orientation})`).toBeGreaterThanOrEqual(Math.min(size.width, 600) * 0.9);
      }
    },
  );
});

test.describe('DEV sender, 320 px and tap targets', () => {
  test(
    'E2E-DEV-10 [ui, small-320] at 320 x 568: no horizontal scroll, the check code on one line, long names and a 140-character message stay inside, nine screens, text of 14 px, full-width buttons',
    t.p0,
    async ({ regie, openPhone, openLaptop, api, production, pairContext }) => {
      test.setTimeout(400_000);
      const size = { width: 320, height: 568 };
      const seen: string[] = [];
      const check = async (label: string, page: Page) => {
        seen.push(label);
        await expectNoOverflow(page, `320 ${label}`);
        const facts = await readTextFacts(page);
        expect(facts.minFontPx, `320 ${label}: smallest text (${facts.smallest})`).toBeGreaterThanOrEqual(14);
        if (label === 'waiting') {
          const code = await page.getByTestId('check-code').evaluate((element) => {
            const style = getComputedStyle(element);
            const box = element.getBoundingClientRect();
            return { text: element.textContent?.trim() ?? '', fontSize: style.fontSize, letterSpacing: style.letterSpacing, family: style.fontFamily, height: box.height, width: box.width, lineHeight: parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2 };
          });
          expect(code.text, 'check code “47 12”').toMatch(/^\d{2} \d{2}$/);
          expect(parseFloat(code.fontSize), 'mono, 24 px at least (DESIGN: Mono pairing code)').toBeGreaterThanOrEqual(24);
          expect(parseFloat(code.letterSpacing) / parseFloat(code.fontSize), 'letter spacing 0.14 em').toBeCloseTo(0.14, 2);
          expect(code.family.toLowerCase(), 'monospace').toContain('mono');
          expect(code.height, 'the code stays on one line').toBeLessThan(code.lineHeight * 1.6);
        }
        if (label === 'form' || label === 'waiting' || label === 'redeem-expired') {
          // Buttons of the pairing pages are as wide as their column.
          for (const button of await page.locator('main .c-btn--block').all()) {
            const box = (await button.boundingBox())!;
            const column = (await button.locator('xpath=..').boundingBox())!;
            expect(box.width, `${label}: full-width button “${(await button.textContent())?.trim()}”`).toBeGreaterThanOrEqual(column.width - 2);
          }
        }
        if (label === 'banner' || label === 'station-banner') {
          const text = await page.locator('[data-testid=message-banner] .c-message__text').boundingBox();
          const banner = await page.locator('[data-testid=message-banner]').boundingBox();
          expect(text!.x + text!.width, `${label}: the 140-character text stays inside the banner`).toBeLessThanOrEqual(banner!.x + banner!.width + 1);
          expect(banner!.width, `${label}: the banner fits the viewport`).toBeLessThanOrEqual(size.width);
        }
        if (label === 'station' || label === 'station-idle' || label === 'station-live') {
          const name = await page.locator('h1').first().boundingBox();
          expect(name!.x + name!.width, `${label}: the 60-character name stays inside`).toBeLessThanOrEqual(size.width + 1);
        }
        if (label === 'station-nine-screens') {
          expect(await page.locator('[data-testid^="slot-screen-"]').count()).toBe(9);
        }
      };
      const phone = await visitPhoneStates(env({ api, production, pairContext, openPhone, openLaptop }), check, { profile: 'pixel7', context: { viewport: size } });
      void phone;
      await visitLaptopStates(env({ api, production, pairContext, openPhone, openLaptop }), check, { profile: 'desktop', context: { viewport: size } });
      expect(seen).toEqual(expect.arrayContaining(['form', 'waiting', 'station', 'banner', 'station-nine-screens']));
    },
  );

  for (const run of [
    { name: 'pixel7', profile: 'pixel7' as const, viewport: { width: 412, height: 915 } },
    { name: 'iphone15', profile: 'iphone15' as const, viewport: { width: 390, height: 844 } },
    { name: 'small-320', profile: 'pixel7' as const, viewport: { width: 320, height: 568 } },
  ]) {
    test(
      `E2E-DEV-11 [ui, ${run.name}] tap targets on every sender state: at least 44 css px, 8 px between separate controls, touch-action manipulation, a zoomable viewport`,
      t.p0,
      async ({ regie, openPhone, openLaptop, api, production, pairContext }, testInfo) => {
        test.setTimeout(400_000);
        const report: Record<string, unknown> = {};
        const check = async (label: string, page: Page) => {
          const targets = await readTargets(page);
          const small = smallTargets(targets);
          const crowded = crowdedTargets(targets);
          const buttons = targets.filter((target) => target.tag === 'button' && target.touchAction !== 'manipulation');
          report[label] = { targets: targets.length, small: small.map((target) => `${target.tag} “${target.label}” ${target.width}x${target.height}`), crowded: crowded.map(([a, b, gap]) => `“${a.label}” | “${b.label}” ${gap}px`), notManipulation: buttons.map((target) => target.label) };
          expect(small.map((target) => `${target.tag} “${target.label}” ${target.width}x${target.height}`), `${label}: targets under 44 px`).toEqual([]);
          expect(buttons.map((target) => target.label), `${label}: buttons without touch-action: manipulation`).toEqual([]);
          expect(crowded.map(([a, b, gap]) => `“${a.label}” | “${b.label}” ${gap}px`), `${label}: controls closer than 8 px`).toEqual([]);
          const facts = await readTextFacts(page);
          expect(facts.viewportMeta, `${label}: the viewport can be zoomed`).not.toMatch(/user-scalable\s*=\s*(no|0)|maximum-scale\s*=\s*1(\.0)?\b/);
        };
        const options = { profile: run.profile, context: { viewport: run.viewport } };
        await visitPhoneStates(env({ api, production, pairContext, openPhone, openLaptop }), async (label, page) => check(`phone ${label}`, page), options);
        await visitLaptopStates(env({ api, production, pairContext, openPhone, openLaptop }), async (label, page) => check(`laptop ${label}`, page), { profile: 'desktop', context: { viewport: run.viewport } });
        await testInfo.attach(`tap-targets-${run.name}.json`, { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
      },
    );
  }
});

test('E2E-DEV-18 [ui, sender] long text does not break the sender: a 60-character name, a 140-character message and an 80-character production name at 320 and 900 px', t.p2, async ({ regie, openPhone, openLaptop, api, production, pairContext }) => {
  test.setTimeout(300_000);
  await api.updateProduction(production.id, { name: ('P'.repeat(10) + ' Production with a very long name for the rehearsal on Friday evening in the studio').slice(0, 80) });
  const sizes = [{ width: 320, height: 568 }, { width: 900, height: 700 }];
  for (const size of sizes) {
    await visitPhoneStates(env({ api, production, pairContext, openPhone, openLaptop }), async (label, page) => {
      await expectNoOverflow(page, `${size.width} phone ${label}`);
      if (label === 'banner') {
        const banner = await page.locator('[data-testid=message-banner]').boundingBox();
        expect(banner!.x + banner!.width).toBeLessThanOrEqual(size.width + 1);
      }
    }, { profile: 'pixel7', context: { viewport: size } });
  }
  expect(LONG_NAME).toHaveLength(60);
});

// The browsers' own zoom and OS text size are not emulated here (MAN-12); the width of a zoomed page is what the 640 px run covers.
