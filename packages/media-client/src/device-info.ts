/// <reference path="./browser-apis.d.ts" />
/**
 * Device facts a sender reports or uses to pick its mode: platform label, phone detection, screen-share capability,
 * battery and network type. All feature-detected; nothing throws.
 */
import { t } from '@studioflow/i18n';

/** Operating system rules, most specific first (iOS UAs contain “Mac OS X”, Android and ChromeOS UAs “Linux”). */
const OS_RULES: readonly (readonly [RegExp, string])[] = [
  [/iPhone|iPod/, 'iPhone'],
  [/iPad/, 'iPad'],
  [/Android/, 'Android'],
  [/CrOS/, 'ChromeOS'],
  [/Windows/, 'Windows'],
  [/Macintosh|Mac OS X/, 'macOS'],
  [/Linux/, 'Linux'],
];

/** Browser rules, most specific first (Edge, Opera and Samsung Internet also carry “Chrome”, Chrome “Safari”). */
const BROWSER_RULES: readonly (readonly [RegExp, string])[] = [
  [/EdgA?\/|EdgiOS\//, 'Edge'],
  [/OPR\/|OPiOS\//, 'Opera'],
  [/SamsungBrowser\//, 'Samsung Internet'],
  [/Firefox\/|FxiOS\//, 'Firefox'],
  [/Chrome\/|CriOS\//, 'Chrome'],
  [/Version\/[\d.]+.*Safari\//, 'Safari'],
];

/** Upper bound of `DeviceDto.platform`. */
const MAX_PLATFORM_LENGTH = 80;

function firstMatch(
  userAgent: string,
  rules: readonly (readonly [RegExp, string])[],
): string | undefined {
  return rules.find(([pattern]) => pattern.test(userAgent))?.[1];
}

function browserNavigator(): Navigator | undefined {
  return typeof navigator === 'undefined' ? undefined : navigator;
}

/**
 * Short platform text for the Regie, e.g. “iPhone · Safari”, “Android · Chrome”, “Windows · Edge”, “macOS · Chrome”.
 * Unknown parts are omitted; if nothing is recognized: “Unknown platform” (in the language of the page).
 */
export function platformLabel(userAgent: string): string {
  const parts = [firstMatch(userAgent, OS_RULES), firstMatch(userAgent, BROWSER_RULES)].filter(
    (part): part is string => part !== undefined,
  );
  const label = parts.length === 0 ? t('media.device.unknownPlatform') : parts.join(' · ');
  return label.slice(0, MAX_PLATFORM_LENGTH);
}

/** True for phone user agents (iPhone, Android with “Mobile”, Windows Phone); tablets are not phones. */
export function isLikelyPhone(userAgent: string = browserNavigator()?.userAgent ?? ''): boolean {
  return (
    /iPhone|iPod|Windows Phone/.test(userAgent) ||
    (/Android/.test(userAgent) && /Mobile/.test(userAgent))
  );
}

/** True when the browser can share a screen (getDisplayMedia present – needs a secure context – and not a phone). */
export function canShareScreen(nav: Navigator | undefined = browserNavigator()): boolean {
  return typeof nav?.mediaDevices?.getDisplayMedia === 'function' && !isLikelyPhone(nav.userAgent);
}

/** Battery level (0–100) and charging state where the Battery Status API exists, else null. */
export async function battery(
  nav: Navigator | undefined = browserNavigator(),
): Promise<{ readonly pct: number; readonly charging: boolean } | null> {
  if (typeof nav?.getBattery !== 'function') {
    return null;
  }
  try {
    const manager = await nav.getBattery();
    if (!Number.isFinite(manager.level)) {
      return null;
    }
    return {
      pct: Math.min(100, Math.max(0, Math.round(manager.level * 100))),
      charging: manager.charging === true,
    };
  } catch {
    return null;
  }
}

/**
 * Network type for telemetry (“wifi”, “ethernet”, or the effective cellular class like “4g”): the physical type where
 * Chromium reports it, otherwise `effectiveType`; null without the Network Information API.
 */
export function networkType(nav: Navigator | undefined = browserNavigator()): string | null {
  const connection = nav?.connection;
  const type = connection?.type;
  if (
    type !== undefined &&
    type !== 'cellular' &&
    type !== 'unknown' &&
    type !== 'other' &&
    type !== 'none'
  ) {
    return type;
  }
  return connection?.effectiveType ?? (type === 'cellular' ? 'cellular' : null);
}
