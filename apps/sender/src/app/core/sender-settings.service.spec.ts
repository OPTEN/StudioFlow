import { TestBed } from '@angular/core/testing';
import { MemoryStorage, TECH_CHECK_OK } from '../../testing/sender-fakes';
import { LOCAL_STORAGE, STORAGE_KEYS } from './browser-storage';
import { DEFAULT_SETTINGS, SenderSettingsService, parseSettings } from './sender-settings.service';

describe('SenderSettingsService', () => {
  let storage: MemoryStorage;

  function create(): SenderSettingsService {
    TestBed.configureTestingModule({ providers: [{ provide: LOCAL_STORAGE, useValue: storage }] });
    return TestBed.inject(SenderSettingsService);
  }

  beforeEach(() => {
    storage = new MemoryStorage();
  });

  afterEach(() => TestBed.resetTestingModule());

  it('starts with the defaults (camera on, 720p, no facing chosen yet)', () => {
    expect(create().settings()).toEqual(DEFAULT_SETTINGS);
  });

  it('persists the camera settings so a reload starts the same way', () => {
    create().update({ facing: 'user', resolution: 1080, dark: true, cameraOn: false });
    TestBed.resetTestingModule();

    expect(create().settings()).toMatchObject({
      facing: 'user',
      resolution: 1080,
      dark: true,
      cameraOn: false,
    });
    expect(storage.readJson(STORAGE_KEYS.settings)).toMatchObject({
      facing: 'user',
      resolution: 1080,
    });
  });

  it('falls back per value for corrupt data', () => {
    expect(
      parseSettings({
        facing: 'left',
        resolution: 480,
        dark: 'yes',
        sharedScreens: ['screen-2', 'x', 3],
      }),
    ).toEqual({ ...DEFAULT_SETTINGS, sharedScreens: ['screen-2'] });
    expect(parseSettings('nonsense')).toEqual(DEFAULT_SETTINGS);
    storage.setRaw(STORAGE_KEYS.settings, '{broken');
    expect(create().settings()).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps the lens and image settings of the control room, dropping corrupt fields one by one', () => {
    expect(
      parseSettings({
        lens: 'back-wide',
        image: {
          zoom: 2.5,
          focusMode: 'macro',
          focusDistance: Number.NaN,
          exposureCompensation: -1,
          torch: 'on',
        },
      }),
    ).toEqual({
      ...DEFAULT_SETTINGS,
      lens: 'back-wide',
      image: { zoom: 2.5, exposureCompensation: -1 },
    });
    expect(parseSettings({ lens: '', image: 'zoom' })).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings({ lens: 'x'.repeat(513) }).lens).toBeNull();
  });

  it('defaults phones to the back camera and laptops to the webcam', () => {
    const service = create();
    expect(service.facingFor('phone')).toBe('environment');
    expect(service.facingFor('laptop')).toBe('user');
    service.update({ facing: 'user' });
    expect(service.facingFor('phone')).toBe('user');
  });

  it('keeps the tech check per device', () => {
    const service = create();
    service.update({ techCheck: { deviceId: 'dev_one00001', result: TECH_CHECK_OK } });

    expect(service.techCheckFor('dev_one00001')).toEqual(TECH_CHECK_OK);
    expect(service.techCheckFor('dev_two00002')).toBeNull();
  });

  it('keeps the problems of a stored tech check and drops what is not a tech check message', () => {
    const problem = { key: 'media.techcheck.upload.slow', params: { rate: 2.8, recommended: 6 } };
    const stored = (problems: unknown): unknown => ({
      techCheck: { deviceId: 'dev_one00001', result: { ...TECH_CHECK_OK, problems } },
    });

    expect(parseSettings(stored([problem])).techCheck?.result.problems).toEqual([problem]);
    expect(
      parseSettings(stored([{ key: 'sender.station.starting' }])).techCheck?.result.problems,
    ).toEqual([]);
    expect(parseSettings(stored('x')).techCheck?.result.problems).toEqual([]);
  });

  it('reads a tech check stored by an older version without problems', () => {
    const { problems: _problems, ...old } = TECH_CHECK_OK;
    const settings = parseSettings({ techCheck: { deviceId: 'dev_one00001', result: old } });
    expect(settings.techCheck?.result).toEqual({ ...old, problems: [] });
  });
});
