import { expect, test } from '../../support/fixtures';
import { livekitAdmin } from '../../support/livekit';
import { LiveKitPage } from '../../support/livekit-browser';
import { pairPhone } from '../../support/production';
import { eventually } from '../../support/sim';
import { t } from '../../support/tags';

/**
 * E2E-DEV-00 for the desktop-firefox project: Firefox gets its fake camera from the launch prefs (FIREFOX_PREFS) and
 * needs the LAN address as the node IP for ICE (research 2026-10-22). Proves both against the real SFU.
 */

test.describe('device canary (Firefox)', () => {
  test('E2E-DEV-00 [firefox] the stack is served, the fake camera delivers frames and a published track reaches the SFU', t.p1, async ({ page, context, config, production, pairContext, browserName, onCleanup }, testInfo) => {
    test.setTimeout(120_000);
    expect(browserName).toBe('firefox');
    const response = await page.goto(`${config.baseURL}/join/`);
    expect(response?.status(), '/join/ is served').toBeLessThan(400);

    const camera = await page.evaluate(async () => {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 360 }, audio: false });
      const track = stream.getVideoTracks()[0]!;
      await new Promise((resolve) => setTimeout(resolve, 600));
      const result = { state: track.readyState, width: track.getSettings().width ?? 0, label: track.label };
      stream.getTracks().forEach((candidate) => candidate.stop());
      return result;
    });
    expect(camera.state, `Firefox fake camera (${camera.label})`).toBe('live');

    const phone = await pairPhone(pairContext, { name: 'Canary Firefox' });
    const token = (await phone.api.getDeviceLiveKitToken()).body;
    const publisher = await LiveKitPage.open(context, 'canary-firefox');
    onCleanup(() => publisher.close());
    await publisher.publishFakeCamera({ url: token.url, token: token.token, name: 'camera', width: 640, height: 360 });
    testInfo.annotations.push({ type: 'node-ip', description: config.nodeIp });
    const seen = await eventually(async () => (await livekitAdmin.listParticipants(production.id)).some((participant) => participant.identity === phone.id && participant.tracks.some((track) => track.name === 'camera')), 10_000, 250);
    expect(seen, `the SFU sees the Firefox camera track (node IP ${config.nodeIp})`).not.toBeNull();
  });
});
