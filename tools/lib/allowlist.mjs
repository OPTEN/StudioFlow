import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Path allowlist of the German check. One JSON file per work package in `tools/german-allowlist/`, so edits never
 * collide. Each file is an array of `{ "path": "<glob>", "rules": ["H1", …] | "all", "reason": "…" }`.
 */

/** `**` matches any characters including `/`, `*` any but `/`, `?` one but `/`. Paths use `/`. */
export function globToRegExp(glob) {
  let source = '';
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i];
    if (char === '*') {
      if (glob[i + 1] === '*') {
        i += 1;
        if (glob[i + 1] === '/') {
          i += 1;
          source += '(?:.*/)?';
        } else {
          source += '.*';
        }
      } else {
        source += '[^/]*';
      }
    } else if (char === '?') {
      source += '[^/]';
    } else {
      source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${source}$`);
}

/**
 * Reads every `*.json` file of `directory`.
 * @returns {{ path: string, rules: string[] | 'all', reason: string, file: string, matcher: RegExp, used: boolean }[]}
 */
export function loadAllowlist(directory) {
  if (!existsSync(directory)) {
    return [];
  }
  const entries = [];
  for (const file of readdirSync(directory)
    .filter((name) => name.endsWith('.json'))
    .sort()) {
    const parsed = JSON.parse(readFileSync(join(directory, file), 'utf8'));
    if (!Array.isArray(parsed)) {
      throw new Error(`${file}: expected an array of allowlist entries`);
    }
    for (const entry of parsed) {
      if (
        typeof entry?.path !== 'string' ||
        typeof entry?.reason !== 'string' ||
        !entry.reason.trim()
      ) {
        throw new Error(`${file}: every entry needs a "path" and a "reason"`);
      }
      const rules = entry.rules ?? 'all';
      if (
        rules !== 'all' &&
        !(Array.isArray(rules) && rules.every((rule) => typeof rule === 'string'))
      ) {
        throw new Error(`${file}: "rules" of ${entry.path} must be "all" or a list of rule ids`);
      }
      entries.push({
        path: entry.path,
        rules,
        reason: entry.reason,
        file,
        matcher: globToRegExp(entry.path),
        used: false,
      });
    }
  }
  return entries;
}

/**
 * The rules allowed for a file, or `'all'`. Marks the matching entries as used.
 * @returns {'all' | Set<string>}
 */
export function allowedRulesFor(entries, relativePath) {
  const allowed = new Set();
  for (const entry of entries) {
    if (!entry.matcher.test(relativePath)) {
      continue;
    }
    entry.used = true;
    if (entry.rules === 'all') {
      return 'all';
    }
    for (const rule of entry.rules) {
      allowed.add(rule);
    }
  }
  return allowed;
}

/** Entries that matched no file; a stale entry hides nothing and must be removed. */
export function unusedEntries(entries) {
  return entries.filter((entry) => !entry.used);
}
