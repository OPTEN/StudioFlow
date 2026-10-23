/** Locales StudioFlow ships catalogues for. English is the source language, `de-CH` the first translation. */
export const SUPPORTED_LOCALES = ['en', 'de-CH'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

/** What the user chose: a fixed locale, or `auto` to follow the browser language. */
export type LocaleSetting = 'auto' | Locale;

/** The language all messages are written in first; the fallback of every other catalogue. */
export const SOURCE_LOCALE: Locale = 'en';

/** `localStorage` key of the user's choice; absent means `auto`. Shared by the Regie, `/monitoring` and the sender. */
export const LOCALE_STORAGE_KEY = 'studioflow.locale';

/** Static facts about a locale. */
export interface LocaleInfo {
  readonly tag: Locale;
  /** Name in the language itself; never translated (it is the label in the language select). */
  readonly nativeName: string;
  /** BCP 47 tag for `Intl.NumberFormat` and plural rules. */
  readonly numberTag: string;
  /** BCP 47 tag for `Intl.DateTimeFormat`, `Intl.Collator` and case mapping. */
  readonly dateTag: string;
}

/**
 * Formatting tags per locale.
 *
 * `de-CH` numbers use `de-DE` rules: CLDR writes the Swiss decimal separator as a point ("2.8"), but the product
 * convention is the decimal comma ("2,8"). Dates and times stay `de-CH` (24 h clock, "23.10.2026").
 * English uses `en-GB` for dates so the clock is 24 h as well.
 */
export const LOCALES: Readonly<Record<Locale, LocaleInfo>> = {
  en: { tag: 'en', nativeName: 'English', numberTag: 'en', dateTag: 'en-GB' },
  'de-CH': { tag: 'de-CH', nativeName: 'Deutsch (Schweiz)', numberTag: 'de-DE', dateTag: 'de-CH' },
};

const LANGUAGE_PATTERN = /^([a-z]{2,3})(?:[-_]|$)/i;

/**
 * Maps a BCP 47 language tag to a supported locale: `en` and `en-*` → `en`, `de` and `de-*` (DE, AT, LI, CH) → `de-CH`.
 * Any other language, and an empty or malformed tag, gives `null`, so the caller can try the next preference.
 */
export function parseLocaleTag(tag: string | null | undefined): Locale | null {
  const language = LANGUAGE_PATTERN.exec(tag?.trim() ?? '')?.[1]?.toLowerCase();
  switch (language) {
    case 'en':
      return 'en';
    case 'de':
      return 'de-CH';
    default:
      return null;
  }
}

/** Setting → locale: a fixed setting wins, `auto` takes the first supported browser language, then English. */
export function resolveLocale(setting: LocaleSetting, languages: readonly string[]): Locale {
  if (setting !== 'auto') {
    return setting;
  }
  for (const tag of languages) {
    const locale = parseLocaleTag(tag);
    if (locale !== null) {
      return locale;
    }
  }
  return SOURCE_LOCALE;
}

/** Narrows a stored or user-supplied value to a {@link LocaleSetting}; anything else is `null`. */
export function parseLocaleSetting(value: string | null | undefined): LocaleSetting | null {
  if (value === 'auto') {
    return 'auto';
  }
  return (SUPPORTED_LOCALES as readonly string[]).includes(value ?? '') ? (value as Locale) : null;
}
