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
    expect(describeCameraProblem('unknown', 'media.slot.failure.unknown', PIXEL).title).toBe(
      'The screen could not be shared.',
    );
    expect(describeCameraProblem(null, null, PIXEL).title).toBe('The camera could not be started');
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
    const ios = describeCameraProblem(
      'permission-denied',
      'media.slot.failure.permission-denied',
      IPHONE,
    );
    expect(ios.title).toBe('No access to the camera');
    expect(ios.steps.join(' ')).toContain('“aA”');

    const android = describeCameraProblem(
      'permission-denied',
      'media.slot.failure.permission-denied',
      PIXEL,
    );
    expect(android.steps.join(' ')).toContain('Permissions');
  });

  it('names a camera taken by another app', () => {
    const problem = describeCameraProblem('in-use', 'media.slot.failure.in-use', WINDOWS_EDGE);
    expect(problem.title).toBe('The camera is being used by another app');
    expect(problem.steps.at(-1)).toBe('Then click “Try again”.');
  });

  it('says “tap” on touch platforms', () => {
    expect(
      describeCameraProblem('not-found', 'media.slot.failure.not-found', PIXEL).steps.at(-1),
    ).toBe('Then tap “Try again”.');
  });
});
