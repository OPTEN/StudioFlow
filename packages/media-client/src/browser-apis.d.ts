/**
 * Browser APIs missing from TypeScript 6 `lib.dom` (spec section 3). Every member is optional because support is
 * limited (Chromium only); callers feature-detect. Referenced from `device-info.ts` so every program compiling it
 * (packages, Angular apps) sees these declarations.
 */

/** Battery Status API (`navigator.getBattery()`), Chromium only. */
interface BatteryManager extends EventTarget {
  /** True while charging. */
  readonly charging: boolean;
  /** Charge level 0 … 1. */
  readonly level: number;
  /** Seconds until full (Infinity if unknown or discharging). */
  readonly chargingTime: number;
  /** Seconds until empty (Infinity if unknown or charging). */
  readonly dischargingTime: number;
}

/** Network Information API (`navigator.connection`), Chromium only. */
interface NetworkInformation extends EventTarget {
  /** Physical connection type (Chromium on Android and ChromeOS). */
  readonly type?:
    | 'bluetooth'
    | 'cellular'
    | 'ethernet'
    | 'mixed'
    | 'none'
    | 'other'
    | 'unknown'
    | 'wifi'
    | 'wimax';
  /** Quality class derived from measured throughput and RTT. */
  readonly effectiveType?: 'slow-2g' | '2g' | '3g' | '4g';
  /** Estimated downlink in Mbit/s (rounded, capped at 10 in Chromium). */
  readonly downlink?: number;
  /** Estimated RTT in ms (rounded to 25 ms). */
  readonly rtt?: number;
  /** User asked for reduced data usage. */
  readonly saveData?: boolean;
}

interface Navigator {
  getBattery?(): Promise<BatteryManager>;
  readonly connection?: NetworkInformation;
}
