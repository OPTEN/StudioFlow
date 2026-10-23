import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '../../support/fixtures';
import { OUTPUT_DIR } from '../../support/env';
import { livekitCtl, restoreNetwork } from '../../support/docker-ctl';
import { LiveKitPage } from '../../support/livekit-browser';
import { installInitScript, net } from '../../support/net';
import { pairPhone } from '../../support/production';
import { dockerCtl } from '../../support/docker-ctl';
import { sleep, waitUntil } from '../../support/shell';
import { ensureHealthy } from '../../support/stack';
import { t } from '../../support/tags';
import { makePng, padTo } from '../../support/media-samples';

/**
 * E2E-NET-00 - the harness canary (docs/testing.md 2.7). Every tool the NET, LK and SRC tests rely on is exercised
 * once against the real stack and its availability is written to .output/canary.json. A dependent test calls
 * requireTool() and fails with a clear message instead of passing vacuously.
 */

const CANARY_FILE = path.join(OUTPUT_DIR, 'canary.json');
const results: Record<string, { ok: boolean; detail: string; skipped?: boolean }> = {};

function record(tool: string, ok: boolean, detail: string): void {
  results[tool] = { ok, detail };
  writeResults();
}

/** The machine cannot provide the tool (not a product failure): dependent tests are skipped, see requireTool(). */
function recordSkipped(tool: string, detail: string): void {
  results[tool] = { ok: false, detail, skipped: true };
  test.info().annotations.push({ type: 'skipped-tool', description: `${tool}: ${detail}` });
  writeResults();
}

function writeResults(): void {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(CANARY_FILE, JSON.stringify(results, null, 2));
}

test.describe.configure({ mode: 'serial' });

test.afterAll(async () => {
  await restoreNetwork().catch(() => undefined);
});

/**
 * netem 200 ms: RTT of the ICE pair >= 0.3 s, back to < 0.05 s after clearing. The CI runners set E2E_NETEM=unavailable
 * (tests/e2e/load-netem-modules.sh) when the kernel has no sch_netem, ifb or act_mirred: the tool is then skipped.
 */
async function checkNetem(viewer: LiveKitPage): Promise<void> {
  if (process.env['E2E_NETEM'] === 'unavailable') {
    recordSkipped('netem', 'the kernel of this machine has no sch_netem, ifb or act_mirred (E2E_NETEM=unavailable)');
    return;
  }
  await livekitCtl.netem({ delayMs: 200, jitterMs: 0, lossPct: 0 });
  const slowRtt = await waitUntil('RTT >= 0.3 s under netem', async () => {
    const rtt = await viewer.iceRtt();
    return rtt !== null && rtt >= 0.3 ? rtt : false;
  }, { timeoutMs: 40_000, intervalMs: 1000 }).catch(() => null);
  await livekitCtl.clearNetem();
  const fastRtt = await waitUntil('RTT < 0.05 s after clear', async () => {
    const rtt = await viewer.iceRtt();
    return rtt !== null && rtt < 0.05 ? rtt : false;
  }, { timeoutMs: 40_000, intervalMs: 1000 }).catch(() => null);
  record('netem', slowRtt !== null && fastRtt !== null, `rtt under netem ${slowRtt}, after clear ${fastRtt}`);
  expect(slowRtt, 'netem 200 ms shaped both directions (RTT >= 0.3 s)').not.toBeNull();
  expect(fastRtt, 'clearNetem restores the RTT').not.toBeNull();
}

test.describe('NET canary', () => {
  test('E2E-NET-00 [offline] context.setOffline blocks fetch and WebSocket and restores', t.smoke, async ({ context, page, config, api }) => {
    await installInitScript(context);
    await context.addCookies([{ name: api.cookie.split('=')[0]!, value: api.cookie.split('=')[1]!, url: config.baseURL }]);
    await page.route(`${config.baseURL}/__e2e/blank`, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>blank</title>' }));
    await page.goto(`${config.baseURL}/__e2e/blank`);
    const probe = (url: string) => page.evaluate(async (target) => fetch(target, { cache: 'no-store' }).then((r) => r.status).catch((e) => `error: ${e.message}`), url);
    expect(await probe(`${config.baseURL}/ca.crt`)).toBe(200);
    // An open hub WebSocket: pings arrive every 2 s.
    const opened = await page.evaluate(async () => {
      const negotiate = await fetch('/hubs/studio/negotiate?negotiateVersion=1', { method: 'POST' }).then((r) => r.json());
      return new Promise<boolean>((resolve) => {
        const ws = new WebSocket(`wss://${location.host}/hubs/studio?id=${negotiate.connectionToken}`);
        (window as unknown as { __ws: WebSocket; __messages: number; __closed: boolean }).__ws = ws;
        (window as unknown as { __messages: number }).__messages = 0;
        (window as unknown as { __closed: boolean }).__closed = false;
        ws.onopen = () => {
          ws.send('{"protocol":"json","version":1}\u001e');
          resolve(true);
        };
        ws.onmessage = () => ((window as unknown as { __messages: number }).__messages += 1);
        ws.onclose = () => ((window as unknown as { __closed: boolean }).__closed = true);
        ws.onerror = () => resolve(false);
      });
    });
    expect(opened).toBe(true);
    await expect.poll(() => page.evaluate(() => (window as unknown as { __messages: number }).__messages), { timeout: 8000 }).toBeGreaterThan(1);

    await net.browserOffline(context, true);
    expect(String(await probe(`${config.baseURL}/ca.crt`))).toMatch(/^error/);
    const before = await page.evaluate(() => (window as unknown as { __messages: number }).__messages);
    await sleep(3500);
    const during = await page.evaluate(() => ({ messages: (window as unknown as { __messages: number }).__messages, closed: (window as unknown as { __closed: boolean }).__closed }));
    const behaviour = during.closed ? 'closes the open WebSocket' : during.messages - before === 0 ? 'stalls the open WebSocket (no close event)' : 'does not affect the open WebSocket';
    await net.browserOffline(context, false);
    expect(await probe(`${config.baseURL}/ca.crt`)).toBe(200);
    // If setOffline neither closes nor stalls an open socket, net.cut() has to close the tracked sockets itself.
    record('setOffline', true, behaviour);
    await net.cut(context);
    await expect.poll(() => page.evaluate(() => (window as unknown as { __closed: boolean }).__closed), { timeout: 5000, message: 'net.cut closes the tracked WebSocket' }).toBe(true);
    await net.restore(context);
    record('net.cut', true, 'closes tracked sockets and peers, setOffline on');
  });

  test('E2E-NET-00 [cdp] CDP throttling slows a 250 KB download to >= 4 s', t.smoke, async ({ context, page, config, api, production }) => {
    await context.addCookies([{ name: api.cookie.split('=')[0]!, value: api.cookie.split('=')[1]!, url: config.baseURL }]);
    const asset = (await api.uploadAsset(production.id, { fileName: 'big.png', contentType: 'image/png', data: padTo(makePng(1, 1), 250 * 1024) })).body;
    await page.route(`${config.baseURL}/__e2e/blank`, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>blank</title>' }));
    await page.goto(`${config.baseURL}/__e2e/blank`);
    const download = () => page.evaluate(async (url) => {
      const started = performance.now();
      const buffer = await (await fetch(url, { cache: 'no-store' })).arrayBuffer();
      return { bytes: buffer.byteLength, ms: performance.now() - started };
    }, asset.contentUrl);
    const baseline = await download();
    expect(baseline.bytes).toBe(250 * 1024);
    const cdp = await net.cdpThrottle(page, { latencyMs: 400, downKbps: 400, upKbps: 400 });
    const slow = await download();
    await net.cdpThrottle(page, null);
    await cdp.detach().catch(() => undefined);
    record('cdpThrottle', slow.ms >= 4000, `baseline ${Math.round(baseline.ms)} ms, throttled ${Math.round(slow.ms)} ms`);
    expect(slow.ms, `throttled download took ${Math.round(slow.ms)} ms (baseline ${Math.round(baseline.ms)} ms)`).toBeGreaterThanOrEqual(4000);
  });

  test('E2E-NET-00 [lk-pause/netem/disconnect] pause, 200 ms netem and network disconnect of LiveKit act on real media', t.smoke, async ({ context, api, production, pairContext }) => {
    test.setTimeout(240_000);
    const phone = await pairPhone(pairContext, { name: 'Canary Handy' });
    const senderToken = (await phone.api.getDeviceLiveKitToken()).body;
    const sender = await LiveKitPage.open(context, 'sender');
    const viewer = await LiveKitPage.open(context, 'viewer');
    try {
      await sender.publishStamped({ url: senderToken.url, token: senderToken.token, name: 'camera' });
      const viewerToken = (await api.getStudioLiveKitToken(production.id)).body;
      await viewer.connect({ url: viewerToken.url, token: viewerToken.token });
      const warm = await viewer.measure({ identity: phone.id, trackName: 'camera', durationMs: 2000 });
      expect(warm.frames, 'decode of the latency stamp on the received video (check 8)').toBeGreaterThan(20);
      record('timecode-decode', warm.frames > 20 && warm.badFrames / (warm.frames + warm.badFrames) < 0.05, `${warm.frames} frames, p50 ${warm.p50} ms, ${await viewer.iceDescription()}`);

      const framesNow = async () => (await viewer.inboundStats()).filter((s) => s.kind === 'video').reduce((sum, s) => sum + (s.framesDecoded ?? 0), 0);
      const progress = async (ms: number) => {
        const a = await framesNow();
        await sleep(ms);
        return (await framesNow()) - a;
      };
      expect(await progress(1500), 'frames advance at baseline').toBeGreaterThan(15);

      // (3) docker pause: silent loss for the whole media server
      await livekitCtl.pause();
      await sleep(1500);
      const stalled = await progress(2500);
      await livekitCtl.unpause();
      await waitUntil('frames resume after unpause', async () => (await progress(1000)) > 10, { timeoutMs: 20_000, intervalMs: 500 });
      record('lk.pause', stalled <= 3, `frames during the pause: ${stalled}`);
      expect(stalled, 'inbound frames stall while LiveKit is paused').toBeLessThanOrEqual(3);

      await checkNetem(viewer);

      // (5) network disconnect/connect: unreachable, then reachable again for signalling and media
      await livekitCtl.disconnect();
      const probe = await LiveKitPage.open(context, 'probe-during');
      const during = await Promise.race([probe.tryConnect({ url: senderToken.url, token: senderToken.token }), sleep(12_000).then(() => ({ ok: false, error: 'timeout' }))]);
      await probe.close();
      await livekitCtl.connect();
      await waitUntil('LiveKit healthy after reconnect', async () => (await dockerCtl.health('livekit')) === 'healthy', { timeoutMs: 60_000, intervalMs: 1000 });
      const probe2 = await LiveKitPage.open(context, 'probe-after');
      let after = await probe2.tryConnect({ url: senderToken.url, token: (await phone.api.getDeviceLiveKitToken()).body.token });
      if (!after.ok) {
        // published ports can need a moment (or a restart) after a reconnect
        await sleep(5000);
        after = await probe2.tryConnect({ url: senderToken.url, token: (await phone.api.getDeviceLiveKitToken()).body.token });
      }
      await probe2.close();
      record('lk.disconnect', !during.ok && after.ok, `during: ${during.ok ? 'connected(!)' : during.error?.slice(0, 80)}, after: ${after.ok ? 'connected' : after.error?.slice(0, 80)}`);
      expect(during.ok, 'LiveKit is unreachable while disconnected from the network').toBe(false);
      expect(after.ok, `reachable again: ${after.error}`).toBe(true);
    } finally {
      await restoreNetwork().catch(() => undefined);
      await sender.close();
      await viewer.close();
    }
  });

  test('E2E-NET-00 [net.cut] cutting a publisher page stops its media at the subscriber and the publisher recovers after restore', t.smoke, async ({ context, api, production, pairContext }) => {
    test.setTimeout(120_000);
    await installInitScript(context);
    const phone = await pairPhone(pairContext, { name: 'Cut Handy' });
    const token = (await phone.api.getDeviceLiveKitToken()).body;
    const sender = await LiveKitPage.open(context, 'sender');
    const other = await context.browser()!.newContext({ ignoreHTTPSErrors: true });
    const viewer = await LiveKitPage.open(other, 'viewer');
    try {
      await sender.publishStamped({ url: token.url, token: token.token, name: 'camera' });
      const viewerToken = (await api.getStudioLiveKitToken(production.id)).body;
      await viewer.connect({ url: viewerToken.url, token: viewerToken.token });
      await viewer.measure({ identity: phone.id, trackName: 'camera', durationMs: 1000 });
      const frames = async () => (await viewer.inboundStats()).filter((s) => s.kind === 'video').reduce((sum, s) => sum + (s.framesDecoded ?? 0), 0);
      const a = await frames();
      await sleep(1000);
      expect((await frames()) - a, 'baseline').toBeGreaterThan(10);

      await net.cut(context);
      await sleep(2500);
      const cutA = await frames();
      await sleep(2000);
      const stalled = (await frames()) - cutA;
      await net.restore(context);
      record('net.cut media', stalled <= 3, `frames at the subscriber while the publisher page was cut: ${stalled}`);
      expect(stalled, 'the cut publisher delivers no frames').toBeLessThanOrEqual(3);
      const recovered = await waitUntil('publisher page reconnects after restore', async () => {
        const events = await sender.events();
        return events.some((event) => event.type === 'reconnected' || event.type === 'disconnected') ? true : (await frames()) - cutA > 30;
      }, { timeoutMs: 40_000, intervalMs: 500 }).catch(() => false);
      record('net.cut recovery', Boolean(recovered), `publisher events: ${(await sender.events()).map((event) => event.type).join(',')}`);
    } finally {
      await sender.close();
      await viewer.close();
      await other.close();
    }
  });

  test('E2E-NET-00 [restart] docker compose restart api returns to healthy', t.smoke, async () => {
    test.setTimeout(180_000);
    const started = Date.now();
    await dockerCtl.restart('api');
    await ensureHealthy();
    const took = Date.now() - started;
    record('restart api', true, `healthy again after ${took} ms`);
    expect(took).toBeLessThanOrEqual(60_000);
  });

  test('E2E-NET-00 [screen-share] a screen share can be produced (native tab capture or the canvas override) and ends on stop()', t.smoke, async ({ context, config }) => {
    await installInitScript(context);
    const page = await context.newPage();
    await page.route(`${config.baseURL}/__e2e/blank`, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>StudioFlow Timecode</title>' }));
    await page.goto(`${config.baseURL}/__e2e/blank`);
    const native = await page.evaluate(async () => {
      try {
        const stream = await Promise.race([navigator.mediaDevices.getDisplayMedia({ video: true }), new Promise<never>((_, reject) => setTimeout(() => reject(new Error('picker never resolved')), 6000))]);
        const settings = stream.getVideoTracks()[0]!.getSettings();
        stream.getTracks().forEach((track) => track.stop());
        return { ok: true, surface: String((settings as MediaTrackSettings & { displaySurface?: string }).displaySurface), size: `${settings.width}x${settings.height}` };
      } catch (error) {
        return { ok: false, error: String((error as Error).message ?? error) };
      }
    });
    const canvas = await page.evaluate(async () => {
      (window as unknown as { __sfMedia: { canvasScreen: boolean } }).__sfMedia.canvasScreen = true;
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const track = stream.getVideoTracks()[0]!;
      let ended = false;
      track.addEventListener('ended', () => (ended = true));
      track.stop();
      track.dispatchEvent(new Event('ended'));
      return { ok: stream.getVideoTracks().length === 1, endedAfterStop: ended, calls: (window as unknown as { __sfMedia: { displayCalls: number } }).__sfMedia.displayCalls };
    });
    const mode = native.ok ? 'tab (native fake capture)' : 'canvas (override)';
    record('screen-share', native.ok || (canvas.ok && canvas.endedAfterStop), `E2E_SCREEN_MODE=${mode}; native: ${JSON.stringify(native)}; canvas: ${JSON.stringify(canvas)}`);
    expect(canvas.ok, 'the canvas override produces a screen track').toBe(true);
    expect(canvas.endedAfterStop, 'endShare = stop() + ended event').toBe(true);
    expect(canvas.calls, 'getDisplayMedia calls are counted').toBe(2);
    await page.close();
  });

  test('E2E-NET-00 [summary] every tool is available', t.smoke, async () => {
    const recorded = JSON.parse(fs.readFileSync(CANARY_FILE, 'utf8')) as typeof results;
    const failed = Object.entries(recorded).filter(([, value]) => !value.ok && !value.skipped);
    expect(failed.map(([tool, value]) => `${tool}: ${value.detail}`), 'tools that did not work').toEqual([]);
    expect(Object.keys(recorded)).toEqual(expect.arrayContaining(['setOffline', 'net.cut', 'cdpThrottle', 'timecode-decode', 'lk.pause', 'netem', 'lk.disconnect', 'screen-share']));
  });
});
