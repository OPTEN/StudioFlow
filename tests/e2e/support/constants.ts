/**
 * Shared constants of the E2E suite: error codes, spec limits (T-LIMITS) and the thresholds of docs/testing.md section 5.
 * The texts the tests assert are in text.ts.
 */

/** Machine readable error codes (ProblemDetails.code). */
export const ERROR = {
  validationFailed: 'validation_failed',
  unauthorized: 'unauthorized',
  forbidden: 'forbidden',
  notFound: 'not_found',
  conflict: 'conflict',
  transitionRunning: 'transition_running',
  broadcastLive: 'broadcast_live',
  sceneIsLive: 'scene_is_live',
  assetInUse: 'asset_in_use',
  limitReached: 'limit_reached',
  pairingExpired: 'pairing_expired',
  unsupportedMedia: 'unsupported_media',
  rateLimited: 'rate_limited',
  deviceBlocked: 'device_blocked',
  internalError: 'internal_error',
} as const;

/** Constants asserted exactly (T-LIMITS) - docs/architecture/implementation-spec.md sections 4-7. */
export const LIMITS = {
  loginFailuresPerIp: 5,
  loginFailuresPerUser: 20,
  loginLockoutSeconds: 900,
  pairingRequestsPerIpPer10Min: 10,
  pairingRedeemPerIpPer10Min: 20,
  pairingPendingTotal: 20,
  inviteMinutes: 30,
  requestMinutes: 10,
  credentialsWindowMinutes: 5,
  redeemIdempotencyMinutes: 5,
  fadeDurationsMs: [200, 300, 500, 800, 1000, 1500, 2000],
  scenes: 99,
  itemsPerScene: 32,
  screensPerDevice: 9,
  keepAliveSeconds: 2,
  serverTimeoutSeconds: 5,
  ringBufferEvents: 500,
  jsonBodyBytes: 256 * 1024,
  bandwidthTestBytes: 4 * 1024 * 1024,
  webhookBodyBytes: 1024 * 1024,
  /** Spec section 7: participant tokens live 10 minutes (docs/testing.md says 2 h, see known-bugs.json DOC-03). */
  livekitTokenMinutes: 10,
  nameMax: 80,
  deviceNameMax: 60,
  platformMax: 80,
  messageMax: 140,
  allowedIpRules: 50,
} as const;

/** Acceptance thresholds of docs/testing.md section 5 (hard limits, milliseconds unless stated). */
export const THRESHOLD = {
  /** T-PAIR: redeem -> station visible (API level: redeem -> deviceUpserted on the studio hub). */
  pairHardMs: 2000,
  /** T-DETECT-CLEAN: connection closed cleanly -> outage visible. */
  detectCleanHardMs: 3000,
  /** T-DETECT-SILENT: packets silently dropped -> outage visible. */
  detectSilentTargetMs: 5000,
  detectSilentHardMs: 6500,
  /** T-BLOCK: block -> device disconnected and LiveKit participant gone. */
  blockHardMs: 2000,
  /** T-KEY: key regeneration -> connected outputs kicked. */
  keyHardMs: 2000,
  /** T-TALLY: switch event -> tally applied on the device (hard). */
  tallyHardMs: 500,
  /** T-RESTART-API: `docker restart api` -> healthy. */
  restartApiHealthyHardMs: 30_000,
  /** T-RESTART-API: API healthy -> clients connected and consistent. */
  restartApiClientsHardMs: 15_000,
  /** T-RESTART-LK */
  restartLiveKitHardMs: 10_000,
  /** T-SYNC-DELTA: hub reconnected -> state consistent (delta / snapshot). */
  syncDeltaHardMs: 1500,
  syncSnapshotHardMs: 3000,
  /** T-VIDEO-START */
  videoStartHardMs: 3000,
  /** T-LATENCY (canvas-to-canvas), p50 / p95. */
  latencyP50HardMs: 200,
  latencyP95HardMs: 300,
} as const;

/** Security-relevant names. */
export const SESSION_COOKIE = 'sf_session';
export const CSRF_HEADER = 'X-StudioFlow';

/** XSS payloads of docs/testing.md 1.8 (reused for names stored by the API). */
export const XSS = [
  '<img src=x onerror="window.__xss=1">',
  '"><script>window.__xss=1</script>',
  "'><svg/onload=window.__xss=1>",
  '{{constructor.constructor("window.__xss=1")()}}',
  '\u202eevil\u202c',
  'a'.repeat(200),
];
