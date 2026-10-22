/**
 * Browser launch configuration for fake media (docs/testing.md 1.3; verified in research 2026-10-22).
 *
 * Never pass --use-fake-ui-for-media-stream without --use-fake-device-for-media-stream: that opens the real camera.
 * Never pass --autoplay-policy=no-user-gesture-required: it would hide autoplay defects of the output page.
 */
export const FAKE_MEDIA_ARGS = [
  '--use-fake-device-for-media-stream',
  '--use-fake-ui-for-media-stream',
  // Without it the fake camera track ends after 0.4 s on this machine (spec section 7).
  '--disable-gpu',
];

export const CHROMIUM_ARGS = [
  ...FAKE_MEDIA_ARGS,
  // getDisplayMedia() picks the tab titled "FlowStudio Timecode" without a picker (E2E_SCREEN_MODE=tab).
  '--auto-select-tab-capture-source-by-title=FlowStudio Timecode',
  // ICE host candidates with real addresses (no mDNS names) and loopback candidates.
  '--allow-loopback-in-peer-connection',
  // One --disable-features list (a second flag would replace the first). LocalNetworkAccessChecks: the embedding
  // tests frame the stack (a private address) from a page of a public test origin, which Chromium 156 blocks otherwise.
  '--disable-features=WebRtcHideLocalIpsWithMdns,LocalNetworkAccessChecks',
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows',
  // performance.memory with real values.
  '--enable-precise-memory-info',
  // Caddy's local CA, also for workers.
  '--ignore-certificate-errors',
  // Docker Desktop publishes [::]:443 without a listener on ::1: resolve localhost to IPv4 only.
  '--host-resolver-rules=MAP localhost 127.0.0.1',
];

export const FIREFOX_PREFS: Record<string, string | number | boolean> = {
  'media.navigator.streams.fake': true,
  'media.navigator.permission.disabled': true,
  'media.peerconnection.ice.loopback': true,
  'media.peerconnection.ice.obfuscate_host_addresses': false,
  'media.getusermedia.screensharing.enabled': true,
  'network.dns.disableIPv6': true,
};
