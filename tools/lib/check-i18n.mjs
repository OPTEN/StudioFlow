import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { globToRegExp } from './allowlist.mjs';
import { withoutComments } from './tokenize.mjs';

/**
 * The rules of `npm run check:i18n` as small pure functions: they take file contents and return findings, so they can
 * be tested without a checkout. Findings are `{ rule, file, line, message }`; `severity` is added by the CLI.
 */

/** Values that are the same in English and German on purpose (loan words, product terms, symbols). */
export const IDENTICAL_OK = new Set([
  'ok',
  'output',
  'dock',
  'screen',
  'take',
  'tally',
  'monitoring',
  'layout',
  'status',
  'preview',
  'program',
  'live',
  'studio',
  'name',
  'station',
  'email',
  'online',
  'offline',
  'details',
  'info',
  'standby',
  'proxy',
  'upload',
  'download',
  'link',
  'code',
  'info',
  'text',
  'start',
  'stopp',
  'regie',
]);

const KEY_DEPTH_LIMIT = 4;

function messageStrings(value) {
  return typeof value === 'string' ? [['', value]] : Object.entries(value);
}

/**
 * Prefix rule, depth and duplicates. A file `<area>-<feature>.ts` owns exactly the keys `<area>.<feature>.*`.
 * @param {Map<string, Map<string, { prefix: string, messages: Record<string, unknown>, file: string }>>} catalogues
 */
export function checkNamespaces(catalogues) {
  const findings = [];
  const owners = new Map();
  for (const [locale, namespaces] of catalogues) {
    for (const [name, { prefix, messages, file }] of namespaces) {
      for (const key of Object.keys(messages)) {
        if (!key.startsWith(`${prefix}.`)) {
          findings.push({
            rule: 'prefix',
            file,
            line: 0,
            message: `key "${key}" is outside the prefix "${prefix}." of ${name}.ts`,
          });
        }
        if (locale === 'en' && key.split('.').length > KEY_DEPTH_LIMIT) {
          findings.push({
            rule: 'depth',
            severity: 'warning',
            file,
            line: 0,
            message: `key "${key}" has more than ${KEY_DEPTH_LIMIT} segments`,
          });
        }
        if (locale === 'en') {
          const owner = owners.get(key);
          if (owner !== undefined && owner !== name) {
            findings.push({
              rule: 'duplicate',
              file,
              line: 0,
              message: `key "${key}" is also defined in ${owner}.ts`,
            });
          }
          owners.set(key, name);
        }
      }
    }
  }
  return findings;
}

/** Warns when a German value is exactly the English one, which usually means "not translated yet". */
export function checkIdenticalValues(catalogues) {
  const findings = [];
  const english = catalogues.get('en') ?? new Map();
  for (const [locale, namespaces] of catalogues) {
    if (locale === 'en') {
      continue;
    }
    for (const [name, { messages, file }] of namespaces) {
      const source = english.get(name)?.messages ?? {};
      for (const [key, value] of Object.entries(messages)) {
        const sourceValue = source[key];
        if (sourceValue === undefined) {
          continue;
        }
        for (const [form, text] of messageStrings(value)) {
          const reference = typeof sourceValue === 'string' ? sourceValue : sourceValue[form];
          if (reference !== text) {
            continue;
          }
          const words = text.replace(/\{\w+\}/g, '').trim();
          // Symbols, units like "min" and loan words are the same in both languages.
          const letters = words.replace(/[^\p{L}]/gu, '');
          if (letters.length <= 3 || IDENTICAL_OK.has(words.toLowerCase())) {
            continue;
          }
          findings.push({
            rule: 'identical',
            severity: 'warning',
            file,
            line: 0,
            message: `${key}${form ? ` (${form})` : ''} is the same as in English: "${text}"`,
          });
        }
      }
    }
  }
  return findings;
}

const BANNED_PATTERNS = [
  [
    /\.toFixed\([^)]*\)\s*\.replace\(\s*['"]\.['"]\s*,\s*['"],['"]/,
    'decimal comma by string replacement; use formatNumber or the scene-model format helpers',
  ],
  [
    /\.toLocale(?:Date|Time)?String\(/,
    'toLocale*String; use the format helpers of @studioflow/i18n',
  ],
  [/\bIntl\.[A-Z]\w*\s*\(/, 'Intl constructor; only packages/i18n creates Intl formatters'],
  [
    /\b(?:DatePipe|DecimalPipe|PercentPipe|CurrencyPipe|registerLocaleData|LOCALE_ID)\b/,
    'Angular locale pipe or locale data; the locale comes from @studioflow/i18n',
  ],
];
const BANNED_TEMPLATE_PIPE =
  /\|\s*(?:date|number|percent|currency|decimal|i18nPlural|i18nSelect)\b/;

/** Number, date and plural formatting outside `packages/i18n`. */
export function findBannedFormatting(path, text) {
  const code = path.endsWith('.html') ? withoutComments(text, 'html') : withoutComments(text, 'ts');
  const findings = [];
  code.split(/\r?\n/u).forEach((line, index) => {
    for (const [pattern, why] of BANNED_PATTERNS) {
      if (pattern.test(line)) {
        findings.push({ rule: 'banned-format', file: path, line: index + 1, message: why });
      }
    }
    if (path.endsWith('.html') && BANNED_TEMPLATE_PIPE.test(line)) {
      findings.push({
        rule: 'banned-format',
        file: path,
        line: index + 1,
        message: 'Angular formatting pipe; use t() and the format helpers',
      });
    }
  });
  return findings;
}

const MODULE_LEVEL_T = /^(?:export\s+)?(?:const|let|var)\s+[\w$]+(?:\s*:[^=]+)?\s*=\s*(?:t|tm)\(/;

/** R1: a translated string at module scope never follows a language switch. */
export function findModuleLevelT(path, text) {
  const findings = [];
  text.split(/\r?\n/u).forEach((line, index) => {
    if (MODULE_LEVEL_T.test(line)) {
      findings.push({
        rule: 'module-t',
        file: path,
        line: index + 1,
        message:
          'module-level t() call (R1): store a MessageKey or Msg and resolve it when it is shown',
      });
    }
  });
  return findings;
}

/** The Angular glue may only be imported by the two Angular apps; the framework-free entry must not import Angular. */
export function findForbiddenImports(path, text) {
  const findings = [];
  const inApp = path.startsWith('apps/studio/') || path.startsWith('apps/sender/');
  const inI18n = path.startsWith('packages/i18n/');
  const isGlue = /^packages\/i18n\/src\/angular(?:\.spec)?\.ts$/.test(path);
  text.split(/\r?\n/u).forEach((line, index) => {
    if (/from\s+['"]@studioflow\/i18n\/angular['"]/.test(line) && !inApp && !inI18n) {
      findings.push({
        rule: 'angular-import',
        file: path,
        line: index + 1,
        message: '@studioflow/i18n/angular may only be imported by apps/studio and apps/sender',
      });
    }
    if (inI18n && !isGlue && /from\s+['"]@angular\//.test(line)) {
      findings.push({
        rule: 'angular-import',
        file: path,
        line: index + 1,
        message: 'only packages/i18n/src/angular.ts may import Angular',
      });
    }
  });
  return findings;
}

/** Keys that no source file mentions, neither literally nor through a template literal prefix. */
export function findUnusedKeys(catalogues, sources) {
  const english = catalogues.get('en') ?? new Map();
  const all = [...sources.values()].join('\n');
  const prefixes = [...all.matchAll(/`([\w.-]+\.)\$\{/g)].map((match) => match[1]);
  const findings = [];
  for (const { messages, file } of english.values()) {
    for (const key of Object.keys(messages)) {
      const mentioned = ["'", '"', '`'].some((quote) => all.includes(`${quote}${key}${quote}`));
      if (!mentioned && !prefixes.some((prefix) => key.startsWith(prefix))) {
        findings.push({
          rule: 'unused',
          severity: 'warning',
          file,
          line: 0,
          message: `key "${key}" is not used`,
        });
      }
    }
  }
  return findings;
}

/**
 * Known violations that a work package still has to fix: `tools/i18n-baseline/<package>.json`, entries
 * `{ "path": "<glob>", "rule": "<rule id>", "reason": "…" }`. A finding covered by an entry is not reported; an entry
 * that covers no finding is itself an error, so the list can only shrink.
 */
export function loadBaseline(directory) {
  if (!existsSync(directory)) {
    return [];
  }
  const entries = [];
  for (const file of readdirSync(directory)
    .filter((name) => name.endsWith('.json'))
    .sort()) {
    for (const entry of JSON.parse(readFileSync(join(directory, file), 'utf8'))) {
      entries.push({ ...entry, file, matcher: globToRegExp(entry.path), used: false });
    }
  }
  return entries;
}

/** Splits findings into reported ones and the ones the baseline covers; marks the entries used. */
export function applyBaseline(findings, baseline) {
  return findings.filter((finding) => {
    const entry = baseline.find(
      (candidate) => candidate.rule === finding.rule && candidate.matcher.test(finding.file),
    );
    if (entry) {
      entry.used = true;
      return false;
    }
    return true;
  });
}
