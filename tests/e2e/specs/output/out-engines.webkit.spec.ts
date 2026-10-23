import { TEXT } from '../../support/text';
import { makePng } from '../../support/media-samples';
import { installInitScript } from '../../support/net';
import { expect, test } from '../../support/ui/fixtures';
import { OutputPage } from '../../support/ui/output';
import { installProbe } from '../../support/output/probe';
import { goLive, placeItem } from '../../support/output/world';
import { t } from '../../support/tags';

/**
 * E2E-OUT-17 in WebKit (Safari's engine). WebKit on Windows has no usable WebRTC (research 2026-10-22), so no camera or
 * screen can be shown; what the output must still do without a media server is rendered here: the slates, an image asset
 * served with the output key, «Kein Zugang», and the letterboxing. The pages are opened under https://127.0.0.1 (WebKit
 * resolves localhost to ::1, where Docker Desktop never answers; the stack serves 127.0.0.1 as an extra host).
 */

test.describe('OUT other engines (WebKit, no WebRTC)', () => {
  test(
    'E2E-OUT-17 [webkit] without WebRTC the output still shows the slates, an image item and «Kein Zugang», letterboxes and does not scroll',
    t.p1,
    async ({ browser, api, production, config, browserName, onCleanup }, testInfo) => {
      test.setTimeout(120_000);
      expect(browserName).toBe('webkit');
      const base = config.baseURL.replace('//localhost', '//127.0.0.1');
      const context = await browser.newContext({ baseURL: base, ignoreHTTPSErrors: true, locale: 'en-US', timezoneId: 'Europe/Zurich', viewport: { width: 800, height: 600 } });
      onCleanup(() => context.close());
      await installInitScript(context);
      await installProbe(context);
      const uploaded = await api.uploadAsset(production.id, { fileName: 'Bild.png', contentType: 'image/png', data: makePng(640, 360, [30, 120, 220]) });
      expect(uploaded.status, uploaded.raw.text().slice(0, 200)).toBe(201);
      await placeItem(api, production, production.sceneIds[0]!, uploaded.body.id, { x: 0, y: 0, w: 1920, h: 1080, fit: 'cover', radius: 0 });

      const output = await OutputPage.open(context, production, {}, { viewport: { width: 800, height: 600 } });
      testInfo.annotations.push({ type: 'webkit', description: `RTCPeerConnection: ${await output.page.evaluate(() => typeof RTCPeerConnection)}` });
      await expect.poll(() => output.slateText(), { timeout: 20_000 }).toContain(TEXT.slate.standby);
      await goLive(api, production);
      // The image item: loaded with the key, visible, covering the stage.
      await expect
        .poll(() => output.page.evaluate(() => {
          const img = document.querySelector('img.sf-r-media--image') as HTMLImageElement | null;
          return Boolean(img && img.naturalWidth > 0 && getComputedStyle(img).visibility === 'visible');
        }), { timeout: 20_000, message: 'the image asset is visible' })
        .toBe(true);
      await expect.poll(() => output.slateText(), { timeout: 10_000 }).not.toContain(TEXT.slate.standby);
      const stage = await output.stagePixels();
      const centre = stage.at(960, 540);
      expect(Math.abs(centre[2] - 220) <= 40 && Math.abs(centre[0] - 30) <= 40, `the image shows (blue), got ${centre}`).toBe(true);

      // Letterboxing in a 4:3 frame; no scrollbars.
      const box = (await (await output.stage()).boundingBox())!;
      expect([Math.round(box.width), Math.round(box.height)]).toEqual([800, 450]);
      const bar = (await output.viewportPixels()).pixel(400, 20);
      expect([bar[0], bar[1], bar[2]], 'the bar is black').toEqual([0, 0, 0]);
      const scroll = await output.page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, sh: document.documentElement.scrollHeight, ch: document.documentElement.clientHeight }));
      expect(scroll.sw).toBeLessThanOrEqual(scroll.cw);
      expect(scroll.sh).toBeLessThanOrEqual(scroll.ch);

      // Slates.
      expect((await api.endBroadcast(production.id)).status).toBe(200);
      await expect.poll(() => output.slateText(), { timeout: 10_000 }).toContain(TEXT.slate.end);

      // A wrong key.
      const denied = await context.newPage();
      await denied.goto(`/o/${production.slug}?k=${'A'.repeat(43)}`);
      await expect.poll(() => denied.evaluate(() => document.body.innerText), { timeout: 15_000 }).toContain(TEXT.slate.denied);
      expect(output.problems.pageErrors, 'no uncaught error without WebRTC').toEqual([]);
    },
  );
});
