/**
 * Shared constants of the E2E suite: German strings asserted by tests, spec limits (T-LIMITS) and the thresholds of
 * docs/testing.md section 5. Strings are German (CH): «ss» instead of «ß», decimal comma, 24 h clock.
 */

/** Machine readable error codes (ProblemDetails.code). */
export const ERROR = {
  validationFailed: 'validation_failed',
  unauthorized: 'unauthorized',
  forbidden: 'forbidden',
  notFound: 'not_found',
  conflict: 'conflict',
  transitionRunning: 'transition_running',
  sceneIsLive: 'scene_is_live',
  assetInUse: 'asset_in_use',
  limitReached: 'limit_reached',
  pairingExpired: 'pairing_expired',
  unsupportedMedia: 'unsupported_media',
  rateLimited: 'rate_limited',
  deviceBlocked: 'device_blocked',
  internalError: 'internal_error',
} as const;

/** German UI strings the tests assert (spec sections 4, 9; docs/testing.md 2.x). */
export const DE = {
  // Output slates
  slateStandby: "Gleich geht's los",
  slateEnd: 'Danke fürs Zuschauen',
  slateDenied: 'Kein Zugang',
  holdText: 'Bild kommt gleich zurück',
  // Default production and scenes (spec 4.2)
  defaultProduction: 'Webinar',
  defaultScenes: ['Begrüssung', 'Präsentation', 'Pause'],
  // Status words (spec 8.1 statusWord)
  statusReconnecting: 'verbindet neu',
  statusEnded: 'Teilen beendet',
  statusBlocked: 'gesperrt',
  statusConnecting: 'verbindet …',
  statusLost: 'kein Bild',
  statusOffline: 'nicht verbunden',
  // Log entries (spec 4.5, 4.9, LogTexts)
  log: {
    reconnecting: (code: string) => `${code} verbindet neu`,
    recovered: (code: string, seconds: number) => `${code} wieder da, war ${seconds} s weg`,
    ended: (code: string) => `${code} Teilen beendet`,
    blocked: (code: string) => `${code} gesperrt`,
    unblocked: (code: string) => `${code} entsperrt`,
    paired: (code: string, name: string) => `${code} ${name} gekoppelt`,
  },
  // Errors of the API (German details the Regie may show)
  loginFailed: 'Benutzername oder Passwort ist falsch.',
  noAccess: 'Kein Zugang.',
  // Pairing
  knockCard: (name: string) => `${name} möchte beitreten`,
  checkCodeFormat: /^\d{2} \d{2}$/,
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
export const SESSION_COOKIE = 'fs_session';
export const CSRF_HEADER = 'X-FlowStudio';

/** XSS payloads of docs/testing.md 1.8 (reused for names stored by the API). */
export const XSS = [
  '<img src=x onerror="window.__xss=1">',
  '"><script>window.__xss=1</script>',
  "'><svg/onload=window.__xss=1>",
  '{{constructor.constructor("window.__xss=1")()}}',
  '\u202eevil\u202c',
  'a'.repeat(200),
];
