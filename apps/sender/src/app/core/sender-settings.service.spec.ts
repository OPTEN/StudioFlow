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
});
