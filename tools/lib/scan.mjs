import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { allowedRulesFor } from './allowlist.mjs';
import { analyzeLine, RULES } from './german.mjs';
import { splitSource, syntaxFor, withoutComments } from './tokenize.mjs';

/** Extensions (and special names) the check reads. */
const EXTENSIONS = new Set(
  'ts html scss css cs json sh ps1 psm1 yml yaml md webmanifest caddy'.split(' '),
);
const SPECIAL_NAMES = new Set(['Caddyfile', '.env.example']);
const SKIPPED_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  'dist',
  'bin',
  'obj',
  '.angular',
  '.claude',
]);

const DOC_HTML = /^(?:docs|prototype|plan)\//;
const TEST_FILE = /(?:\.spec\.ts$|\.test\.ts$|(?:^|\/)tests?\/|\.Tests?\/)/;
const IGNORE_LINE = /i18n-ignore:/;
const IGNORE_START = /i18n-ignore-start/;
const IGNORE_END = /i18n-ignore-end/;

/** Normalises a path to forward slashes without a leading `./`. */
export function normalizePath(path) {
  return path.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/+$/, '');
}

function extensionOf(path) {
  const name = path.slice(path.lastIndexOf('/') + 1);
  return name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '';
}

/** True when the check reads this file at all. */
export function isScanned(path) {
  const name = path.slice(path.lastIndexOf('/') + 1);
  return SPECIAL_NAMES.has(name) || EXTENSIONS.has(extensionOf(path));
}

/** True for test code, where umlauts are legitimate test data. */
export function isTestFile(path) {
  return TEST_FILE.test(path);
}

function walk(root, directory = root, found = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) {
        walk(root, join(directory, entry.name), found);
      }
    } else {
      found.push(normalizePath(relative(root, join(directory, entry.name))));
    }
  }
  return found;
}

function gitTopLevel(root) {
  try {
    const output = execFileSync('git', ['-C', root, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return realpathSync(output) === realpathSync(root) ? output : null;
  } catch {
    return null;
  }
}

/**
 * The files to check: tracked files of the repository (so `.claude/` and `node_modules` are out), or every file below
 * `root` when it is not a repository root (an extracted archive). `staged` limits it to the staged changes.
 */
export function listFiles(root, { staged = false } = {}) {
  const topLevel = gitTopLevel(root);
  let files;
  if (topLevel === null) {
    files = walk(root);
  } else {
    const args = staged
      ? ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z']
      : ['ls-files', '-z'];
    const output = execFileSync('git', ['-C', root, ...args], {
      encoding: 'utf8',
      maxBuffer: 1 << 28,
    });
    files = output.split('\0').filter(Boolean).map(normalizePath);
  }
  return files.filter(isScanned).sort();
}

/** Keeps the files at or below one of the given paths (all files when none is given). */
export function filterPaths(files, paths) {
  if (paths.length === 0) {
    return files;
  }
  const wanted = paths.map(normalizePath);
  return files.filter((file) =>
    wanted.some((path) => file === path || file.startsWith(`${path}/`)),
  );
}

/** Lines (1-based) switched off by `i18n-ignore:` on the same or previous line, and by start/end markers. */
export function ignoredLines(text) {
  const ignored = new Set();
  let inBlock = false;
  text.split(/\r?\n/u).forEach((line, index) => {
    const number = index + 1;
    if (IGNORE_START.test(line)) {
      inBlock = true;
    }
    if (inBlock) {
      ignored.add(number);
    }
    if (IGNORE_END.test(line)) {
      inBlock = false;
      ignored.add(number);
    }
    if (IGNORE_LINE.test(line)) {
      ignored.add(number);
      ignored.add(number + 1);
    }
  });
  return ignored;
}

/**
 * What to scan of a file and with which rules.
 * - ts, scss, cs: the string literals only (identifiers and comments are not UI text);
 * - Angular templates: everything except `<!-- -->`;
 * - Markdown and documentation HTML: everything, without guillemets (they are quotation marks there);
 * - scripts and configuration: everything, comments included, because operators read them.
 */
function prepare(path, text) {
  const extension = extensionOf(path);
  const syntax = syntaxFor(extension);
  if (syntax === 'html') {
    if (DOC_HTML.test(path)) {
      return { text, rules: RULES.filter((rule) => rule !== 'H2') };
    }
    return { text: withoutComments(text, 'html'), rules: RULES };
  }
  if (syntax !== null) {
    return { text: splitSource(text, syntax).strings, rules: RULES };
  }
  if (extension === 'md') {
    return { text, rules: RULES.filter((rule) => rule !== 'H2') };
  }
  return { text, rules: RULES };
}

/**
 * Scans one file.
 * @param {{ path: string, text: string, comments?: boolean, allowlist?: object[] }} input
 * @returns {{ file: string, line: number, rule: string, severity: 'error' | 'info', detail: string, text: string }[]}
 */
export function scanFile({ path, text, comments = false, allowlist = [] }) {
  const allowed = allowedRulesFor(allowlist, path);
  if (allowed === 'all') {
    return [];
  }
  const ignored = ignoredLines(text);
  const lines = text.split(/\r?\n/u);
  const findings = [];

  if (comments) {
    const syntax = syntaxFor(extensionOf(path));
    if (syntax === null || syntax === 'html') {
      return [];
    }
    const commentText = splitSource(text, syntax).comments.split(/\r?\n/u);
    commentText.forEach((line, index) => {
      if (ignored.has(index + 1)) {
        return;
      }
      // An umlaut in a comment is German prose; guillemets are tolerated as quotation marks and only noted.
      for (const hit of analyzeLine(line, { rules: ['H1', 'H2'] })) {
        if (allowed.has(hit.rule)) {
          continue;
        }
        findings.push({
          file: path,
          line: index + 1,
          rule: hit.rule,
          severity: hit.rule === 'H1' ? 'error' : 'info',
          detail: hit.detail,
          text: (lines[index] ?? '').trim(),
        });
      }
    });
    return findings;
  }

  const prepared = prepare(path, text);
  const test = isTestFile(path);
  prepared.text.split(/\r?\n/u).forEach((line, index) => {
    if (ignored.has(index + 1)) {
      return;
    }
    const hits = analyzeLine(line, { rules: prepared.rules }).filter(
      (hit) => !allowed.has(hit.rule),
    );
    if (hits.length === 0) {
      return;
    }
    const onlyUmlaut = hits.length === 1 && hits[0].rule === 'H1';
    const severity = test && onlyUmlaut ? 'info' : 'error';
    for (const hit of hits) {
      findings.push({
        file: path,
        line: index + 1,
        rule: hit.rule,
        severity,
        detail: hit.detail,
        text: (lines[index] ?? '').trim(),
      });
    }
  });
  return findings;
}

/** Reads and scans many files. Unreadable files (a directory with a file extension) are skipped. */
export function scanFiles({ root, files, comments, allowlist }) {
  const findings = [];
  for (const path of files) {
    const absolute = resolve(root, path.split('/').join(sep));
    let text;
    try {
      if (!statSync(absolute).isFile()) {
        continue;
      }
      text = readFileSync(absolute, 'utf8');
    } catch {
      continue;
    }
    findings.push(...scanFile({ path, text, comments, allowlist }));
  }
  return findings;
}
