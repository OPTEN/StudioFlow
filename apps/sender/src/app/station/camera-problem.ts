import { t, type PlainMessageKey } from '@studioflow/i18n';
import type { SlotFailure, SlotMessageKey } from '@studioflow/media-client/device';

/** What went wrong with the camera, derived from the publisher's failure code. */
export type CameraProblemKind = 'denied' | 'busy' | 'missing' | 'lost' | 'publish' | 'other';

/** A camera problem as shown on the station, in the active language. */
export interface CameraProblem {
  readonly kind: CameraProblemKind;
  readonly title: string;
  /** Steps to fix it on this platform. */
  readonly steps: readonly string[];
}

/** Platform families with their own permission dialogs. */
export type PermissionPlatform =
  | 'ios'
  | 'android-chrome'
  | 'android-other'
  | 'macos-safari'
  | 'firefox'
  | 'desktop-chromium'
  | 'other';

/** Classifies the failure code of a `failed` camera slot (`SlotFailure` of `@studioflow/media-client`). */
export function classifyCameraFailure(failure: SlotFailure | null | undefined): CameraProblemKind {
  switch (failure) {
    case 'permission-denied':
      return 'denied';
    case 'in-use':
      return 'busy';
    case 'not-found':
    case 'not-supported':
      return 'missing';
    case 'track-lost':
      return 'lost';
    case 'publish-failed':
      return 'publish';
    default:
      return 'other';
  }
}

/** Permission platform from the user agent. */
export function permissionPlatform(userAgent: string): PermissionPlatform {
  if (/iPhone|iPad|iPod/.test(userAgent)) {
    return 'ios';
  }
  if (/Android/.test(userAgent)) {
    return /Chrome\//.test(userAgent) && !/SamsungBrowser|Firefox/.test(userAgent)
      ? 'android-chrome'
      : 'android-other';
  }
  if (/Firefox\//.test(userAgent)) {
    return 'firefox';
  }
  if (/Macintosh/.test(userAgent) && /Version\/[\d.]+.*Safari\//.test(userAgent)) {
    return 'macos-safari';
  }
  if (/Chrome\/|Edg\//.test(userAgent)) {
    return 'desktop-chromium';
  }
  return 'other';
}

const PERMISSION_STEP_KEYS = {
  ios: [
    'sender.camera.problem.iosStep1',
    'sender.camera.problem.iosStep2',
    'sender.camera.problem.iosStep3',
  ],
  'android-chrome': [
    'sender.camera.problem.androidChromeStep1',
    'sender.camera.problem.androidChromeStep2',
    'sender.camera.problem.androidChromeStep3',
  ],
  'android-other': [
    'sender.camera.problem.androidOtherStep1',
    'sender.camera.problem.androidOtherStep2',
    'sender.camera.problem.androidOtherStep3',
  ],
  'macos-safari': [
    'sender.camera.problem.macosSafariStep1',
    'sender.camera.problem.macosSafariStep2',
    'sender.camera.problem.macosSafariStep3',
  ],
  firefox: [
    'sender.camera.problem.firefoxStep1',
    'sender.camera.problem.firefoxStep2',
    'sender.camera.problem.firefoxStep3',
  ],
  'desktop-chromium': [
    'sender.camera.problem.desktopChromiumStep1',
    'sender.camera.problem.desktopChromiumStep2',
    'sender.camera.problem.desktopChromiumStep3',
  ],
  other: ['sender.camera.problem.otherStep1', 'sender.camera.problem.otherStep2'],
} as const satisfies Readonly<Record<PermissionPlatform, readonly PlainMessageKey[]>>;

/**
 * The problem with title and steps for the station, in the active language. Call it where the text is shown (a
 * `computed` or the template), so it follows a language switch.
 *
 * @param failure failure code of the slot
 * @param messageKey message of the slot, the title when the failure has no specific explanation
 */
export function describeCameraProblem(
  failure: SlotFailure | null | undefined,
  messageKey: SlotMessageKey | null | undefined,
  userAgent: string,
): CameraProblem {
  const kind = classifyCameraFailure(failure);
  const platform = permissionPlatform(userAgent);
  const touch = platform === 'ios' || platform.startsWith('android');
  const retry = t(touch ? 'sender.camera.problem.retryTap' : 'sender.camera.problem.retryClick');
  switch (kind) {
    case 'denied':
      return {
        kind,
        title: t('sender.camera.problem.deniedTitle'),
        steps: PERMISSION_STEP_KEYS[platform].map((key) => t(key)),
      };
    case 'busy':
      return {
        kind,
        title: t('sender.camera.problem.busyTitle'),
        steps: [t('sender.camera.problem.busyStep1'), retry],
      };
    case 'missing':
      return {
        kind,
        title: t('sender.camera.problem.missingTitle'),
        steps: [t('sender.camera.problem.missingStep1'), retry],
      };
    case 'lost':
      return {
        kind,
        title: t('sender.camera.problem.lostTitle'),
        steps: [t('sender.camera.problem.lostStep1'), retry],
      };
    case 'publish':
      return {
        kind,
        title: t('sender.camera.problem.publishTitle'),
        steps: [t('sender.camera.problem.publishStep1'), retry],
      };
    default:
      return {
        kind,
        title: messageKey ? t(messageKey) : t('sender.camera.problem.otherTitle'),
        steps: [retry],
      };
  }
}
