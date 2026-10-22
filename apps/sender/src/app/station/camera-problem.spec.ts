import { classifyCameraFailure, describeCameraProblem, permissionPlatform } from './camera-problem';

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const PIXEL =
  'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Mobile Safari/537.36';
const WINDOWS_EDGE =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36 Edg/150.0.0.0';
const FIREFOX = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0';
const MAC_SAFARI =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15';

describe('camera problems', () => {
  it.each([
    ['permission-denied', 'denied'],
    ['in-use', 'busy'],
    ['not-found', 'missing'],
    ['not-supported', 'missing'],
    ['track-lost', 'lost'],
    ['publish-failed', 'publish'],
    ['unknown', 'other'],
    [null, 'other'],
  ] as const)('classifies the failure %s as %s', (failure, kind) => {
    expect(classifyCameraFailure(failure)).toBe(kind);
  });

  it('uses the slot message as the title of an unexplained failure', () => {
    expect(describeCameraProblem('unknown', 'Etwas anderes', PIXEL).title).toBe('Etwas anderes');
    expect(describeCameraProblem(null, null, PIXEL).title).toBe(
      'Die Kamera konnte nicht gestartet werden',
    );
  });

  it.each([
    [IPHONE, 'ios'],
    [PIXEL, 'android-chrome'],
    [WINDOWS_EDGE, 'desktop-chromium'],
    [FIREFOX, 'firefox'],
    [MAC_SAFARI, 'macos-safari'],
  ] as const)('detects the permission platform of %s', (userAgent, platform) => {
    expect(permissionPlatform(userAgent)).toBe(platform);
  });

  it('explains a denied camera with platform specific steps', () => {
    const ios = describeCameraProblem('permission-denied', 'Kein Zugriff auf die Kamera.', IPHONE);
    expect(ios.title).toBe('Kein Zugriff auf die Kamera');
    expect(ios.steps.join(' ')).toContain('«aA»');

    const android = describeCameraProblem('permission-denied', 'Kein Zugriff', PIXEL);
    expect(android.steps.join(' ')).toContain('Berechtigungen');
  });

  it('names a camera taken by another app', () => {
    const problem = describeCameraProblem(
      'in-use',
      'Die Kamera ist nicht verfügbar. Wird sie von einer anderen App verwendet?',
      WINDOWS_EDGE,
    );
    expect(problem.title).toBe('Kamera wird von einer anderen App verwendet');
    expect(problem.steps.at(-1)).toBe('Dann auf «Erneut versuchen» klicken.');
  });

  it('uses «tippen» on touch platforms', () => {
    expect(describeCameraProblem('not-found', 'Keine Kamera gefunden.', PIXEL).steps.at(-1)).toBe(
      'Dann auf «Erneut versuchen» tippen.',
    );
  });

  it('never uses ß in the German texts', () => {
    for (const agent of [IPHONE, PIXEL, WINDOWS_EDGE, FIREFOX, MAC_SAFARI]) {
      for (const failure of [
        'permission-denied',
        'in-use',
        'not-found',
        'track-lost',
        'publish-failed',
        'unknown',
      ] as const) {
        const problem = describeCameraProblem(failure, 'x', agent);
        expect([problem.title, ...problem.steps].join(' ')).not.toContain('ß');
      }
    }
  });
});
