import dns from 'node:dns';
import path from 'node:path';
import { defineConfig, devices, type Project } from '@playwright/test';
import { OUTPUT_DIR, SETTINGS, originFor } from './support/env';
import { CHROMIUM_ARGS, FIREFOX_PREFS } from './support/fake-media';

// Caddy's local CA signs the certificate (TLS mode internal); Node clients (SignalR, fetch) of the specs accept it.
process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = '0';

// The TLS warning of NODE_TLS_REJECT_UNAUTHORIZED=0 would be printed by every worker process.
process.env['NODE_NO_WARNINGS'] = '1';
dns.setDefaultResultOrder('ipv4first');

// The stack selected by E2E_STACK / E2E_PROJECT / E2E_*_PORT (support/env.ts); E2E_BASE_URL overrides the origin only.
const baseURL = process.env['E2E_BASE_URL'] ?? originFor('localhost', SETTINGS.httpsPort);

/** Specs that need their own stack mode never run in the generic projects. */
const SPECIAL = ['**/*.short-ttl.spec.ts', '**/*.disruptive.spec.ts', '**/*.firefox.spec.ts', '**/*.webkit.spec.ts', '**/*.mobile.spec.ts', '**/*.soak.spec.ts'];

const chromiumUse = {
  launchOptions: { args: CHROMIUM_ARGS },
  permissions: ['clipboard-read', 'clipboard-write', 'camera', 'microphone'],
} as const;

/**
 * Project order is the run order (workers: 1): smoke -> main -> short-ttl -> disruptive, then the device projects.
 * There are deliberately no `dependencies`: Playwright would skip the dependent projects when one test of a
 * dependency fails, and a product bug in the smoke set must not hide the rest of the report. Specs that change the
 * stack (short-TTL profile, restarts, lockout) restore it themselves and run last.
 */
const projects: Project[] = [
  {
    name: 'smoke',
    grep: /@smoke/,
    testIgnore: SPECIAL,
    use: { ...devices['Desktop Chrome'], ...chromiumUse },
  },
  {
    name: 'desktop-chromium',
    grepInvert: /@smoke/,
    testIgnore: SPECIAL,
    use: { ...devices['Desktop Chrome'], ...chromiumUse },
  },
  {
    name: 'short-ttl',
    testMatch: '**/*.short-ttl.spec.ts',
    use: { ...devices['Desktop Chrome'], ...chromiumUse },
  },
  {
    name: 'disruptive',
    testMatch: '**/*.disruptive.spec.ts',
    use: { ...devices['Desktop Chrome'], ...chromiumUse },
  },
  {
    name: 'pixel-7',
    testMatch: '**/*.mobile.spec.ts',
    use: { ...devices['Pixel 7'], ...chromiumUse },
  },
  {
    // WebKit has no WebRTC on Windows (research 2026-10-22): the iPhone/iPad descriptors run on Chromium here.
    name: 'iphone-15',
    testMatch: '**/*.mobile.spec.ts',
    use: { ...devices['iPhone 15'], defaultBrowserType: 'chromium', ...chromiumUse },
  },
  {
    name: 'ipad',
    testMatch: '**/*.mobile.spec.ts',
    use: { ...devices['iPad (gen 7)'], defaultBrowserType: 'chromium', ...chromiumUse },
  },
  {
    name: 'desktop-firefox',
    testMatch: '**/*.firefox.spec.ts',
    // Firefox rejects the camera/microphone permissions; fake media comes from the prefs.
    use: { ...devices['Desktop Firefox'], launchOptions: { firefoxUserPrefs: FIREFOX_PREFS } },
  },
  {
    name: 'webkit',
    testMatch: '**/*.webkit.spec.ts',
    use: { ...devices['Desktop Safari'] },
  },
  {
    name: 'soak',
    testMatch: '**/*.soak.spec.ts',
    use: { ...devices['Desktop Chrome'], ...chromiumUse },
    timeout: 4_000_000,
  },
];

export default defineConfig({
  testDir: './specs',
  outputDir: path.join(OUTPUT_DIR, 'artifacts'),
  globalSetup: './global-setup.ts',
  globalTeardown: './global-teardown.ts',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env['CI'] ? 1 : 0,
  forbidOnly: Boolean(process.env['CI']),
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: path.join(OUTPUT_DIR, 'html') }],
    ['junit', { outputFile: path.join(OUTPUT_DIR, 'junit.xml') }],
    ['json', { outputFile: path.join(OUTPUT_DIR, 'results.json') }],
  ],
  use: {
    baseURL,
    ignoreHTTPSErrors: true,
    locale: 'de-CH',
    timezoneId: 'Europe/Zurich',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 15_000,
  },
  projects,
});
