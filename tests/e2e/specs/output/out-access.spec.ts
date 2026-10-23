import { OutputApi } from '../../support/api';
import { TEXT } from '../../support/text';
import { livekitAdmin } from '../../support/livekit';
import { cleanupProduction, createProduction } from '../../support/production';
import { expect, test } from '../../support/ui/fixtures';
import { newUiContext } from '../../support/ui/init';
import { GROUND, sleep, toneOf } from '../../support/output/analysis';
import { openProbedOutput } from '../../support/output/open';
import { OutputProbe, installProbe } from '../../support/output/probe';
import { fmt, recordMeasurement, summarize } from '../../support/output/stats';
import { FULL, addScreens, goLive, placeItem } from '../../support/output/world';
import { t } from '../../support/tags';

/**
 * Who may see the output, and how it behaves when access is taken away or the page is reloaded (docs/testing.md
 * E2E-OUT-10, -12, -25 with E2E-AUTH-23 and -24 from the output's point of view). «Kein Zugang» is the only thing a
 * refused page shows; it retries at most every 30 s; a corrected link or address brings the picture back.
 */

const DENIED_SUBTITLE = 'Der Output-Link ist ungültig oder abgelaufen.';

function outputParticipants(production: { id: string }) {
  return livekitAdmin.listParticipants(production.id).then((participants) => participants.filter((participant) => participant.identity.startsWith('output_')));
}

test.describe('OUT access and reload', () => {
  test(
    'E2E-OUT-12 [output, access denied] wrong key, missing key, unknown slug, key of another production: the same «Kein Zugang» slate, no picture, at most one attempt every 30 s; the corrected link works',
    t.p0,
    async ({ browser, api, production, config, onCleanup }) => {
      test.setTimeout(240_000);
      const other = await createProduction(api, 'OUT-12 fremd');
      onCleanup(() => cleanupProduction(other));
      const cases = [
        { name: 'wrong key', path: `/o/${production.slug}?k=${'A'.repeat(43)}`, network: true },
        { name: 'missing key', path: `/o/${production.slug}`, network: false },
        { name: 'unknown slug', path: `/o/gibt-es-nicht-xyz?k=${production.outputKey}`, network: true },
        { name: 'key of another production', path: `/o/${production.slug}?k=${other.outputKey}`, network: true },
      ];
      const opened = [];
      for (const entry of cases) {
        const context = await newUiContext(browser);
        onCleanup(() => context.close());
        await installProbe(context);
        const page = await context.newPage();
        const requests: Array<{ t: number; url: string }> = [];
        const consoleTexts: string[] = [];
        page.on('request', (request) => {
          if (/\/hubs\/output|\/api\/output\//.test(request.url())) requests.push({ t: Date.now(), url: request.url() });
        });
        page.on('console', (message) => consoleTexts.push(message.text()));
        const started = Date.now();
        await page.goto(entry.path);
        opened.push({ ...entry, page, requests, consoleTexts, started });
      }

      // Immediately: the slate, nothing else.
      const facts = [];
      for (const entry of opened) {
        await expect
          .poll(() => entry.page.evaluate(() => document.querySelector('.sf-r-slate-title')?.textContent ?? ''), { timeout: 10_000, message: `${entry.name}: slate` })
          .toBe(TEXT.slate.denied);
        await sleep(500);
        facts.push(await entry.page.evaluate(() => ({
          text: document.body.innerText.replace(/\s+/g, ' ').trim(),
          title: document.querySelector('.sf-r-slate-title')?.textContent,
          subtitle: document.querySelector('.sf-r-slate-subtitle')?.textContent,
          layers: document.querySelectorAll('.sf-r-layer').length,
          videos: document.querySelectorAll('video').length,
          items: document.querySelectorAll('[data-item-id]').length,
          slateOpacity: getComputedStyle(document.querySelector('.sf-r-slate')!).opacity,
          denySlate: (window as unknown as { __outProbe: { denySeen: boolean } }).__outProbe.denySeen,
        })));
      }
      for (const [index, entry] of opened.entries()) {
        expect(facts[index]!.title, `${entry.name}: title`).toBe(TEXT.slate.denied);
        expect(facts[index]!.subtitle, `${entry.name}: subtitle`).toBe(DENIED_SUBTITLE);
        expect(facts[index]!.layers + facts[index]!.videos + facts[index]!.items, `${entry.name}: no scene content`).toBe(0);
        expect(facts[index], `${entry.name} looks exactly like the first case`).toEqual(facts[0]);
      }
      // The key is never written into the DOM or the console.
      for (const entry of opened) {
        for (const secret of [production.outputKey, other.outputKey]) {
          expect(await entry.page.evaluate(() => document.documentElement.outerHTML), `${entry.name}: key not in the DOM`).not.toContain(secret);
          expect(entry.consoleTexts.join('\n'), `${entry.name}: key not in the console`).not.toContain(secret);
        }
      }
      // REST: the answer for a wrong key and an unknown slug is byte-identical (no hint whether the slug exists).
      const wrongKey = await new OutputApi(config.baseURL, production.slug, 'A'.repeat(43)).getOutputSnapshot();
      const unknownSlug = await new OutputApi(config.baseURL, 'gibt-es-nicht-xyz', production.outputKey).getOutputSnapshot();
      expect(wrongKey.status).toBe(403);
      expect(unknownSlug.status).toBe(403);
      const withoutTrace = (text: string) => text.replace(/"traceId":"[^"]*"/, '"traceId":"-"');
      expect(withoutTrace(unknownSlug.raw.text()), 'identical body (the trace id aside)').toBe(withoutTrace(wrongKey.raw.text()));

      // Observe for 70 s: attempts are at least ~30 s apart and there are at most three.
      const watchUntil = Math.min(...opened.map((entry) => entry.started)) + 71_000;
      await sleep(Math.max(0, watchUntil - Date.now()));
      const attempts: Record<string, number[]> = {};
      for (const entry of opened) {
        const clusters: number[] = [];
        for (const request of entry.requests) if (clusters.length === 0 || request.t - clusters.at(-1)! > 3000) clusters.push(request.t);
        attempts[entry.name] = clusters.map((time) => Math.round((time - entry.started) / 100) / 10);
        if (!entry.network) {
          expect(entry.requests.length, `${entry.name}: a link without a key makes no request at all`).toBe(0);
          continue;
        }
        expect(clusters.length, `${entry.name}: attempts in 71 s (at ${attempts[entry.name]!.join(', ')} s)`).toBeLessThanOrEqual(3);
        for (let index = 1; index < clusters.length; index++) expect(clusters[index]! - clusters[index - 1]!, `${entry.name}: attempts are >= 30 s apart`).toBeGreaterThanOrEqual(29_000);
      }
      await recordMeasurement(test.info(), 'out-12-attempts', { attemptsAtSeconds: attempts }, Object.entries(attempts).map(([name, times]) => `${name}: ${times.join('/') || 'none'} s`).join('; '));
      for (const entry of opened) {
        expect(await entry.page.evaluate(() => document.querySelector('.sf-r-slate-title')?.textContent), `${entry.name}: still denied`).toBe(TEXT.slate.denied);
      }

      // The corrected link works after a reload.
      const fixed = opened[0]!;
      await fixed.page.goto(`/o/${production.slug}?k=${production.outputKey}`);
      await expect
        .poll(() => fixed.page.evaluate(() => document.querySelector('.sf-r-slate-title')?.textContent ?? ''), { timeout: 10_000, message: 'the corrected link shows the standby slate' })
        .toBe(TEXT.slate.standby);
    },
  );

  test(
    'E2E-OUT-25 [output, key rotation] a new key kicks the open page within T-KEY: only «Kein Zugang» is left, LiveKit has no old output, the old link stays refused and the new link plays',
    t.p0,
    async ({ browser, api, production, pairContext, openPhone, openLaptop, onCleanup }) => {
      test.setTimeout(240_000);
      const deps = { api, production, pairContext, openPhone, openLaptop };
      const screens = await addScreens(deps, 'Laptop Farben', 1);
      await placeItem(api, production, production.sceneIds[0]!, screens.sources[0]!, FULL);
      await goLive(api, production);
      const opened = await openProbedOutput({ browser, onCleanup }, production, {}, { viewport: { width: 1280, height: 720 } });
      const { output, probe } = opened;
      await output.waitForPlayingVideos(1, { minFps: 5, timeout: 45_000 });
      expect((await outputParticipants(production)).length, 'one output in the room').toBe(1);
      const oldUrl = production.outputUrl;
      await probe.takeEvents();

      const sentAt = Date.now();
      const rotated = await api.regenerateOutputKey(production.id);
      expect(rotated.status).toBe(200);
      await expect
        .poll(async () => (await probe.snapshot()).slate?.title, { timeout: 4000, intervals: [50], message: 'the open page shows «Kein Zugang»' })
        .toBe(TEXT.slate.denied);
      const events = await probe.takeEvents();
      const denied = events.find((event) => event.type === 'slate+' && event.title === TEXT.slate.denied) ?? { t: Date.now() };
      const keyMs = denied.t - sentAt;
      await expect.poll(async () => (await outputParticipants(production)).length, { timeout: 4000, intervals: [100], message: 'no output participant of the old key in LiveKit' }).toBe(0);
      const gone = Date.now() - sentAt;
      await recordMeasurement(test.info(), 'out-25-key', { requestToSlateMs: keyMs, requestToLiveKitGoneMs: gone }, `key regenerated -> «Kein Zugang» after ${Math.round(keyMs)} ms, LiveKit participant gone after ${gone} ms`);
      expect(keyMs, 'T-KEY: connected outputs are kicked (hard 2 s)').toBeLessThanOrEqual(2000);
      expect(gone, 'T-KEY: LiveKit participant removed (hard 2 s)').toBeLessThanOrEqual(2500);

      // Only the slate is left: no scene layer, no video, the stage shows the slate ground.
      const snapshot = await probe.snapshot();
      expect(snapshot.layers, 'no scene content').toEqual([]);
      expect(snapshot.videos, 'no video element').toBe(0);
      expect(snapshot.items).toEqual([]);
      expect(snapshot.slate?.subtitle).toBe(DENIED_SUBTITLE);
      await expect.poll(async () => toneOf((await output.stagePixels()).at(960, 1000)), { timeout: 3000, message: 'the stage shows the slate ground' }).toBe('dark');
      await expect.poll(async () => (await probe.snapshot()).slate?.opacity, { timeout: 2000, message: 'the slate is fully faded in' }).toBe(1);
      const stage = await output.stagePixels();
      expect(Math.hypot(stage.at(200, 200)[0] - GROUND[0], stage.at(200, 200)[1] - GROUND[1], stage.at(200, 200)[2] - GROUND[2]), 'no picture behind the slate').toBeLessThanOrEqual(8);
      expect((await api.getSnapshot(production.id)).body.outputStatus.state, 'the Regie sees no output').toBe('none');

      // The old link stays refused (also after a reload), the open page does not come back by itself with the old key.
      const stillDenied = await output.page.evaluate(() => document.querySelector('.sf-r-slate-title')?.textContent);
      expect(stillDenied).toBe(TEXT.slate.denied);
      await output.page.goto(oldUrl);
      await expect.poll(() => output.page.evaluate(() => document.querySelector('.sf-r-slate-title')?.textContent ?? ''), { timeout: 10_000 }).toBe(TEXT.slate.denied);
      await sleep(2000);
      expect((await outputParticipants(production)).length, 'a refused page joins no room').toBe(0);

      // The new link plays.
      await production.refreshOutput();
      expect(production.outputUrl).not.toBe(oldUrl);
      const fresh = await openProbedOutput({ browser, onCleanup }, production, {}, { viewport: { width: 1280, height: 720 } });
      await fresh.output.waitForPlayingVideos(1, { minFps: 5, timeout: 45_000 });
      expect(toneOf((await fresh.output.stagePixels()).mean({ x: 600, y: 400, width: 700, height: 300 })), 'the new link shows S1').toBe('red');
      expect((await outputParticipants(production)).length, 'one output of the new key').toBe(1);
      await expect.poll(async () => (await api.getSnapshot(production.id)).body.outputStatus.state, { timeout: 8000, message: 'the Regie sees the new output (after its first report)' }).toBe('connected');
    },
  );

  test(
    'E2E-OUT-25 [output, IP restriction] a foreign address list kicks the open page within 2 s; the page recovers by itself once its address is allowed (retry every 30 s) and after a reload',
    t.p1,
    async ({ browser, api, production, pairContext, openPhone, openLaptop, onCleanup }) => {
      test.setTimeout(240_000);
      const deps = { api, production, pairContext, openPhone, openLaptop };
      const screens = await addScreens(deps, 'Laptop Farben', 1);
      await placeItem(api, production, production.sceneIds[0]!, screens.sources[0]!, FULL);
      await goLive(api, production);
      const { output, probe } = await openProbedOutput({ browser, onCleanup }, production, {}, { viewport: { width: 1280, height: 720 } });
      await output.waitForPlayingVideos(1, { minFps: 5, timeout: 45_000 });
      const address = (await api.getSnapshot(production.id)).body.outputStatus.addresses[0]!;
      expect(address, 'the address the API sees for the page').toMatch(/^\d+\.\d+\.\d+\.\d+$|:/);
      await probe.takeEvents();

      const sentAt = Date.now();
      expect((await api.updateOutputAccess(production.id, { allowedIps: ['203.0.113.9'] })).status).toBe(200);
      await expect.poll(async () => (await probe.snapshot()).slate?.title, { timeout: 5000, intervals: [50], message: '«Kein Zugang» after the list changed' }).toBe(TEXT.slate.denied);
      const kickedMs = Date.now() - sentAt;
      expect(kickedMs, 'kicked within 2 s of saving (+ polling)').toBeLessThanOrEqual(2500);
      const snapshot = await probe.snapshot();
      expect(snapshot.layers.length + snapshot.videos, 'only the slate is left').toBe(0);
      await expect.poll(async () => (await api.getSnapshot(production.id)).body.outputStatus.state, { timeout: 8000, message: 'the Regie shows «nicht verbunden»' }).toBe('none');
      await expect.poll(async () => (await outputParticipants(production)).length, { timeout: 5000, message: 'the refused page left LiveKit' }).toBe(0);

      // A reload with the foreign list stays refused.
      await output.page.reload();
      await expect.poll(() => output.page.evaluate(() => document.querySelector('.sf-r-slate-title')?.textContent ?? ''), { timeout: 10_000 }).toBe(TEXT.slate.denied);

      // Allowed again: the page that is still open (after the reload, with the stored key) retries on its own.
      const allowedAt = Date.now();
      expect((await api.updateOutputAccess(production.id, { allowedIps: [address] })).status).toBe(200);
      await expect
        .poll(async () => (await new OutputProbe(output).snapshot()).slate?.title ?? 'none', { timeout: 45_000, intervals: [500], message: 'the page recovers within the 30 s retry' })
        .not.toBe(TEXT.slate.denied);
      const recoveredMs = Date.now() - allowedAt;
      await output.waitForPlayingVideos(1, { minFps: 5, timeout: 45_000 });
      await recordMeasurement(test.info(), 'out-25-ip', { kickedMs, recoveredMs }, `list changed -> kicked after ${kickedMs} ms; address allowed -> recovered by itself after ${recoveredMs} ms`);
      expect(recoveredMs, 'a corrected rule recovers within one retry interval (30 s) plus connect time').toBeLessThanOrEqual(40_000);
      expect(toneOf((await output.stagePixels()).mean({ x: 600, y: 400, width: 700, height: 300 })), 'the program is back').toBe('red');
    },
  );

  test(
    'E2E-OUT-10 [output, reload] reloading the live output ten times (once without cache): the picture is back within T-RECOVER-SHORT, the standby slate never shows, one output participant remains',
    t.p0,
    async ({ browser, api, production, pairContext, openPhone, openLaptop, onCleanup }) => {
      test.setTimeout(300_000);
      const deps = { api, production, pairContext, openPhone, openLaptop };
      const screens = await addScreens(deps, 'Laptop Farben', 2);
      const [a, b] = production.sceneIds as [string, string];
      await placeItem(api, production, a, screens.sources[0]!, FULL);
      await placeItem(api, production, b, screens.sources[1]!, FULL);
      await goLive(api, production);
      // Scene B is on air: after a reload the page must come back on scene B, not on the first one.
      expect((await api.switchProgram(production.id, { sceneId: b, transition: { kind: 'cut', durationMs: 0 } })).status).toBe(200);
      const opened = await openProbedOutput({ browser, onCleanup }, production, {}, { viewport: { width: 1280, height: 720 } });
      const { output, probe } = opened;
      await output.waitForPlayingVideos(1, { minFps: 5, timeout: 45_000 });
      const cdp = await opened.context.newCDPSession(output.page);
      await cdp.send('Network.enable');

      const rows: Array<{ run: number; cacheDisabled: boolean; pictureMs: number; standbySeen: boolean; scene: string | undefined; outputs: number }> = [];
      for (let run = 0; run < 11; run++) {
        const cacheDisabled = run === 10;
        await cdp.send('Network.setCacheDisabled', { cacheDisabled });
        const started = Date.now();
        await output.page.reload();
        await expect.poll(async () => (await probe.firstPlayAt()) ?? 0, { timeout: 15_000, intervals: [50], message: `reload ${run}: the picture is back` }).toBeGreaterThan(0);
        const playedAt = (await probe.firstPlayAt())!;
        const layers = (await probe.snapshot()).layers;
        await expect.poll(async () => (await outputParticipants(production)).length, { timeout: 5000, intervals: [100], message: `reload ${run}: a single output participant remains` }).toBe(1);
        rows.push({ run, cacheDisabled, pictureMs: playedAt - started, standbySeen: await probe.standbySeen(), scene: layers[0]?.id, outputs: (await outputParticipants(production)).length });
        await sleep(300);
      }
      const picture = summarize(rows.map((row) => row.pictureMs));
      await recordMeasurement(test.info(), 'out-10-reload', { rows, picture }, `reload -> first frame playing: ${fmt(picture)} ms`);
      expect(rows.every((row) => !row.standbySeen), 'the standby slate never shows while live').toBe(true);
      expect(rows.every((row) => row.scene === b), 'every reload shows the program scene').toBe(true);
      expect(picture.p95, 'picture back within T-RECOVER-SHORT (p95 target 2 s)').toBeLessThanOrEqual(3000);
      expect(picture.max, 'hard limit 3 s').toBeLessThanOrEqual(3000);
      expect(rows.every((row) => row.outputs === 1)).toBe(true);
    },
  );
});
