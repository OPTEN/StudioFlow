import type { MessageKey, en } from './catalogue';

/**
 * A message with plural forms, selected by `count`. `other` is always required; `'=0'` (ICU-style exact zero) wins for
 * a count of 0 in every locale; the CLDR categories are chosen with `Intl.PluralRules` of the active locale.
 */
export interface PluralMessage {
  readonly '=0'?: string;
  readonly zero?: string;
  readonly one?: string;
  readonly two?: string;
  readonly few?: string;
  readonly many?: string;
  readonly other: string;
}

export type MessageValue = string | PluralMessage;

/**
 * The shape of one catalogue file: every key starts with the prefix of the file. Used with
 * `as const satisfies Namespace<'regie.scenes'>`, which rejects keys outside the prefix and bad values.
 */
export type Namespace<P extends string> = { readonly [K in `${P}.${string}`]: MessageValue };

/** All messages of one locale, flat. */
export type Catalogue = Readonly<Record<string, MessageValue>>;

/** Placeholder names `{name}` of a string literal type. */
type Names<S extends string> = S extends `${string}{${infer N}}${infer R}` ? N | Names<R> : never;

/** All strings of a plural message. */
type Forms<M extends PluralMessage> = Extract<M[keyof M], string>;

/**
 * Parameters a message needs, derived from the English literal: `undefined` without placeholders, otherwise an object
 * with one entry per placeholder. Plural messages additionally require a numeric `count`.
 */
export type Params<K extends MessageKey> = (typeof en)[K] extends PluralMessage
  ? { readonly count: number } & Readonly<
      Record<Exclude<Names<Forms<(typeof en)[K]>>, 'count'>, string | number>
    >
  : [Names<(typeof en)[K] & string>] extends [never]
    ? undefined
    : Readonly<Record<Names<(typeof en)[K] & string>, string | number>>;

/** Keys whose message has no placeholders and no plural forms: `t(key)` needs no parameters for any of them. */
export type PlainMessageKey = {
  [K in MessageKey]: Params<K> extends undefined ? K : never;
}[MessageKey];

/** Rest arguments of `t(key, …)`: nothing for a plain message, the parameters otherwise. */
export type TArgs<K extends MessageKey> =
  Params<K> extends undefined ? [params?: undefined] : [params: Params<K>];

/**
 * A translation must mirror its English counterpart exactly: a missing key, an extra key or a plain string where a
 * plural message is expected is a compile error. (Placeholders and plural categories are checked by the parity specs.)
 */
export type Translation<E extends Catalogue> = {
  readonly [K in keyof E]: E[K] extends string ? string : PluralMessage;
};
