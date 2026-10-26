import type {
  CameraCapabilitiesDto,
  CameraSettingsDto,
  CameraStateDto,
  DeviceDto,
  DeviceTelemetryDto,
} from '@studioflow/scene-model';
import { deviceFixture } from '../../../testing/fixtures';
import {
  brightnessText,
  cameraPanelView,
  distanceText,
  lensLabels,
  zoomText,
} from './camera-panel-view';

const ANDROID: CameraCapabilitiesDto = {
  lenses: [
    { id: 'main', label: 'camera2 0, facing back', kind: 'standard' },
    { id: 'wide', label: 'camera2 2, facing back', kind: 'ultraWide' },
    { id: 'selfie', label: 'camera2 1, facing front', kind: 'front' },
  ],
  zoom: { min: 1, max: 8, step: 0.1 },
  focusModes: ['auto', 'manual'],
  focusDistance: { min: 0.1, max: 2, step: 0.05 },
  exposureCompensation: { min: -2, max: 2, step: 0.5 },
  torch: true,
};

const SETTINGS: CameraSettingsDto = {
  lensId: 'main',
  zoom: 2.5,
  focusMode: 'auto',
  focusDistance: null,
  exposureCompensation: 0.5,
  torch: false,
};

function phone(
  camera: CameraStateDto | null,
  overrides: Partial<DeviceDto> = {},
  withTelemetry = true,
): DeviceDto {
  const telemetry: DeviceTelemetryDto | null = withTelemetry
    ? {
        at: '2026-10-26T08:00:00.000Z',
        rtc: 'connected',
        batteryPct: 80,
        charging: false,
        network: 'wifi',
        rttMs: 20,
        slots: [],
        camera,
      }
    : null;
  return deviceFixture('dev_aaaaaaaaaaaaaaaa', 'Phone', { telemetry, ...overrides });
}

function state(
  capabilities: Partial<CameraCapabilitiesDto> = {},
  settings: Partial<CameraSettingsDto> = {},
  problem: string | null = null,
): CameraStateDto {
  return {
    v: 1,
    capabilities: { ...ANDROID, ...capabilities },
    settings: { ...SETTINGS, ...settings },
    problem,
  };
}

describe('cameraPanelView', () => {
  it('offers every control an Android phone reports, with the values the phone reports back', () => {
    const view = cameraPanelView(phone(state()));

    expect(view.kind).toBe('controls');
    if (view.kind !== 'controls') {
      return;
    }
    expect(view.lenses.map((lens) => [lens.label, lens.active])).toEqual([
      ['Standard', true],
      ['Wide-angle', false],
      ['Front', false],
    ]);
    expect(view.zoom).toEqual({ range: ANDROID.zoom, value: 2.5, text: '2.5×' });
    expect(view.focus).toMatchObject({
      mode: 'auto',
      canAuto: true,
      canLock: true,
      distance: null,
    });
    expect(view.brightness?.text).toBe('+0.5 EV');
    expect(view.torch).toEqual({ on: false });
    expect(view.problem).toBeNull();
  });

  it('shows only the controls an iPhone with two cameras reports', () => {
    const view = cameraPanelView(
      phone(
        state(
          {
            lenses: [
              { id: 'back', label: 'Back Camera', kind: 'standard' },
              { id: 'front', label: 'Front Camera', kind: 'front' },
            ],
            zoom: null,
            focusModes: [],
            focusDistance: null,
            exposureCompensation: null,
            torch: false,
          },
          { lensId: 'back', zoom: null, exposureCompensation: null },
        ),
      ),
    );

    expect(view.kind).toBe('controls');
    if (view.kind === 'controls') {
      expect(view.lenses).toHaveLength(2);
      expect(view.zoom).toBeNull();
      expect(view.focus).toBeNull();
      expect(view.brightness).toBeNull();
      expect(view.torch).toBeNull();
    }
  });

  it('says "unavailable" for a camera without any control and for a phone that reports no camera', () => {
    const bare = state({
      lenses: [{ id: 'only', label: 'Camera', kind: 'other' }],
      zoom: null,
      focusModes: [],
      focusDistance: null,
      exposureCompensation: null,
      torch: false,
    });

    expect(cameraPanelView(phone(bare)).kind).toBe('unavailable');
    expect(cameraPanelView(phone(null)).kind).toBe('unavailable');
  });

  it('says "not reported" before the first report and "offline" while the phone is not connected', () => {
    expect(cameraPanelView(phone(null, {}, false)).kind).toBe('notReported');
    expect(cameraPanelView(phone(state(), { connection: 'offline' })).kind).toBe('offline');
  });

  it('shows the focus distance only while the focus is locked, and keeps the value inside the range', () => {
    const locked = cameraPanelView(phone(state({}, { focusMode: 'manual', focusDistance: 5 })));

    expect(locked.kind === 'controls' && locked.focus?.distance?.value).toBe(2);
    expect(locked.kind === 'controls' && locked.focus?.distance?.text).toBe('2.00 m');
  });

  it('hides a slider whose range is empty', () => {
    const view = cameraPanelView(phone(state({ zoom: { min: 1, max: 1, step: 0.1 } })));

    expect(view.kind === 'controls' && view.zoom).toBeNull();
  });

  it('maps the problem the phone reports to a message and ignores unknown ones', () => {
    const refused = cameraPanelView(phone(state({}, {}, 'overconstrained')));
    const failed = cameraPanelView(phone(state({}, {}, 'failed')));
    const unknown = cameraPanelView(phone(state({}, {}, '<b>x</b>')));

    expect(refused.kind === 'controls' && refused.problem).toBe(
      'The camera does not support this setting.',
    );
    expect(failed.kind === 'controls' && failed.problem).toBe(
      'The phone could not apply the change.',
    );
    expect(unknown.kind === 'controls' && unknown.problem).toBeNull();
  });
});

describe('lensLabels', () => {
  it('names a lens by its kind and numbers lenses whose kind is ambiguous or unknown', () => {
    expect(
      lensLabels([
        { id: 'a', label: null, kind: 'standard' },
        { id: 'b', label: null, kind: 'standard' },
        { id: 'c', label: null, kind: 'tele' },
        { id: 'd', label: null, kind: 'other' },
      ]),
    ).toEqual(['Camera 1', 'Camera 2', 'Tele', 'Camera 4']);
  });
});

describe('value texts', () => {
  it('formats zoom, brightness and distance', () => {
    expect(zoomText(2)).toBe('2.0×');
    expect(brightnessText(0)).toBe('0.0 EV');
    expect(brightnessText(-1.5)).toBe('-1.5 EV');
    expect(distanceText(0.5)).toBe('0.50 m');
  });
});
