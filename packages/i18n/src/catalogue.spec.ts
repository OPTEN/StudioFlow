import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { catalogues } from './catalogue';
import { SOURCE_LOCALE, SUPPORTED_LOCALES, type Locale } from './locales';
import type { MessageValue, PluralMessage } from './types';

// Vitest runs from the repository root.
const messagesDirectory = join(process.cwd(), 'packages/i18n/src/messages');
const PLACEHOLDER = /\{(\w+)\}/g;
const PLURAL_FORMS = ['=0', 'zero', 'one', 'two', 'few', 'many', 'other'] as const;
const KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*(\.[A-Za-z0-9_-]+)+$/;

/** Catalogue files of a locale: `{ name: 'regie-scenes', prefix: 'regie.scenes' }`. */
function namespaceFiles(locale: Locale): { name: string; prefix: string }[] {
  return readdirSync(`${messagesDirectory}/${locale}`)
    .filter((file) => file.endsWith('.ts') && file !== 'index.ts')
    .map((file) => file.slice(0, -3))
    .map((name) => ({ name, prefix: name.replaceAll('-', '.') }));
}

function formsOf(value: MessageValue): [form: string, text: string][] {
  if (typeof value === 'string') {
    return [['', value]];
  }
  return PLURAL_FORMS.flatMap((form) => {
    const text = (value as PluralMessage)[form];
    return text === undefined ? [] : [[form, text] as [string, string]];
  });
}

function placeholders(text: string): string[] {
  return [...new Set([...text.matchAll(PLACEHOLDER)].map((match) => match[1] ?? ''))].sort();
}

const withoutCount = (names: string[]): string[] => names.filter((name) => name !== 'count');

/** Placeholders of a message: those of every form for a plural. */
function placeholdersOf(value: MessageValue): string[] {
  return [...new Set(formsOf(value).flatMap(([, text]) => placeholders(text)))].sort();
}

const english = catalogues[SOURCE_LOCALE];
const keys = Object.keys(english);

describe('catalogues', () => {
  it('have the same files in every locale', () => {
    const reference = namespaceFiles(SOURCE_LOCALE).map((file) => file.name);
    for (const locale of SUPPORTED_LOCALES) {
      expect(namespaceFiles(locale).map((file) => file.name)).toEqual(reference);
    }
  });

  it('give every key to the file whose prefix it starts with', () => {
    const files = namespaceFiles(SOURCE_LOCALE);
    for (const key of keys) {
      const owners = files.filter(({ prefix }) => key.startsWith(`${prefix}.`));
      expect(owners.length, `${key} has no owning file`).toBeGreaterThan(0);
    }
  });

  it('use well-formed keys', () => {
    for (const key of keys) {
      expect(key, key).toMatch(KEY_PATTERN);
    }
  });

  it('never use a key twice across namespaces', () => {
    const seen = new Set<string>();
    for (const { name } of namespaceFiles(SOURCE_LOCALE)) {
      const owned = keys.filter((key) => key.startsWith(`${name.replaceAll('-', '.')}.`));
      for (const key of owned) {
        expect(seen.has(key), `${key} is defined twice`).toBe(false);
        seen.add(key);
      }
    }
    expect(seen.size).toBe(keys.length);
  });
});

describe.each(SUPPORTED_LOCALES)('catalogue %s', (locale) => {
  const catalogue = catalogues[locale];

  it('has exactly the keys of the English catalogue', () => {
    expect(Object.keys(catalogue).sort()).toEqual([...keys].sort());
  });

  it('has no empty message and no literal braces', () => {
    for (const [key, value] of Object.entries(catalogue)) {
      for (const [form, text] of formsOf(value)) {
        const label = `${key}${form ? ` (${form})` : ''}`;
        expect(text.trim().length, `${label} is empty`).toBeGreaterThan(0);
        expect(text.replace(PLACEHOLDER, ''), `${label} has a stray brace`).not.toMatch(/[{}]/);
      }
    }
  });

  it('uses the same placeholders as English, per message and per plural form', () => {
    for (const key of keys) {
      const value = catalogue[key] as MessageValue;
      const source = english[key] as MessageValue;
      expect(typeof value, `${key} changes between string and plural`).toBe(typeof source);
      expect(placeholdersOf(value), `${key} placeholders`).toEqual(placeholdersOf(source));
      if (typeof value !== 'string') {
        for (const [form, text] of formsOf(value)) {
          const counterpart = (source as PluralMessage)[form as keyof PluralMessage];
          if (counterpart !== undefined) {
            expect(withoutCount(placeholders(text)), `${key} (${form}) placeholders`).toEqual(
              withoutCount(placeholders(counterpart)),
            );
          }
        }
      }
    }
  });

  it('provides every plural category of the locale', () => {
    const categories = new Intl.PluralRules(locale).resolvedOptions().pluralCategories;
    for (const [key, value] of Object.entries(catalogue)) {
      if (typeof value === 'string') {
        continue;
      }
      for (const category of categories) {
        expect(
          (value as PluralMessage)[category] ?? (value as PluralMessage).other,
          `${key} lacks "${category}"`,
        ).toBeTypeOf('string');
      }
      expect(Object.keys(value), `${key} needs "other"`).toContain('other');
    }
  });
});
