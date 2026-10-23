import type { Locale } from './locales';
import { deCH } from './messages/de-CH';
import { en } from './messages/en';
import type { Catalogue } from './types';

export { deCH, en };

/** Every message key: the keys of the English (source) catalogue. */
export type MessageKey = keyof typeof en;

/** The catalogue of each locale. Both are bundled (no lazy loading). */
export const catalogues: Readonly<Record<Locale, Catalogue>> = { en, 'de-CH': deCH };
