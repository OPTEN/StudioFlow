import { expect, test } from '../../support/fixtures';
import { livekitAdmin } from '../../support/livekit';
import { LiveKitPage } from '../../support/livekit-browser';
import { pairPhone } from '../../support/production';
import { eventually } from '../../support/sim';
import { t } from '../../support/tags';

/**
 * E2E-DEV-00 (device project canary): proves that the mobile projects (pixel-7, iphone-15 and ipad on Chromium, see the
 * note in playwright.config.ts) really emulate the device, load the stack, get the fake camera and can publish to the
 * real SFU. The UI specs of docs/testing.md 2.8 build on this once the frontends are final.
 */

test.describe('device canary (mobile projects)', () => {
  test('E2E-DEV-00 [mobile] emulation, stack origin, fake camera and a published track on the real SFU', t.p1, async ({ page, context, config, production, pairContext, isMobile, hasTouch, viewport, onCleanup }, testInfo) => {
    test.setTimeout(120_000);
    expect(isMobile, `project ${testInfo.project.name} emulates a mobile device`).toBe(true);
    expect(hasTouch).toBe(true);

    const response = await page.goto(`${config.baseURL}/join/`);
    expect(response?.status(), '/join/ is served').toBeLessThan(400);
    const facts = await page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
      touchPoints: navigator.maxTouchPoints,
      userAgent: navigator.userAgent,
      pixelRatio: window.devicePixelRatio,
      title: document.title,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      secure: window.isSecureContext,
      webrtc: typeof RTCPeerConnection,
    }));
    testInfo.annotations.push({ type: 'device', description: JSON.stringify({ ...facts, viewport }) });
    expect(facts.touchPoints, 'touch points').toBeGreaterThan(0);
    expect(facts.width, 'viewport width of the emulated device').toBe(viewport!.width);
    expect(facts.secure, 'secure context (camera access needs it)').toBe(true);
    expect(facts.webrtc).toBe('function');
    expect(facts.overflow, 'no horizontal scroll on /join/').toBeLessThanOrEqual(0);
    const expectedUserAgent = { 'pixel-7': /Android/, 'iphone-15': /iPhone/, ipad: /Macintosh|iPad/ }[testInfo.project.name];
    if (expectedUserAgent) expect(facts.userAgent).toMatch(expectedUserAgent);

    // The fake camera delivers frames.
    const camera = await page.evaluate(async () => {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 360 }, audio: false });
      const track = stream.getVideoTracks()[0]!;
      await new Promise((resolve) => setTimeout(resolve, 600));
      const settings = track.getSettings();
      const result = { state: track.readyState, width: settings.width ?? 0, height: settings.height ?? 0, label: track.label };
      stream.getTracks().forEach((candidate) => candidate.stop());
      return result;
    });
    expect(camera.state, `fake camera track (${camera.label})`).toBe('live');
    expect(camera.width).toBeGreaterThan(0);

    // A device publishes its camera to the SFU through the stack origin.
    const phone = await pairPhone(pairContext, { name: `Canary ${testInfo.project.name}` });
    const token = (await phone.api.getDeviceLiveKitToken()).body;
    const publisher = await LiveKitPage.open(context, `canary-${testInfo.project.name}`);
    onCleanup(() => publisher.close());
    await publisher.publishFakeCamera({ url: token.url, token: token.token, name: 'camera', width: 640, height: 360 });
    const seen = await eventually(async () => (await livekitAdmin.listParticipants(production.id)).some((participant) => participant.identity === phone.id && participant.tracks.some((track) => track.name === 'camera')), 10_000, 250);
    expect(seen, 'the SFU sees the published camera track').not.toBeNull();
  });
});
