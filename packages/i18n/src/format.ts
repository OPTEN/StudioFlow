import { LOCALES, type LocaleInfo } from './locales';
import { getLocale } from './store';

/**
 * Locale-aware formatting. Every helper reads the active locale, caches its `Intl` instance and expects finite numbers
 * and valid dates: callers keep the handling of unknown values (see `MISSING_VALUE` in `@studioflow/scene-model`).
 * This is the only place that constructs `Intl` formatters; `npm run check:i18n` bans them elsewhere.
 */

export interface NumberFormatOptions {
  readonly minimumFractionDigits?: number;
  readonly maximumFractionDigits?: number;
  /** Default `'negative'`: a value that rounds to zero never shows a minus sign ("-0.0"). */
  readonly signDisplay?: 'auto' | 'never' | 'always' | 'exceptZero' | 'negative';
  /** Thousands separators; off by default (the product shows "1234,5", not "1.234,5"). */
  readonly useGrouping?: boolean;
}

type Formatter = Intl.NumberFormat | Intl.DateTimeFormat | Intl.Collator;

const cache = new Map<string, Formatter>();

function cached<T extends Formatter>(
  kind: string,
  tag: string,
  options: object,
  create: () => T,
): T {
  const id = `${kind}|${tag}|${JSON.stringify(options)}`;
  let instance = cache.get(id);
  if (!instance) {
    instance = create();
    cache.set(id, instance);
  }
  return instance as T;
}

function activeLocale(): LocaleInfo {
  return LOCALES[getLocale()];
}

/** Number in the active locale ("2,8" in German, "2.8" in English). */
export function formatNumber(value: number, options: NumberFormatOptions = {}): string {
  const { numberTag } = activeLocale();
  const resolved = { signDisplay: 'negative', useGrouping: false, ...options } as const;
  return cached(
    'number',
    numberTag,
    resolved,
    () => new Intl.NumberFormat(numberTag, resolved),
  ).format(value);
}

/** Clock time "HH:mm" or "HH:mm:ss", always 24 h. */
export function formatTime(date: Date, { seconds = false }: { seconds?: boolean } = {}): string {
  const { dateTag } = activeLocale();
  const options: Intl.DateTimeFormatOptions = {
    hour: '2-digit',
    minute: '2-digit',
    second: seconds ? '2-digit' : undefined,
    hourCycle: 'h23',
  };
  return cached('time', dateTag, options, () => new Intl.DateTimeFormat(dateTag, options)).format(
    date,
  );
}

/** Calendar date, e.g. "23 Oct 2026" or "23.10.2026". */
export function formatDate(date: Date): string {
  const { dateTag } = activeLocale();
  const options = { dateStyle: 'medium' } as const;
  return cached('date', dateTag, options, () => new Intl.DateTimeFormat(dateTag, options)).format(
    date,
  );
}

/** Calendar date and time (24 h), e.g. "23 Oct 2026, 14:05" or "23.10.2026, 14:05"; with `seconds` "…, 14:05:09". */
export function formatDateTime(
  date: Date,
  { seconds = false }: { seconds?: boolean } = {},
): string {
  const { dateTag } = activeLocale();
  const options = {
    dateStyle: 'medium',
    timeStyle: seconds ? 'medium' : 'short',
    hourCycle: 'h23',
  } as const;
  return cached(
    'datetime',
    dateTag,
    options,
    () => new Intl.DateTimeFormat(dateTag, options),
  ).format(date);
}

/** Name of a weekday (0 = Sunday … 6 = Saturday, as in cron): "Monday", "Montag". */
export function formatWeekday(day: number): string {
  const { dateTag } = activeLocale();
  const options = { weekday: 'long', timeZone: 'UTC' } as const;
  // 7 January 2024 was a Sunday.
  return cached(
    'weekday',
    dateTag,
    options,
    () => new Intl.DateTimeFormat(dateTag, options),
  ).format(new Date(Date.UTC(2024, 0, 7 + (((day % 7) + 7) % 7))));
}

/** The IANA time zone of this browser ("Europe/Zurich"), or "UTC" when the browser does not tell. */
export function browserTimeZone(): string {
  try {
    return new Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** Wall clock of a moment in an IANA time zone. */
export interface ZonedClock {
  /** 0 = Sunday … 6 = Saturday. */
  readonly weekday: number;
  readonly hour: number;
  readonly minute: number;
}

const WEEKDAY_NUMBERS: Readonly<Record<string, number>> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/** The weekday, hour and minute of `date` in `timeZone`, or null for a time zone the browser does not know. */
export function zonedClock(date: Date, timeZone: string): ZonedClock | null {
  const options = {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  } as const;
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = cached(
      'zoned',
      'en-US',
      options,
      () => new Intl.DateTimeFormat('en-US', options),
    ).formatToParts(date);
  } catch {
    return null;
  }
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((entry) => entry.type === type)?.value ?? '';
  const weekday = WEEKDAY_NUMBERS[part('weekday')];
  return weekday === undefined
    ? null
    : { weekday, hour: Number(part('hour')), minute: Number(part('minute')) };
}

/** Compares user-visible text case-insensitively; `numeric` orders "K2" before "K10". */
export function compareText(
  a: string,
  b: string,
  { numeric = false }: { numeric?: boolean } = {},
): number {
  const { dateTag } = activeLocale();
  const options = { sensitivity: 'base', numeric } as const;
  return cached('collator', dateTag, options, () => new Intl.Collator(dateTag, options)).compare(
    a,
    b,
  );
}

/** Lower-cases user-visible text by the rules of the active locale. */
export function lowerCase(text: string): string {
  return text.toLocaleLowerCase(activeLocale().dateTag);
}

const graphemeSegmenter =
  typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter('en', { granularity: 'grapheme' })
    : null;

/**
 * Number of user-perceived characters of a text (an emoji with modifiers or a combined letter counts once). It does not
 * depend on the active locale and matches the text elements the API counts.
 */
export function countCharacters(text: string): number {
  return graphemeSegmenter
    ? Array.from(graphemeSegmenter.segment(text)).length
    : Array.from(text).length;
}
