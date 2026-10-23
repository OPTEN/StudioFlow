import { DE } from '../../support/constants';
import { expect, test } from '../../support/ui/fixtures';
import { openProbedOutput, waitForReportedPicture } from '../../support/output/open';
import { recordMeasurement, summarize, fmt } from '../../support/output/stats';
import { FULL, addCamera, addScreens, goLive, placeItem } from '../../support/output/world';
import { t } from '../../support/tags';

/**
 * OUT - the output page as the audience and the proxy see it (docs/testing.md 2.6): basics, program rendering.
 * The cameras are real phone senders publishing the latency stamp camera, the screens real laptop senders with fake
 * (flat colour) screens, the SFU the real LiveKit of the stack. The output page has no data-state / data-slate hooks:
 * the specs read the DOM through the probe (support/output/browser/output-probe.js).
 */

test.describe('OUT basics', () => {
  test(
    "E2E-OUT-01 [output] standby: slate «Gleich geht's los» with the production name, nothing else on the page, de-CH, own origin only, fast",
    t.smoke,
    async ({ browser, production, config, onCleanup }) => {
      const loads: Array<{ slateMs: number; loadMs: number; domContentMs: number }> = [];
      const origins = new Set<string>();
      let last!: Awaited<ReturnType<typeof openProbedOutput>>;
      // Five cold loads (every run has a fresh context, so an empty HTTP cache): navigation start -> slate in the DOM,
      // and the load event.
      for (let run = 0; run < 5; run++) {
        const opened = await openProbedOutput({ browser, onCleanup }, production, {}, {});
        const page = opened.output.page;
        await expect
          .poll(() => page.evaluate(() => document.querySelector('.sf-r-slate-title')?.textContent ?? ''), { timeout: 10_000 })
          .toContain(DE.slateStandby);
        const timing = await page.evaluate(() => {
          const probe = (window as unknown as { __outProbe?: { events: Array<{ t: number; type: string }> } }).__outProbe;
          const slate = probe?.events.find((event) => event.type === 'slate+');
          const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
          return {
            slateMs: slate ? slate.t - performance.timeOrigin : NaN,
            loadMs: nav.loadEventEnd,
            domContentMs: nav.domContentLoadedEventEnd,
          };
        });
        loads.push(timing);
        for (const entry of await page.evaluate(() => performance.getEntriesByType('resource').map((resource) => resource.name))) {
          origins.add(new URL(entry).origin);
        }
        if (run === 4) last = opened;
        else await opened.context.close();
      }
      const slate = summarize(loads.map((load) => load.slateMs));
      const load = summarize(loads.map((entry) => entry.loadMs));
      await recordMeasurement(test.info(), 'out-01-load', { loads, slate, load }, `slate visible ${fmt(slate)} ms; load event ${fmt(load)} ms`);
      expect(slate.max, 'T-LOAD: navigation -> slate in the DOM (hard 1 s)').toBeLessThanOrEqual(1000);
      expect(load.max, 'T-LOAD: load event (hard 2 s)').toBeLessThanOrEqual(2000);

      // The content of the page.
      const { output, probe } = last;
      const frame = await output.frame();
      const facts = await frame.evaluate(() => ({
        lang: document.documentElement.lang,
        interactive: document.querySelectorAll('button, a, input, select, textarea, [role=button], [tabindex]').length,
        text: document.body.innerText.replace(/\s+/g, ' ').trim(),
        title: document.querySelector('.sf-r-slate-title')?.textContent,
        subtitle: document.querySelector('.sf-r-slate-subtitle')?.textContent,
        videos: document.querySelectorAll('video').length,
      }));
      expect(facts.lang).toBe('de-CH');
      expect(facts.title).toBe(DE.slateStandby);
      expect(facts.subtitle, 'the subtitle is the production name').toBe(production.name);
      expect(facts.text, 'no other text than the slate').toBe(`${DE.slateStandby} ${production.name}`);
      expect(facts.interactive, 'no controls, links or inputs').toBe(0);
      expect(facts.videos).toBe(0);
      expect(await probe.standbySeen()).toBe(true);
      const slateBox = await frame.locator('.sf-r-slate').boundingBox();
      const stageBox = await (await output.stage()).boundingBox();
      expect(slateBox!.width, 'the slate covers the stage').toBeCloseTo(stageBox!.width, 0);
      expect(slateBox!.height).toBeCloseTo(stageBox!.height, 0);
      expect(output.problems.pageErrors, 'no uncaught error').toEqual([]);
      expect(output.problems.consoleErrors, 'no console error').toEqual([]);
      expect(output.problems.cspViolations, 'no CSP violation').toEqual([]);
      expect(
        [...origins].filter((origin) => origin !== new URL(config.baseURL).origin && origin !== 'null'),
        'requests go to the stack origin only',
      ).toEqual([]);
    },
  );

  test(
    'E2E-OUT-02 [output, K1 + S1] program rendering: two muted playing videos at the item rectangles x stage scale, no audio receiver, autoplay without a gesture (direct and in an iframe)',
    t.smoke,
    async ({ browser, api, production, pairContext, openPhone, openLaptop, onCleanup }) => {
      test.setTimeout(180_000);
      const deps = { api, production, pairContext, openPhone, openLaptop };
      const camera = await addCamera(deps, 'Kamera Eins');
      const screens = await addScreens(deps, 'Laptop Eins', 1);
      const scene = production.sceneIds[0]!;
      const geometry = {
        camera: { x: 120, y: 90, w: 960, h: 540 },
        screen: { x: 960, y: 450, w: 880, h: 495 },
      };
      const cameraItem = await placeItem(api, production, scene, camera.source, { ...FULL, ...geometry.camera, fit: 'cover', radius: 0 });
      const screenItem = await placeItem(api, production, scene, screens.sources[0]!, { ...FULL, ...geometry.screen, fit: 'contain', radius: 0 });
      await goLive(api, production);

      // Direct, in a 1280 x 720 viewport: the stage is scaled by 2/3.
      const direct = await openProbedOutput({ browser, onCleanup }, production, {}, { viewport: { width: 1280, height: 720 } });
      const measured = await direct.output.waitForPlayingVideos(2, { minFps: 10, timeout: 30_000 });
      for (const video of measured) {
        expect(video.muted, 'muted').toBe(true);
        expect(video.playsInline, 'playsinline').toBe(true);
        expect(video.autoplay, 'autoplay').toBe(true);
      }
      const scale = 1280 / 1920;
      const items = await direct.output.items();
      expect(items).toHaveLength(2);
      for (const [id, rect] of [[cameraItem.id, geometry.camera], [screenItem.id, geometry.screen]] as const) {
        const box = items.find((entry) => entry.id === id)!.box;
        expect(Math.abs(box.x - rect.x * scale), `item ${id} x ${box.x}`).toBeLessThanOrEqual(1);
        expect(Math.abs(box.y - rect.y * scale), `item ${id} y ${box.y}`).toBeLessThanOrEqual(1);
        expect(Math.abs(box.width - rect.w * scale), `item ${id} width ${box.width}`).toBeLessThanOrEqual(1);
        expect(Math.abs(box.height - rect.h * scale), `item ${id} height ${box.height}`).toBeLessThanOrEqual(1);
      }
      // No audio is received (spec 7: no audio yet): no audio receiver on any peer connection of the page.
      const frame = await direct.output.frame();
      // LiveKit negotiates three receive-only audio transceivers up front (the SDK/SFU default, not the product's
      // choice): they exist but stay muted without RTP, so "no audio receiver" is asserted as "no audio arrives".
      const receivers = await frame.evaluate(async () => {
        const peers = [...(window as unknown as { __sfNet: { peers: Set<RTCPeerConnection> } }).__sfNet.peers];
        const result: Array<{ audioTracksUnmuted: number; audioInbound: number; videoInbound: number }> = [];
        for (const peer of peers) {
          const stats = [...(await peer.getStats()).values()].filter((entry) => entry.type === 'inbound-rtp');
          result.push({
            audioTracksUnmuted: peer.getReceivers().filter((receiver) => receiver.track.kind === 'audio' && !receiver.track.muted).length,
            audioInbound: stats.filter((entry) => entry.kind === 'audio').length,
            videoInbound: stats.filter((entry) => entry.kind === 'video').length,
          });
        }
        return result;
      });
      expect(receivers.length, 'the output has a peer connection').toBeGreaterThanOrEqual(1);
      expect(receivers.map((peer) => peer.audioTracksUnmuted), 'no audio track carries data').toEqual(receivers.map(() => 0));
      expect(receivers.map((peer) => peer.audioInbound), 'no inbound audio RTP stream').toEqual(receivers.map(() => 0));
      expect(receivers.reduce((sum, peer) => sum + peer.videoInbound, 0), 'inbound video for the two sources').toBeGreaterThanOrEqual(2);
      // Autoplay needed no gesture: nobody clicked before the first video played, the console has no autoplay warning.
      expect(direct.output.problems.consoleErrors).toEqual([]);

      // The same in an iframe with allow="autoplay; fullscreen" (the way the proxy embeds it).
      const embedded = await openProbedOutput({ browser, onCleanup }, production, {}, { embed: { size: { width: 1280, height: 720 } } });
      // Autoplay without a gesture, asked the quiet way: nothing talks to the frame until the picture is there.
      await waitForReportedPicture(api, production);
      expect(await embedded.probe.activationAtFirstPlay(), 'in the iframe: no user gesture before the first video played').toBe(false);
      const embeddedMeasured = await embedded.output.waitForPlayingVideos(2, { minFps: 10, timeout: 30_000 });
      for (const video of embeddedMeasured) expect(video.muted && video.autoplay && video.playsInline).toBe(true);
      expect(embedded.output.problems.cspViolations).toEqual([]);
    },
  );
});
