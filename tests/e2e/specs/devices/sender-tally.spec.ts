import type { Page } from '@playwright/test';
import { CUT } from '../../support/api';
import { THRESHOLD } from '../../support/constants';
import { LEFT, RIGHT, liveLaptop, livePhone, putInScene, studioPreview } from '../../support/devices/fleet';
import { percentile } from '../../support/helpers';
import { sleep } from '../../support/shell';
import { expect, test } from '../../support/ui/fixtures';
import { t } from '../../support/tags';

/**
 * Tally on the sender (docs/testing.md 2.4 E2E-SWITCH-11, the device side; the Regie side of switching is another
 * engineer's area): a red frame and «LIVE» while the source is in the program, a green frame and «Als Nächstes» in the
 * preview (Studio-Modus), nothing otherwise and nothing during standby and after the end.
 */

const RED = 'rgb(248, 81, 73)';
const GREEN = 'rgb(86, 211, 100)';

/** Records every change of `[data-testid=tally][data-tally]` with `Date.now()` (same clock as the test process). */
async function recordTally(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __tallyLog?: Array<{ at: number; value: string }> };
    if (w.__tallyLog) return;
    w.__tallyLog = [];
    const read = () => document.querySelector('[data-testid=tally]')?.getAttribute('data-tally') ?? 'none';
    let last = read();
    w.__tallyLog.push({ at: Date.now(), value: last });
    new MutationObserver(() => {
      const value = read();
      if (value !== last) {
        last = value;
        w.__tallyLog!.push({ at: Date.now(), value });
      }
    }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['data-tally'], childList: true });
  });
}

async function tallyChanges(page: Page): Promise<Array<{ at: number; value: string }>> {
  return page.evaluate(() => (window as unknown as { __tallyLog: Array<{ at: number; value: string }> }).__tallyLog.slice());
}

/** What the sender shows for its tally: attribute, badge text, frame colour of the whole viewport. */
async function appearance(page: Page) {
  return page.evaluate(() => {
    const element = document.querySelector('[data-testid=tally]') as HTMLElement | null;
    if (!element) return null;
    const style = getComputedStyle(element);
    const box = element.getBoundingClientRect();
    return {
      tally: element.getAttribute('data-tally'),
      badge: (element.querySelector('.c-tally__badge') as HTMLElement | null)?.textContent?.trim() ?? null,
      shadow: style.boxShadow,
      covers: box.width >= window.innerWidth - 1 && box.height >= window.innerHeight - 1,
      pointerEvents: style.pointerEvents,
      thin: element.classList.contains('c-tally--thin'),
      compact: element.classList.contains('c-tally--compact'),
      spoken: document.querySelector('sf-tally-frame .u-sr-only')?.textContent?.trim() ?? '',
    };
  });
}

test.describe('Tally on the sender', () => {
  test(
    'E2E-SWITCH-11 [tally on the sender] red «LIVE» in the program, green «Als Nächstes» in the preview, nothing otherwise and nothing in standby or after the end; a take flips both within T-TALLY',
    t.smoke,
    async ({ regie, openPhone, openLaptop, pairContext, api, production }, testInfo) => {
      test.setTimeout(300_000);
      const k1 = await livePhone({ openPhone }, pairContext, regie, 'Handy Eins', { profile: 'pixel7' });
      const k2 = await livePhone({ openPhone }, pairContext, regie, 'Handy Zwei', { profile: 'pixel7' });
      const k3 = await livePhone({ openPhone }, pairContext, regie, 'Handy Drei', { profile: 'pixel7' });
      const lap = await liveLaptop({ openLaptop }, pairContext, regie, 'Laptop Lea');
      await lap.laptop.addCamera();
      await lap.laptop.waitForSlot('camera', 'live', 30_000);
      const camera = `${lap.device.id}/camera`;

      // K1 and S1 in the program scene (A); K2 and the laptop camera in the preview scene (B); K3 in no scene.
      const itemK1 = await putInScene(api, production, 0, k1.sourceId, LEFT);
      await putInScene(api, production, 0, lap.sourceId, RIGHT);
      await putInScene(api, production, 1, k2.sourceId, LEFT);
      await putInScene(api, production, 1, camera, RIGHT);
      await studioPreview(regie, api, production, 1);

      // Standby: nothing is on air, nothing shows a tally, although K1 is in the program scene.
      for (const sender of [k1.phone, k2.phone, k3.phone, lap.laptop]) {
        await sender.waitForTally('off');
        expect((await appearance(sender.page))!.badge, 'no badge in standby').toBeNull();
      }
      expect((await api.startBroadcast(production.id)).status).toBe(200);
      await k1.phone.waitForTally('program');
      await k2.phone.waitForTally('preview');
      await lap.laptop.waitForTally('program');
      await sleep(500);
      expect(await k3.phone.tally(), 'K3 is in no scene').toBe('off');

      const one = (await appearance(k1.phone.page))!;
      expect(one.badge, 'K1 «LIVE»').toBe('LIVE');
      expect(one.shadow, 'K1 red frame').toContain(RED);
      expect(one.covers, 'the frame covers the whole viewport').toBe(true);
      expect(one.pointerEvents, 'the frame never takes input').toBe('none');
      expect(one.spoken).toBe('Live: Dieses Gerät ist jetzt im Program.');
      const two = (await appearance(k2.phone.page))!;
      expect(two.badge, 'K2 «Als Nächstes»').toBe('Als Nächstes');
      expect(two.shadow, 'K2 green frame').toContain(GREEN);
      expect(two.spoken).toBe('Als Nächstes: Dieses Gerät ist in der Preview.');
      const three = (await appearance(k3.phone.page))!;
      expect(three.badge, 'K3 neutral').toBeNull();
      expect(three.shadow).toBe('none');
      expect(three.spoken).toBe('Nicht auf Sendung.');
      const laptop = (await appearance(lap.laptop.page))!;
      expect(laptop.tally, 'the laptop shows the strongest of its slots').toBe('program');
      expect(laptop.shadow).toContain(RED);
      expect(laptop.compact, 'a narrower frame on the laptop page').toBe(true);
      await expect(lap.laptop.slot('screen-1').locator('.c-tag--program')).toHaveText('LIVE');
      await expect(lap.laptop.slot('camera').locator('.c-tag--preview')).toHaveText('Als Nächstes');

      // Takes: K1 and K2 flip together, within T-TALLY. Ten takes (back to the start), 20 samples.
      await recordTally(k1.phone.page);
      await recordTally(k2.phone.page);
      const samples: number[] = [];
      let expectK1: 'program' | 'preview' = 'program';
      for (let take = 0; take < 10; take++) {
        expectK1 = expectK1 === 'program' ? 'preview' : 'program';
        const startedAt = Date.now();
        const response = await api.take(production.id, { transition: CUT });
        expect(response.status, response.raw.text()).toBe(200);
        const expectK2 = expectK1 === 'program' ? 'preview' : 'program';
        await k1.phone.waitForTally(expectK1);
        await k2.phone.waitForTally(expectK2);
        for (const [phone, value] of [[k1.phone, expectK1], [k2.phone, expectK2]] as const) {
          const change = (await tallyChanges(phone.page)).filter((entry) => entry.value === value && entry.at >= startedAt - 5).at(-1);
          expect(change, `${value} change recorded`).toBeTruthy();
          samples.push(change!.at - startedAt);
        }
        await sleep(1200); // a cut is not guarded, the pause only keeps the takes apart for the samples
      }
      const stats = { count: samples.length, p50: percentile(samples, 50), p95: percentile(samples, 95), max: Math.max(...samples) };
      await testInfo.attach('tally-latency.json', { body: JSON.stringify({ ...stats, samples }, null, 2), contentType: 'application/json' });
      testInfo.annotations.push({ type: 'measurement', description: `T-TALLY (take request start -> data-tally changed on the phone), ${stats.count} samples: p50 ${stats.p50} ms, p95 ${stats.p95} ms, max ${stats.max} ms` });
      expect(stats.p95, 'T-TALLY hard limit p95 500 ms').toBeLessThanOrEqual(THRESHOLD.tallyHardMs);
      // The laptop keeps the strongest tally of its two slots through every take.
      expect(await lap.laptop.tally()).toBe('program');
      // After ten takes the start is back: K1 program, K2 preview.
      await k1.phone.waitForTally('program');

      // A hidden item is off the air.
      const hidden = await api.updateSceneItem(production.id, production.sceneIds[0]!, itemK1.id, { ...itemK1, hidden: true });
      expect(hidden.status, hidden.raw.text()).toBe(200);
      await k1.phone.waitForTally('off');
      expect((await appearance(k1.phone.page))!.badge).toBeNull();
      await api.updateSceneItem(production.id, production.sceneIds[0]!, itemK1.id, { ...itemK1, hidden: false });
      await k1.phone.waitForTally('program');

      // Ended and standby: off for everybody although K1 is in the program scene; after the start red again.
      expect((await api.endBroadcast(production.id)).status).toBe(200);
      for (const sender of [k1.phone, k2.phone, lap.laptop]) await sender.waitForTally('off');
      expect((await appearance(k1.phone.page))!.shadow, 'no frame after the end').toBe('none');
      expect((await api.resetBroadcast(production.id)).status).toBe(200);
      await sleep(800);
      expect(await k1.phone.tally(), 'standby').toBe('off');
      expect((await api.startBroadcast(production.id)).status).toBe(200);
      await k1.phone.waitForTally('program');
      await k2.phone.waitForTally('preview');

      // Dark mode: a black screen with a thin frame in the tally colour; attribute and colour agree.
      await k1.phone.darkToggle().click();
      await expect(k1.phone.page.locator('.c-phone__dark')).toBeVisible();
      const dark = (await appearance(k1.phone.page))!;
      expect(dark.thin, 'thin frame').toBe(true);
      expect(dark.tally).toBe('program');
      expect(dark.shadow).toContain(RED);
      expect(await k1.phone.page.evaluate(() => getComputedStyle(document.querySelector('.c-phone__dark')!).backgroundColor)).toMatch(/^rgb\(0, 0, 0\)|rgba\(0, 0, 0/);
      await api.take(production.id, { transition: CUT });
      await k1.phone.waitForTally('preview');
      const darkPreview = (await appearance(k1.phone.page))!;
      expect(darkPreview.thin).toBe(true);
      expect(darkPreview.shadow, 'the thin frame turns green with the preview').toContain(GREEN);
    },
  );
});
