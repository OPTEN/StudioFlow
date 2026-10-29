/**
 * @studioflow/i18n: the typed message layer of StudioFlow. Framework-free and safe for the output page; the Angular
 * glue lives in the secondary entry `@studioflow/i18n/angular`.
 */
export {
  LOCALES,
  LOCALE_STORAGE_KEY,
  SOURCE_LOCALE,
  SUPPORTED_LOCALES,
  parseLocaleSetting,
  parseLocaleTag,
  resolveLocale,
} from './locales';
export type { Locale, LocaleInfo, LocaleSetting } from './locales';

export {
  getLocale,
  getLocaleSetting,
  initLocale,
  installLocaleReader,
  onLocaleChange,
  resetLocaleForTests,
  setLocaleSetting,
} from './store';
export type { InitOptions, LocaleListener, LocaleStorage } from './store';

export { key, msg, t, tFor, tm } from './translate';
export type { Msg } from './translate';

export { missingKeys, setMissingHandler } from './diagnostics';
export type { I18nProblem, ProblemHandler } from './diagnostics';

export {
  browserTimeZone,
  compareText,
  countCharacters,
  formatDate,
  formatDateTime,
  formatNumber,
  formatTime,
  formatWeekday,
  lowerCase,
  zonedClock,
} from './format';
export type { NumberFormatOptions, ZonedClock } from './format';

export type { MessageKey } from './catalogue';
export type {
  Catalogue,
  MessageValue,
  Namespace,
  Params,
  PlainMessageKey,
  PluralMessage,
  TArgs,
  Translation,
} from './types';
