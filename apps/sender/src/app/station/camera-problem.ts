import type { SlotFailure } from '@flowstudio/media-client/device';

/** What went wrong with the camera, derived from the publisher's failure code. */
export type CameraProblemKind = 'denied' | 'busy' | 'missing' | 'lost' | 'publish' | 'other';

/** A camera problem as shown on the station. */
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

/** Classifies the failure code of a `failed` camera slot (`SlotFailure` of `@flowstudio/media-client`). */
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

const PERMISSION_STEPS: Readonly<Record<PermissionPlatform, readonly string[]>> = {
  ios: [
    'In Safari links in der Adressleiste auf «aA» tippen, dann «Website-Einstellungen».',
    'Bei «Kamera» die Option «Erlauben» wählen.',
    'Die Seite neu laden. Hilft das nicht: Einstellungen › Apps › Safari › Kamera › «Erlauben».',
  ],
  'android-chrome': [
    'Links neben der Adresse auf das Symbol mit den Reglern tippen, dann «Berechtigungen».',
    'Die Kamera auf «Zulassen» stellen.',
    'Die Seite neu laden.',
  ],
  'android-other': [
    'In den Website-Einstellungen des Browsers die Kamera für diese Seite erlauben.',
    'Prüfen, ob der Browser in den Android-Einstellungen die Kamera verwenden darf.',
    'Die Seite neu laden.',
  ],
  'macos-safari': [
    'Im Menü «Safari» die «Einstellungen für diese Website» öffnen.',
    'Bei «Kamera» die Option «Erlauben» wählen.',
    'Die Seite neu laden. In den Systemeinstellungen › Datenschutz › Kamera muss Safari erlaubt sein.',
  ],
  firefox: [
    'In der Adressleiste auf das durchgestrichene Kamera-Symbol klicken.',
    'Die Sperre für die Kamera aufheben.',
    'Die Seite neu laden.',
  ],
  'desktop-chromium': [
    'Links neben der Adresse auf das Symbol mit den Reglern klicken.',
    'Die Kamera auf «Zulassen» stellen.',
    'Die Seite neu laden. Unter Windows und macOS muss der Browser die Kamera in den Systemeinstellungen verwenden dürfen.',
  ],
  other: [
    'In den Einstellungen des Browsers die Kamera für diese Seite erlauben.',
    'Die Seite neu laden.',
  ],
};

/**
 * The problem with German title and steps for the station.
 *
 * @param failure failure code of the slot
 * @param message German message of the slot, the title when the failure has no specific explanation
 */
export function describeCameraProblem(
  failure: SlotFailure | null | undefined,
  message: string | null | undefined,
  userAgent: string,
): CameraProblem {
  const kind = classifyCameraFailure(failure);
  const platform = permissionPlatform(userAgent);
  const touch = platform === 'ios' || platform.startsWith('android');
  const retry = `Dann auf «Erneut versuchen» ${touch ? 'tippen' : 'klicken'}.`;
  switch (kind) {
    case 'denied':
      return {
        kind,
        title: 'Kein Zugriff auf die Kamera',
        steps: PERMISSION_STEPS[platform],
      };
    case 'busy':
      return {
        kind,
        title: 'Kamera wird von einer anderen App verwendet',
        steps: [
          'Die andere App schliessen, zum Beispiel Kamera, Teams, Zoom oder einen anderen Browser-Tab.',
          retry,
        ],
      };
    case 'missing':
      return {
        kind,
        title: 'Keine Kamera gefunden',
        steps: ['Prüfen, ob eine Kamera angeschlossen und eingeschaltet ist.', retry],
      };
    case 'lost':
      return {
        kind,
        title: 'Die Kamera liefert kein Bild mehr',
        steps: ['Vielleicht hat ein Anruf oder eine andere App die Kamera übernommen.', retry],
      };
    case 'publish':
      return {
        kind,
        title: 'Das Bild konnte nicht gesendet werden',
        steps: ['Das WLAN prüfen.', retry],
      };
    default:
      return {
        kind,
        title: message ?? 'Die Kamera konnte nicht gestartet werden',
        steps: [retry],
      };
  }
}
