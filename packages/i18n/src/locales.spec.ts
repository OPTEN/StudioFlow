import {
  LOCALES,
  SUPPORTED_LOCALES,
  parseLocaleSetting,
  parseLocaleTag,
  resolveLocale,
} from './locales';

describe('parseLocaleTag', () => {
  it.each([
    ['en', 'en'],
    ['en-US', 'en'],
    ['en-GB', 'en'],
    ['EN-us', 'en'],
    ['en_US', 'en'],
    ['de', 'de-CH'],
    ['de-CH', 'de-CH'],
    ['de-DE', 'de-CH'],
    ['de-AT', 'de-CH'],
    ['de-LI', 'de-CH'],
    [' de-DE ', 'de-CH'],
  ])('maps %s to %s', (tag, expected) => {
    expect(parseLocaleTag(tag)).toBe(expected);
  });

  it.each(['fr', 'fr-CH', 'it-CH', 'deu', 'english', 'xx', '', '  ', '-', 'de1'])(
    'does not support %j',
    (tag) => {
      expect(parseLocaleTag(tag)).toBeNull();
    },
  );

  it('treats a missing tag as unsupported', () => {
    expect(parseLocaleTag(null)).toBeNull();
    expect(parseLocaleTag(undefined)).toBeNull();
  });
});

describe('resolveLocale', () => {
  it('lets a fixed setting win over the browser languages', () => {
    expect(resolveLocale('en', ['de-CH'])).toBe('en');
    expect(resolveLocale('de-CH', ['en-US'])).toBe('de-CH');
  });

  it('takes the first supported browser language for auto', () => {
    expect(resolveLocale('auto', ['fr-CH', 'de-AT', 'en'])).toBe('de-CH');
    expect(resolveLocale('auto', ['en-US', 'de'])).toBe('en');
  });

  it('falls back to English when no browser language is supported', () => {
    expect(resolveLocale('auto', ['fr-CH', 'it'])).toBe('en');
    expect(resolveLocale('auto', [])).toBe('en');
  });
});

describe('parseLocaleSetting', () => {
  it('accepts auto and the supported locales only', () => {
    expect(parseLocaleSetting('auto')).toBe('auto');
    expect(parseLocaleSetting('en')).toBe('en');
    expect(parseLocaleSetting('de-CH')).toBe('de-CH');
    expect(parseLocaleSetting('de')).toBeNull();
    expect(parseLocaleSetting('fr')).toBeNull();
    expect(parseLocaleSetting('')).toBeNull();
    expect(parseLocaleSetting(null)).toBeNull();
  });
});

describe('LOCALES', () => {
  it('describes every supported locale under its own tag', () => {
    for (const tag of SUPPORTED_LOCALES) {
      expect(LOCALES[tag].tag).toBe(tag);
      expect(LOCALES[tag].nativeName.length).toBeGreaterThan(0);
    }
  });

  it('uses the decimal comma of de-DE for German numbers and the Swiss rules for dates (D3)', () => {
    expect(LOCALES['de-CH'].numberTag).toBe('de-DE');
    expect(LOCALES['de-CH'].dateTag).toBe('de-CH');
  });

  it('keeps the clock at 24 hours in English (D4)', () => {
    expect(LOCALES.en.dateTag).toBe('en-GB');
  });
});
