import { expect, test } from '../../support/fixtures';
import { LiveKitPage } from '../../support/livekit-browser';
import { sampleMemory, throttleCpu } from '../../support/net';
import { t } from '../../support/tags';

/**
 * E2E-NET-00 (CDP helpers): the memory counters and the CPU throttle used by the performance and soak specs work on
 * this machine and detect what they are meant to detect (a retained allocation, a slower main thread).
 */

test.describe('CDP helpers', () => {
  test('E2E-NET-00 [cdp-memory] memory counters follow a retained allocation and a detached DOM; CPU throttling slows the main thread', t.smoke, async ({ context }) => {
    const lk = await LiveKitPage.open(context, 'cdp');
    const page = lk.page;
    try {
      const before = await sampleMemory(page);
      expect(before.nodes, 'DOM node counter').toBeGreaterThan(0);
      expect(before.documents).toBeGreaterThan(0);

      await page.evaluate(() => {
        const keep = (window as unknown as { __keep: unknown[] });
        keep.__keep = [new Array(2_000_000).fill(1.5)];
        const host = document.createElement('div');
        for (let index = 0; index < 5000; index++) host.appendChild(document.createElement('span'));
        document.body.appendChild(host);
      });
      const grown = await sampleMemory(page);
      expect(grown.jsHeapUsed - before.jsHeapUsed, 'heap grows by the retained array').toBeGreaterThan(8_000_000);
      expect(grown.nodes - before.nodes, 'node counter grows by the added spans').toBeGreaterThanOrEqual(5000);

      await page.evaluate(() => {
        (window as unknown as { __keep: unknown[] }).__keep = [];
        document.body.lastElementChild?.remove();
      });
      // Blink releases the node counter a moment after the collection: sample until it has (this is also how the leak
      // checks of the soak specs read it).
      let released = await sampleMemory(page);
      for (let attempt = 0; attempt < 8 && grown.nodes - released.nodes < 5000; attempt++) {
        await page.waitForTimeout(250);
        released = await sampleMemory(page);
      }
      expect(grown.jsHeapUsed - released.jsHeapUsed, 'heap shrinks again after a forced GC').toBeGreaterThan(8_000_000);
      expect(grown.nodes - released.nodes, 'nodes are released').toBeGreaterThanOrEqual(5000);

      const burn = () =>
        page.evaluate(() => {
          const started = performance.now();
          let sum = 0;
          for (let index = 0; index < 20_000_000; index++) sum += Math.sqrt(index);
          return { ms: performance.now() - started, sum };
        });
      await burn();
      const normal = (await burn()).ms;
      const cdp = await throttleCpu(page, 4);
      const slow = (await burn()).ms;
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
      await cdp.detach().catch(() => undefined);
      test.info().annotations.push({ type: 'measurement', description: `busy loop: ${Math.round(normal)} ms normal, ${Math.round(slow)} ms with 4x CPU throttling` });
      expect(slow / normal, 'CPU throttling slows the main thread').toBeGreaterThan(2);
    } finally {
      await lk.close();
    }
  });
});
