import type { CameraControlDto } from '@studioflow/scene-model';
import {
  applyCommand,
  cameraProblemOf,
  clampToRange,
  classifyLens,
  imageConstraints,
  isCameraControl,
  listLenses,
  mapCapabilities,
  mapSettings,
  mergeCameraControl,
  settleImage,
} from './camera-control';

/** Chrome on a Pixel: zoom, focus, exposure and torch on the back camera. */
const ANDROID: MediaTrackCapabilities = {
  deviceId: 'back-main',
  facingMode: ['environment'],
  zoom: { min: 1, max: 8, step: 0.1 },
  focusMode: ['manual', 'single-shot', 'continuous'],
  focusDistance: { min: 0.1, max: 2, step: 0.01 },
  exposureCompensation: { min: -2, max: 2, step: 0.3333333333 },
  torch: true,
};

/** Safari on an iPhone: only size, frame rate and facing mode. */
const IPHONE: MediaTrackCapabilities = {
  deviceId: 'front',
  facingMode: ['user'],
  width: { min: 1, max: 1920 },
  height: { min: 1, max: 1080 },
};

/** Chrome with a laptop webcam (no PTZ permission): nothing to control. */
const DESKTOP: MediaTrackCapabilities = {
  width: { min: 1, max: 1280 },
  height: { min: 1, max: 720 },
  focusMode: ['none'],
};

function command(fields: Partial<CameraControlDto>): CameraControlDto {
  return {
    v: 1,
    lensId: null,
    zoom: null,
    focusMode: null,
    focusDistance: null,
    exposureCompensation: null,
    torch: null,
    reset: null,
    ...fields,
  };
}

function device(
  deviceId: string,
  label: string,
  kind: MediaDeviceKind = 'videoinput',
): MediaDeviceInfo {
  return { deviceId, label, kind, groupId: '', toJSON: () => ({}) } as MediaDeviceInfo;
}

describe('camera control', () => {
  describe('capabilities', () => {
    it('maps an Android phone with every control', () => {
      const mapped = mapCapabilities(ANDROID, []);

      expect(mapped).toEqual({
        lenses: [],
        zoom: { min: 1, max: 8, step: 0.1 },
        focusModes: ['auto', 'manual'],
        focusDistance: { min: 0.1, max: 2, step: 0.01 },
        exposureCompensation: { min: -2, max: 2, step: 0.3333333333 },
        torch: true,
      });
    });

    it('maps an iPhone to no image controls', () => {
      expect(mapCapabilities(IPHONE, [])).toEqual({
        lenses: [],
        zoom: null,
        focusModes: [],
        focusDistance: null,
        exposureCompensation: null,
        torch: false,
      });
    });

    it('maps a desktop webcam with a fixed focus to no image controls', () => {
      const mapped = mapCapabilities(DESKTOP, []);

      expect(mapped.focusModes).toEqual([]);
      expect(mapped.zoom).toBeNull();
    });

    it('leaves out ranges that cannot move and focus distance without manual focus', () => {
      const mapped = mapCapabilities(
        {
          zoom: { min: 1, max: 1, step: 0.1 },
          exposureCompensation: { min: 2, max: -2 },
          focusMode: ['continuous'],
          focusDistance: { min: 0, max: 1 },
        },
        [],
      );

      expect(mapped.zoom).toBeNull();
      expect(mapped.exposureCompensation).toBeNull();
      expect(mapped.focusModes).toEqual(['auto']);
      expect(mapped.focusDistance).toBeNull();
    });

    it('maps the settings the camera reports', () => {
      expect(
        mapSettings({ deviceId: 'back-main', zoom: 2, focusMode: 'continuous', torch: false }),
      ).toEqual({
        lensId: 'back-main',
        zoom: 2,
        focusMode: 'auto',
        focusDistance: null,
        exposureCompensation: null,
        torch: false,
      });
      expect(mapSettings({ focusMode: 'none', zoom: Number.NaN })).toEqual(
        expect.objectContaining({ lensId: null, zoom: null, focusMode: null }),
      );
    });
  });

  describe('lenses', () => {
    it.each([
      ['Back Ultra Wide Camera', 'ultraWide'],
      ['Back Telephoto Camera', 'tele'],
      ['Back Camera', 'standard'],
      ['Back Triple Camera', 'standard'],
      ['Front Camera', 'front'],
      ['camera2 1, facing front', 'front'],
      ['camera2 0, facing back', 'standard'],
      ['Integrated Webcam', 'other'],
      ['', 'other'],
    ] as const)('classifies "%s" as %s', (label, kind) => {
      expect(classifyLens(label)).toBe(kind);
    });

    it('lists only cameras with an id', async () => {
      const lenses = await listLenses(async () => [
        device('back-main', 'camera2 0, facing back'),
        device('mic', 'Microphone', 'audioinput'),
        device('', ''),
        device('front', ''),
      ]);

      expect(lenses).toEqual([
        { id: 'back-main', label: 'camera2 0, facing back', kind: 'standard' },
        { id: 'front', label: null, kind: 'other' },
      ]);
    });

    it('lists nothing when the browser cannot', async () => {
      await expect(listLenses(() => Promise.reject(new Error('denied')))).resolves.toEqual([]);
    });
  });

  describe('clamping', () => {
    it('clamps to the range and snaps to the step', () => {
      const zoom = { min: 1, max: 8, step: 0.1 };

      expect(clampToRange(2.04, zoom)).toBe(2);
      expect(clampToRange(0.2, zoom)).toBe(1);
      expect(clampToRange(80, zoom)).toBe(8);
      expect(clampToRange(1.7, { min: 0, max: 3, step: 0 })).toBe(1.7);
    });

    it('builds constraints only for what the camera supports', () => {
      const image = {
        zoom: 20,
        exposureCompensation: 1,
        torch: true,
        focusMode: 'manual' as const,
      };

      expect(imageConstraints(image, ANDROID, {}, false)).toEqual({
        zoom: 8,
        exposureCompensation: 1,
        torch: true,
        focusMode: 'manual',
      });
      expect(imageConstraints(image, IPHONE, {}, false)).toBeNull();
    });

    it('locks manual focus at the current distance when none is given', () => {
      expect(
        imageConstraints({ focusMode: 'manual' }, ANDROID, { focusDistance: 0.42 }, false),
      ).toEqual({
        focusMode: 'manual',
        focusDistance: 0.42,
      });
    });

    it('uses continuous focus for auto where the camera has it', () => {
      expect(imageConstraints({ focusMode: 'auto' }, ANDROID, {}, false)).toEqual({
        focusMode: 'continuous',
      });
      expect(
        imageConstraints(
          { focusMode: 'auto' },
          { focusMode: ['manual', 'single-shot'] },
          {},
          false,
        ),
      ).toEqual({ focusMode: 'single-shot' });
    });

    it('resets the unset controls to automatic', () => {
      expect(imageConstraints({}, ANDROID, {}, true)).toEqual({
        zoom: 1,
        exposureCompensation: 0,
        torch: false,
        focusMode: 'continuous',
      });
      expect(imageConstraints({ zoom: 2 }, ANDROID, {}, true)).toEqual(
        expect.objectContaining({ zoom: 2, exposureCompensation: 0 }),
      );
    });
  });

  describe('commands', () => {
    it('lets the newer value of each field win', () => {
      const merged = mergeCameraControl(
        command({ zoom: 2, exposureCompensation: 1 }),
        command({ zoom: 3, torch: true }),
      );

      expect(merged).toEqual(command({ zoom: 3, exposureCompensation: 1, torch: true }));
    });

    it('keeps an older lens switch through a newer reset', () => {
      const merged = mergeCameraControl(
        command({ lensId: 'wide', zoom: 4 }),
        command({ reset: true }),
      );

      expect(merged).toEqual(command({ lensId: 'wide', reset: true }));
    });

    it('keeps a reset followed by a value', () => {
      expect(mergeCameraControl(command({ reset: true }), command({ zoom: 2 }))).toEqual(
        command({ reset: true, zoom: 2 }),
      );
    });

    it('applies a command to the requested image settings', () => {
      const current = { zoom: 2, focusMode: 'manual' as const, focusDistance: 0.5 };

      expect(applyCommand(current, command({ exposureCompensation: 1 }))).toEqual({
        ...current,
        exposureCompensation: 1,
      });
      expect(applyCommand(current, command({ focusMode: 'auto' }))).toEqual({
        zoom: 2,
        focusMode: 'auto',
      });
      expect(applyCommand(current, command({ reset: true, torch: true }))).toEqual({ torch: true });
    });

    it.each([
      [command({ zoom: 2 }), true],
      [command({ reset: true }), true],
      [{ ...command({ zoom: 2 }), v: 2 }, false],
      [{ ...command({}), zoom: 'two' }, false],
      [{ ...command({}), zoom: Number.POSITIVE_INFINITY }, false],
      [{ ...command({}), focusMode: 'macro' }, false],
      [{ ...command({}), lensId: '' }, false],
      [{ ...command({}), torch: 'on' }, false],
      [null, false],
      ['zoom', false],
    ])('validates %j as %s', (value, valid) => {
      expect(isCameraControl(value)).toBe(valid);
    });
  });

  describe('settling', () => {
    it('keeps what the camera applied', () => {
      const result = settleImage({ zoom: 2, torch: true }, { zoom: 2, torch: true }, ANDROID);

      expect(result).toEqual({ image: { zoom: 2, torch: true }, refused: false });
    });

    it('follows the camera where it silently ignored a value', () => {
      const result = settleImage(
        { zoom: 4, focusMode: 'manual' },
        { zoom: 1, focusMode: 'continuous' },
        ANDROID,
      );

      expect(result).toEqual({ image: { zoom: 1, focusMode: 'auto' }, refused: true });
    });

    it('trusts the request where the camera reports nothing', () => {
      expect(settleImage({ zoom: 3 }, {}, ANDROID)).toEqual({ image: { zoom: 3 }, refused: false });
    });

    it('tells an OverconstrainedError apart from other failures', () => {
      expect(cameraProblemOf(new DOMException('no', 'OverconstrainedError'))).toBe(
        'overconstrained',
      );
      expect(cameraProblemOf(new DOMException('busy', 'NotReadableError'))).toBe('failed');
      expect(cameraProblemOf('weird')).toBe('failed');
    });
  });
});
