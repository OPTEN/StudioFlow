import { resetLocaleForTests } from '@studioflow/i18n';
import { remoteCameraNoticeText } from './remote-camera-notice';

describe('remoteCameraNoticeText in German', () => {
  it('speaks Swiss German', () => {
    resetLocaleForTests('de-CH');

    expect(remoteCameraNoticeText({ kind: 'zoom', zoom: 1.5 })).toBe('Die Regie hat gezoomt: 1,5×');
    expect(remoteCameraNoticeText({ kind: 'reset' })).toBe(
      'Die Regie hat die Kamera auf automatisch zurückgestellt',
    );
  });
});
