import { resetLocaleForTests } from '@studioflow/i18n';
import type { CameraControlDto, CameraStateDto } from '@studioflow/scene-model';
import { remoteCameraNotice, remoteCameraNoticeText } from './remote-camera-notice';

const NOTHING: CameraControlDto = {
  v: 1,
  lensId: null,
  zoom: null,
  focusMode: null,
  focusDistance: null,
  exposureCompensation: null,
  torch: null,
  reset: null,
};

function state(zoom: number | null, problem: string | null = null): CameraStateDto {
  return {
    v: 1,
    capabilities: {
      lenses: [],
      zoom: null,
      focusModes: [],
      focusDistance: null,
      exposureCompensation: null,
      torch: false,
    },
    settings: {
      lensId: null,
      zoom,
      focusMode: null,
      focusDistance: null,
      exposureCompensation: null,
      torch: null,
    },
    problem,
  };
}

describe('remote camera notice', () => {
  afterEach(() => resetLocaleForTests('en'));

  it('names the zoom the camera really has', () => {
    const notice = remoteCameraNotice({ ...NOTHING, zoom: 2.04 }, state(2));

    expect(notice).toEqual({ kind: 'zoom', zoom: 2 });
    expect(remoteCameraNoticeText(notice)).toBe('The control room zoomed: 2.0×');
  });

  it('prefers a refusal, then a reset, then a lens switch', () => {
    expect(remoteCameraNotice({ ...NOTHING, zoom: 9, reset: true }, state(1, 'failed'))).toEqual({
      kind: 'refused',
    });
    expect(remoteCameraNotice({ ...NOTHING, lensId: 'wide', reset: true }, state(1))).toEqual({
      kind: 'reset',
    });
    expect(remoteCameraNotice({ ...NOTHING, lensId: 'wide', zoom: 2 }, state(2))).toEqual({
      kind: 'lens',
    });
  });

  it('says the camera was adjusted for focus, brightness and light, or when the zoom is unknown', () => {
    expect(remoteCameraNotice({ ...NOTHING, torch: true }, state(1))).toEqual({ kind: 'adjusted' });
    expect(remoteCameraNotice({ ...NOTHING, zoom: 2 }, null)).toEqual({ kind: 'adjusted' });
  });
});
