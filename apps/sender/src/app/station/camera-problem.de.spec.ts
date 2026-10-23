import { resetLocaleForTests } from '@studioflow/i18n';
import { describeCameraProblem } from './camera-problem';

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const PIXEL =
  'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Mobile Safari/537.36';
const WINDOWS_EDGE =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36 Edg/150.0.0.0';
const FIREFOX = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0';
const MAC_SAFARI =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15';

beforeEach(() => resetLocaleForTests('de-CH'));

describe('camera problems in German', () => {
  it('explains a denied camera with the steps of the platform', () => {
    const ios = describeCameraProblem(
      'permission-denied',
      'media.slot.failure.permission-denied',
      IPHONE,
    );
    expect(ios.title).toBe('Kein Zugriff auf die Kamera');
    expect(ios.steps.join(' ')).toContain('«aA»');
  });

  it('asks to tap on touch platforms and to click elsewhere', () => {
    expect(describeCameraProblem('not-found', null, PIXEL).steps.at(-1)).toBe(
      'Dann auf «Erneut versuchen» tippen.',
    );
    expect(describeCameraProblem('in-use', null, WINDOWS_EDGE).steps.at(-1)).toBe(
      'Dann auf «Erneut versuchen» klicken.',
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
        const problem = describeCameraProblem(failure, 'media.slot.failure.unknown', agent);
        expect([problem.title, ...problem.steps].join(' ')).not.toContain('ß');
      }
    }
  });
});
