import { catalogues } from './catalogue';
import type { MessageKey } from './catalogue';
import { reportProblem } from './diagnostics';
import { SOURCE_LOCALE, type Locale } from './locales';
import { getLocale } from './store';
import type { MessageValue, PluralMessage, TArgs } from './types';

type ParamValues = Readonly<Record<string, string | number>>;

const PLACEHOLDER = /\{(\w+)\}/g;
const pluralRules = new Map<Locale, Intl.PluralRules>();

function lookup(locale: Locale, key: string): MessageValue | undefined {
  const own = catalogues[locale];
  if (Object.hasOwn(own, key)) {
    return own[key];
  }
  const source = catalogues[SOURCE_LOCALE];
  return Object.hasOwn(source, key) ? source[key] : undefined;
}

function selectForm(message: PluralMessage, count: number, locale: Locale): string {
  if (count === 0 && message['=0'] !== undefined) {
    return message['=0'];
  }
  let rules = pluralRules.get(locale);
  if (!rules) {
    rules = new Intl.PluralRules(locale);
    pluralRules.set(locale, rules);
  }
  return message[rules.select(count)] ?? message.other;
}

function interpolate(
  template: string,
  params: ParamValues | undefined,
  key: string,
  locale: Locale,
): string {
  return template.replace(PLACEHOLDER, (placeholder, name: string) => {
    const value = params?.[name];
    if (value === undefined) {
      reportProblem({ kind: 'param', key, locale, param: name });
      return placeholder;
    }
    return String(value);
  });
}

/** Untyped core of {@link t}: active locale → English → the key itself. */
function translate(locale: Locale, key: string, params: ParamValues | undefined): string {
  const message = lookup(locale, key);
  if (message === undefined) {
    reportProblem({ kind: 'key', key, locale });
    return key;
  }
  if (typeof message === 'string') {
    return interpolate(message, params, key, locale);
  }
  const count = Number(params?.['count']);
  return interpolate(selectForm(message, count, locale), params, key, locale);
}

/**
 * The message for `key` in the active locale, with `{name}` placeholders filled from `params`. The key and the
 * parameters are checked against the English catalogue at compile time, in code and in templates.
 * Inside a signal context (`computed`, template) the call depends on the active locale.
 * Numbers are never formatted here: pass strings from the format helpers; `count` is inserted as `String(count)`.
 */
export function t<K extends MessageKey>(key: K, ...args: TArgs<K>): string {
  return translate(getLocale(), key, args[0]);
}

/** {@link t} for an explicit locale: tests and English diagnostic notes. */
export function tFor(locale: Locale): typeof t {
  return (key, ...args) => translate(locale, key, args[0]);
}

/** A message that is typed when created and resolved when shown (values that outlive an interaction). */
export interface Msg {
  readonly key: MessageKey;
  readonly params?: ParamValues;
}

/** Creates a {@link Msg}; key and parameters are checked like in {@link t}. */
export function msg<K extends MessageKey>(key: K, ...args: TArgs<K>): Msg {
  const params = args[0] as ParamValues | undefined;
  return params === undefined ? { key } : { key, params };
}

/** Resolves a {@link Msg} in the active locale; an empty string for `null` and `undefined`. */
export function tm(message: Msg | null | undefined): string {
  return message ? translate(getLocale(), message.key, message.params) : '';
}

/** Identity that keeps the literal type, for tables like `satisfies Record<Code, MessageKey>`. */
export function key<K extends MessageKey>(messageKey: K): K {
  return messageKey;
}
