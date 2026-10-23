import { TestBed } from '@angular/core/testing';
import { MemoryStorage } from '../../testing/sender-fakes';
import { LOCAL_STORAGE, STORAGE_KEYS, WebStorage } from './browser-storage';
import { CredentialsService } from './credentials.service';

const DTO = {
  deviceId: 'dev_abcd1234efgh5678',
  deviceSecret: 'Zm9vYmFyLXNlY3JldC12YWx1ZS1vZi10aGUtZGV2aWNl',
  productionId: 'prd_abcd1234efgh5678',
};

describe('CredentialsService', () => {
  let storage: MemoryStorage;

  function create(): CredentialsService {
    TestBed.configureTestingModule({ providers: [{ provide: LOCAL_STORAGE, useValue: storage }] });
    return TestBed.inject(CredentialsService);
  }

  beforeEach(() => {
    storage = new MemoryStorage();
  });

  afterEach(() => TestBed.resetTestingModule());

  it('is not paired on a fresh browser', () => {
    const service = create();
    expect(service.credentials()).toBeNull();
    expect(service.paired()).toBe(false);
    expect(service.bearer()).toBeNull();
  });

  it('saves the credentials under studioflow.sender.v1 and reads them back after a reload', () => {
    create().save(DTO);
    TestBed.resetTestingModule();

    const reloaded = create();

    expect(storage.readJson(STORAGE_KEYS.credentials)).toMatchObject({
      deviceId: DTO.deviceId,
      secret: DTO.deviceSecret,
      productionId: DTO.productionId,
    });
    expect(reloaded.credentials()).toEqual({
      deviceId: DTO.deviceId,
      secret: DTO.deviceSecret,
      productionId: DTO.productionId,
    });
    expect(reloaded.bearer()).toBe(`${DTO.deviceId}.${DTO.deviceSecret}`);
  });

  it('treats corrupt JSON as not paired and removes it', () => {
    storage.setRaw(STORAGE_KEYS.credentials, '{"deviceId": "dev_x');
    const service = create();

    expect(service.credentials()).toBeNull();
    expect(storage.values.has(STORAGE_KEYS.credentials)).toBe(false);
  });

  it.each([
    ['an array', []],
    [
      'a wrong id prefix',
      { deviceId: 'prd_abcd1234', secret: 's3cret', productionId: 'prd_abcd1234' },
    ],
    ['an empty secret', { deviceId: 'dev_abcd1234', secret: '', productionId: 'prd_abcd1234' }],
    ['a missing production', { deviceId: 'dev_abcd1234', secret: 's3cret' }],
    ['numbers instead of strings', { deviceId: 12, secret: 34, productionId: 56 }],
  ])('rejects %s', (_label, value) => {
    storage.writeJson(STORAGE_KEYS.credentials, value);
    expect(create().credentials()).toBeNull();
  });

  it('keeps a valid client id when the credentials part is corrupt', () => {
    storage.writeJson(STORAGE_KEYS.credentials, { clientId: 'cli_keepme1234', deviceId: 'nope' });
    const service = create();

    expect(service.credentials()).toBeNull();
    expect(service.clientId()).toBe('cli_keepme1234');
  });

  it('generates the client id once and stores it before it is used', () => {
    const service = create();
    const first = service.clientId();

    expect(first).toMatch(/^cli_[a-z0-9]{24}$/);
    expect(storage.readJson(STORAGE_KEYS.credentials)).toEqual({ clientId: first });
    expect(service.clientId()).toBe(first);
    TestBed.resetTestingModule();
    expect(create().clientId()).toBe(first);
  });

  it('keeps the client id with the credentials and forgets everything on clear', () => {
    const service = create();
    const clientId = service.clientId();
    service.save(DTO);

    expect(storage.readJson(STORAGE_KEYS.credentials)).toMatchObject({ clientId });

    service.clear();
    expect(service.credentials()).toBeNull();
    expect(storage.values.has(STORAGE_KEYS.credentials)).toBe(false);
  });

  it('refuses malformed credentials from the server', () => {
    const service = create();
    expect(() => service.save({ ...DTO, deviceId: 'garbage' })).toThrow();
    expect(service.credentials()).toBeNull();
  });

  it('keeps working in memory when the browser storage throws', () => {
    const throwing = {
      getItem: () => {
        throw new DOMException('denied', 'SecurityError');
      },
      setItem: () => {
        throw new DOMException('denied', 'SecurityError');
      },
      removeItem: () => {
        throw new DOMException('denied', 'SecurityError');
      },
    } as unknown as Storage;
    TestBed.configureTestingModule({
      providers: [{ provide: LOCAL_STORAGE, useValue: new WebStorage(() => throwing) }],
    });
    const service = TestBed.inject(CredentialsService);

    expect(service.credentials()).toBeNull();
    service.save(DTO);
    expect(service.paired()).toBe(true);
    expect(() => service.clear()).not.toThrow();
  });
});

describe('WebStorage', () => {
  beforeEach(() => window.localStorage.clear());

  it('reads and writes JSON through the browser storage', () => {
    const storage = new WebStorage(() => window.localStorage);
    expect(storage.writeJson('k', { a: 1 })).toBe(true);
    expect(window.localStorage.getItem('k')).toBe('{"a":1}');
    expect(storage.readJson('k')).toEqual({ a: 1 });
    storage.remove('k');
    expect(storage.readJson('k')).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    window.localStorage.setItem('broken', '{nope');
    expect(new WebStorage(() => window.localStorage).readJson('broken')).toBeNull();
  });

  it('reports a refused write and keeps the value for this page', () => {
    const full = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException('full', 'QuotaExceededError');
      },
      removeItem: () => undefined,
    } as unknown as Storage;
    const storage = new WebStorage(() => full);

    expect(storage.writeJson('k', 'v')).toBe(false);
    expect(storage.readJson('k')).toBe('v');
  });
});
