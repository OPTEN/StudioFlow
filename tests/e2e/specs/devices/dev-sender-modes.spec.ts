import type { Page } from '@playwright/test';
import { findGerman } from '../../support/a11y/english';
import { collectTexts } from '../../support/a11y/german';
import { expectNoOverflow, readOverflow, readTargets, smallTargets } from '../../support/devices/layout';
import { visitLaptopStates, visitPhoneStates, type SenderStateEnv } from '../../support/devices/states';
import { sleep } from '../../support/shell';
import { AxeBuilder } from '@axe-core/playwright';
import { knownDevBug } from '../../support/devices/bugs';
import { expectNoSeriousViolations } from '../../support/ui/a11y';
import { expect, test } from '../../support/ui/fixtures';
import { t } from '../../support/tags';

/**
 * DEV, the sender parts that look at every state in a different mode (docs/testing.md 2.8): the viewport matrix, axe, reduced
 * motion, the English text audit, forced colours and zoom. The states come from support/devices/states.ts (the same screens
 * as in dev-sender.spec.ts).
 */

const MATRIX = [
  { name: '320 portrait', width: 320, height: 568 },
  { name: '320 landscape', width: 568, height: 320 },
  { name: '375 portrait', width: 375, height: 667 },
  { name: '375 landscape', width: 667, height: 375 },
  { name: '412 portrait', width: 412, height: 915 },
  { name: '412 landscape', width: 915, height: 412 },
  { name: '768 portrait', width: 768, height: 1024 },
  { name: '768 landscape', width: 1024, height: 768 },
  { name: '1280 landscape', width: 1280, height: 720 },
  { name: '1280 portrait', width: 720, height: 1280 },
] as const;

function env(fixtures: SenderStateEnv): SenderStateEnv {
  return fixtures;
}

test.describe('DEV sender, modes', () => {
  test(
    'E2E-DEV-07 [ui, viewport matrix] the sender at 320 / 375 / 412 / 768 / 1280 px in portrait and landscape: no horizontal scroll, targets of 44 px, in every state of the phone and the laptop',
    t.p0,
    async ({ openPhone, openLaptop, api, production, pairContext }, testInfo) => {
      test.setTimeout(400_000);
      const rows: string[] = [];
      const check = async (kind: string, label: string, page: Page) => {
        for (const size of MATRIX) {
          await page.setViewportSize({ width: size.width, height: size.height });
          await sleep(150);
          const overflow = await readOverflow(page);
          const small = smallTargets(await readTargets(page));
          rows.push(`${kind} ${label} @ ${size.name}: overflow ${overflow.document}, small targets ${small.length}`);
          expect(overflow.document, `${kind} ${label} @ ${size.name}: horizontal scroll (${overflow.outside.join(' | ')})`).toBeLessThanOrEqual(0);
          expect(small.map((target) => `${target.tag} “${target.label}” ${target.width}x${target.height}`), `${kind} ${label} @ ${size.name}: targets under 44 px`).toEqual([]);
        }
        await page.setViewportSize({ width: 412, height: 915 });
      };
      await visitPhoneStates(env({ api, production, pairContext, openPhone, openLaptop }), (label, page) => check('phone', label, page), { profile: 'pixel7' });
      await visitLaptopStates(env({ api, production, pairContext, openPhone, openLaptop }), (label, page) => check('laptop', label, page), { profile: 'desktop' });
      await testInfo.attach('viewport-matrix.txt', { body: rows.join('\n'), contentType: 'text/plain' });
    },
  );

  test(
    'E2E-DEV-15 [ui, sender] axe on every state of the sender (wcag2a, wcag2aa): no critical or serious violation',
    t.p1,
    async ({ openPhone, openLaptop, api, production, pairContext }) => {
      test.setTimeout(300_000);
      // Colour contrast findings are reviewed one by one: none are silenced here (an empty accepted list).
      // The dark mode screen is its own test below (DEV-05).
      await visitPhoneStates(env({ api, production, pairContext, openPhone, openLaptop }), async (label, page) => {
        if (label !== 'dark') await expectNoSeriousViolations(page, `sender-phone-${label}`);
      }, { profile: 'pixel7' });
      await visitLaptopStates(env({ api, production, pairContext, openPhone, openLaptop }), async (label, page) => {
        await expectNoSeriousViolations(page, `sender-laptop-${label}`);
      }, { profile: 'desktop' });
    },
  );

  test(
    'E2E-DEV-15 [ui, sender, dark mode] the text of the dark screen (slot code and “Tap for controls”) meets the contrast of WCAG AA (DEV-05)',
    t.p1,
    async ({ openPhone, openLaptop, api, production, pairContext }, testInfo) => {
      knownDevBug('DEV-05', 'dark mode: the slot code and the hint are dim grey on black, below 4.5:1');
      test.setTimeout(300_000);
      const found: Array<{ selector: string; ratio: number; fg: string; bg: string; expected: number }> = [];
      await visitPhoneStates(env({ api, production, pairContext, openPhone, openLaptop }), async (label, page) => {
        if (label !== 'dark') return;
        const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
        for (const violation of result.violations.filter((candidate) => candidate.id === 'color-contrast')) {
          for (const node of violation.nodes) {
            const data = (node.any[0]?.data ?? {}) as { contrastRatio?: number; fgColor?: string; bgColor?: string; expectedContrastRatio?: string };
            found.push({ selector: node.target.join(' '), ratio: data.contrastRatio ?? 0, fg: data.fgColor ?? '', bg: data.bgColor ?? '', expected: parseFloat(data.expectedContrastRatio ?? '4.5') });
          }
        }
      }, { profile: 'pixel7' });
      await testInfo.attach('axe-dark-contrast.json', { body: JSON.stringify(found, null, 2), contentType: 'application/json' });
      expect(found.map((entry) => `${entry.selector}: ${entry.ratio}:1 (${entry.fg} on ${entry.bg}), needs ${entry.expected}:1`), 'colour contrast findings on the dark screen').toEqual([]);
    },
  );

  test(
    'E2E-DEV-16 [ui, sender] reduced motion: no transition and no animation runs on any state of the sender (while the normal mode does animate)',
    t.p1,
    async ({ openPhone, openLaptop, api, production, pairContext }) => {
      test.setTimeout(300_000);
      const animated = (page: Page) =>
        page.evaluate(() =>
          [...document.querySelectorAll<HTMLElement>('body, body *')]
            .filter((element) => {
              const style = getComputedStyle(element);
              const transitions = style.transitionDuration.split(',').some((value) => parseFloat(value) > 0) && style.transitionProperty !== 'none';
              const animations = style.animationName !== 'none' && style.animationDuration.split(',').some((value) => parseFloat(value) > 0);
              return transitions || animations;
            })
            .map((element) => `${element.tagName.toLowerCase()}.${(element.className?.toString() ?? '').split(/\s+/)[0]}`)
            .slice(0, 8),
        );
      const normal = await openPhone({ profile: 'pixel7' });
      await normal.gotoStart();
      await expect(normal.page.getByRole('heading', { name: 'Pair device' })).toBeVisible();
      expect((await animated(normal.page)).length, 'the normal mode has transitions (buttons), so the reduced check is meaningful').toBeGreaterThan(0);

      const run = async (label: string, page: Page) => {
        expect(await animated(page), `reduced motion: ${label} runs no transition or animation`).toEqual([]);
      };
      await visitPhoneStates(env({ api, production, pairContext, openPhone, openLaptop }), run, { profile: 'pixel7', context: { reducedMotion: 'reduce' } });
      await visitLaptopStates(env({ api, production, pairContext, openPhone, openLaptop }), (label, page) => run(`laptop ${label}`, page), { profile: 'desktop', context: { reducedMotion: 'reduce' } });
    },
  );

  test(
    'E2E-DEV-17 [ui, sender] English text audit of the sender: no German in any state, lang en',
    t.p1,
    async ({ openPhone, openLaptop, api, production, pairContext }) => {
      test.setTimeout(300_000);
      const german: string[] = [];
      const audit = async (label: string, page: Page) => {
        expect(await page.evaluate(() => document.documentElement.lang), `${label}: lang`).toBe('en');
        for (const finding of await findGerman(await collectTexts(page))) german.push(`[${label}] ${finding}`);
      };
      await visitPhoneStates(env({ api, production, pairContext, openPhone, openLaptop }), (label, page) => audit(`phone ${label}`, page), { profile: 'pixel7' });
      await visitLaptopStates(env({ api, production, pairContext, openPhone, openLaptop }), (label, page) => audit(`laptop ${label}`, page), { profile: 'desktop' });
      expect(german, 'German text in the English sender').toEqual([]);
    },
  );

  test(
    'E2E-DEV-22 [ui, sender] forced colours and 200 % zoom: states stay distinguishable by text, borders stay visible, 640 x 360 has no horizontal scroll',
    t.p2,
    async ({ openPhone, openLaptop, api, production, pairContext }) => {
      test.setTimeout(300_000);
      const words = new Map<string, string>();
      const check = async (label: string, page: Page) => {
        await page.emulateMedia({ forcedColors: 'active' });
        const facts = await page.evaluate(() => {
          const button = document.querySelector('.c-button') as HTMLElement | null;
          const style = button ? getComputedStyle(button) : null;
          return {
            forced: matchMedia('(forced-colors: active)').matches,
            status: [...document.querySelectorAll('[role=status], [role=alert], h1, [data-testid=connection-state]')].map((element) => element.textContent?.replace(/\s+/g, ' ').trim()).filter(Boolean).join(' | '),
            buttonBorder: style ? `${style.borderTopStyle} ${style.borderTopWidth}` : null,
          };
        });
        expect(facts.forced, 'forced colours are emulated').toBe(true);
        expect(facts.status.length, `${label}: the state has words (not only colour)`).toBeGreaterThan(5);
        if (facts.buttonBorder) expect(facts.buttonBorder, `${label}: button borders stay`).toMatch(/solid [1-9]/);
        words.set(label, facts.status);
        await page.setViewportSize({ width: 640, height: 360 });
        await sleep(150);
        await expectNoOverflow(page, `${label} at 640 x 360 (200 % zoom of 1280 x 720)`);
        await page.setViewportSize({ width: 412, height: 915 });
        await page.emulateMedia({ forcedColors: 'none' });
      };
      await visitPhoneStates(env({ api, production, pairContext, openPhone, openLaptop }), check, { profile: 'pixel7' });
      expect(words.get('replaced')).toContain('Opened in another tab');
      expect(words.get('blocked')).toContain('Blocked');
      await visitLaptopStates(env({ api, production, pairContext, openPhone, openLaptop }), (label, page) => check(`laptop ${label}`, page), { profile: 'desktop' });
      expect(words.get('laptop station-live')).toContain('Connected');
    },
  );
});
