import { catalogues } from './catalogue';
import { missingKeys, setMissingHandler, type I18nProblem } from './diagnostics';
import { resetLocaleForTests, installLocaleReader } from './store';
import { key, msg, t, tFor, tm } from './translate';
import type { MessageValue } from './types';

const mutableGerman = catalogues['de-CH'] as Record<string, MessageValue>;

describe('t', () => {
  it('returns the English message by default', () => {
    expect(t('common.cancel')).toBe('Cancel');
  });

  it('returns the message of the active locale', () => {
    resetLocaleForTests('de-CH');
    expect(t('common.cancel')).toBe('Abbrechen');
  });

  it('fills {name} placeholders with strings and numbers', () => {
    expect(t('regie.log.sceneLive', { scene: 'Break' })).toBe('Scene “Break” is live');
    expect(t('errors.status.unknown', { status: 418 })).toBe('That did not work (error 418).');
  });

  it('fills a placeholder that occurs twice and keeps the text around it', () => {
    expect(t('media.techcheck.camera.lowResFps', { width: 640, height: 360, fps: 15 })).toBe(
      'Camera: only 640 × 360 at 15 fps.',
    );
  });

  it('leaves a placeholder in place and reports it when the parameter is missing', () => {
    const problems: I18nProblem[] = [];
    setMissingHandler((problem) => problems.push(problem));
    const text = (t as (key: string, params?: object) => string)('regie.log.sceneLive', {});
    expect(text).toBe('Scene “{scene}” is live');
    expect(problems).toEqual([
      { kind: 'param', key: 'regie.log.sceneLive', locale: 'en', param: 'scene' },
    ]);
  });

  it('never formats numbers: a count is inserted with String()', () => {
    expect(t('model.format.itemCount', { count: 1234.5 })).toBe('1234.5 items');
  });
});

describe('missing keys', () => {
  it('returns the key itself, records it and reports it once', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const lookup = t as (key: string) => string;
    expect(lookup('nope.nothing')).toBe('nope.nothing');
    expect(lookup('nope.nothing')).toBe('nope.nothing');
    expect(missingKeys()).toEqual(['nope.nothing']);
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });

  it('lets a handler replace the console output', () => {
    const problems: I18nProblem[] = [];
    setMissingHandler((problem) => problems.push(problem));
    (t as (key: string) => string)('nope.nothing');
    expect(problems).toEqual([{ kind: 'key', key: 'nope.nothing', locale: 'en' }]);
  });

  it('falls back to English when the active catalogue lacks the key', () => {
    resetLocaleForTests('de-CH');
    const original = mutableGerman['common.ok'];
    delete mutableGerman['common.ok'];
    try {
      expect(t('common.ok')).toBe('OK');
      expect(missingKeys()).toEqual([]);
    } finally {
      mutableGerman['common.ok'] = original as MessageValue;
    }
  });

  it('does not mistake inherited object properties for messages', () => {
    setMissingHandler(null);
    expect((t as (key: string) => string)('constructor')).toBe('constructor');
    expect(missingKeys()).toEqual(['constructor']);
  });
});

describe('plurals', () => {
  it('selects the CLDR category of the active locale', () => {
    expect(t('model.format.itemCount', { count: 1 })).toBe('1 item');
    expect(t('model.format.itemCount', { count: 2 })).toBe('2 items');
    expect(t('model.format.itemCount', { count: 0 })).toBe('0 items');
    resetLocaleForTests('de-CH');
    expect(t('model.format.itemCount', { count: 1 })).toBe('1 Element');
    expect(t('model.format.itemCount', { count: 5 })).toBe('5 Elemente');
  });

  it('prefers the exact zero form for a count of 0', () => {
    expect(t('model.status.stationsOk', { count: 0 })).toBe('No stations');
    expect(t('model.status.stationsOk', { count: 1 })).toBe('1 station ok');
    expect(t('model.status.stationsOk', { count: 3 })).toBe('All 3 stations ok');
    resetLocaleForTests('de-CH');
    expect(t('model.status.stationsOk', { count: 0 })).toBe('Keine Stationen');
    expect(t('model.status.stationsOk', { count: 3 })).toBe('Alle 3 Stationen ok');
  });
});

describe('tFor', () => {
  it('translates into an explicit locale whatever the active one is', () => {
    expect(tFor('de-CH')('common.cancel')).toBe('Abbrechen');
    resetLocaleForTests('de-CH');
    expect(tFor('en')('common.cancel')).toBe('Cancel');
    expect(tFor('en')('model.format.itemCount', { count: 2 })).toBe('2 items');
  });
});

describe('msg and tm', () => {
  it('resolves a message when it is shown, in the locale of that moment', () => {
    const message = msg('regie.log.sceneLive', { scene: 'Break' });
    expect(tm(message)).toBe('Scene “Break” is live');
    resetLocaleForTests('de-CH');
    expect(tm(message)).toBe('Szene «Break» ist live');
  });

  it('keeps the key and leaves params out when there are none', () => {
    expect(msg('common.ok')).toEqual({ key: 'common.ok' });
    expect(msg('model.format.itemCount', { count: 3 })).toEqual({
      key: 'model.format.itemCount',
      params: { count: 3 },
    });
  });

  it('gives an empty string for no message', () => {
    expect(tm(null)).toBe('');
    expect(tm(undefined)).toBe('');
  });
});

describe('key', () => {
  it('is the identity', () => {
    expect(key('common.ok')).toBe('common.ok');
  });
});

describe('reader', () => {
  it('translates with the locale the reader reports', () => {
    installLocaleReader(() => 'de-CH');
    expect(t('common.cancel')).toBe('Abbrechen');
  });
});
