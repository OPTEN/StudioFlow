import { InjectionToken } from '@angular/core';
import { t } from '@studioflow/i18n';
import type { DeviceKind } from '@studioflow/scene-model';
import {
  battery,
  canShareScreen,
  isLikelyPhone,
  networkType,
  platformLabel,
} from '@studioflow/media-client/device';

/** Browser facts the sender depends on; a token so tests can describe any device. */
export interface DeviceEnvironment {
  /** The raw user agent (permission instructions per platform). */
  userAgent(): string;
  /** Short platform text for the Regie (“iPhone · Safari”). */
  platform(): string;
  /** True for phone user agents. */
  isPhone(): boolean;
  /** True when this browser can share a screen (desktop browser with getDisplayMedia). */
  canShareScreen(): boolean;
  /** Battery level and charging state where exposed. */
  battery(): Promise<{ readonly pct: number; readonly charging: boolean } | null>;
  /** Network type (“wifi”, “4g”) where exposed. */
  networkType(): string | null;
  /** Vibrates briefly where allowed (phones). */
  vibrate(pattern: number | number[]): void;
}

function browserNavigator(): Navigator | undefined {
  return typeof navigator === 'undefined' ? undefined : navigator;
}

/** The real browser. */
export const browserEnvironment: DeviceEnvironment = {
  userAgent: () => browserNavigator()?.userAgent ?? '',
  platform: () => platformLabel(browserNavigator()?.userAgent ?? ''),
  isPhone: () => isLikelyPhone(browserNavigator()?.userAgent ?? ''),
  canShareScreen: () => canShareScreen(browserNavigator()),
  battery: () => battery(browserNavigator()),
  networkType: () => networkType(browserNavigator()),
  vibrate: (pattern) => {
    try {
      browserNavigator()?.vibrate?.(pattern);
    } catch {
      // Not allowed without a user gesture in some browsers; the banner is enough.
    }
  },
};

/** Environment of the running browser. */
export const DEVICE_ENVIRONMENT = new InjectionToken<DeviceEnvironment>(
  'studioflow.deviceEnvironment',
  {
    providedIn: 'root',
    factory: () => browserEnvironment,
  },
);

/** Default device kind: phone when it looks like a phone or cannot share a screen (spec 9.2), else laptop. */
export function detectDeviceKind(environment: DeviceEnvironment): DeviceKind {
  return environment.isPhone() || !environment.canShareScreen() ? 'phone' : 'laptop';
}

/** Suggested device name from the platform (“Laptop Windows”, “iPhone”, “Phone Android”), at most 60 characters. */
export function defaultDeviceName(kind: DeviceKind, platform: string): string {
  const os = platform.split(' · ')[0]?.trim() ?? '';
  const known = os !== '' && os !== t('media.device.unknownPlatform');
  if (known && (os === 'iPhone' || os === 'iPad')) {
    return os;
  }
  const stem = t(
    kind === 'phone' ? 'sender.core.deviceName.phone' : 'sender.core.deviceName.laptop',
  );
  return (known ? `${stem} ${os}` : stem).slice(0, 60);
}
