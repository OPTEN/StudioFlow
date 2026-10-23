import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { allowedRulesFor, globToRegExp, loadAllowlist, unusedEntries } from './allowlist.mjs';

function withDirectory(files: Record<string, unknown>): string {
  const directory = mkdtempSync(join(tmpdir(), 'allowlist-'));
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(
      join(directory, name),
      typeof content === 'string' ? content : JSON.stringify(content),
    );
  }
  return directory;
}

describe('globToRegExp', () => {
  it.each([
    ['packages/i18n/src/messages/de-CH/**', 'packages/i18n/src/messages/de-CH/common.ts', true],
    ['packages/i18n/src/messages/de-CH/**', 'packages/i18n/src/messages/en/common.ts', false],
    ['**/*.de.spec.ts', 'apps/studio/src/a/b.de.spec.ts', true],
    ['**/*.de.spec.ts', 'a.de.spec.ts', true],
    ['**/*.de.spec.ts', 'a.spec.ts', false],
    ['packages/i18n/src/*.spec.ts', 'packages/i18n/src/format.spec.ts', true],
    ['packages/i18n/src/*.spec.ts', 'packages/i18n/src/messages/x.spec.ts', false],
    ['**/generated/**', 'packages/scene-model/src/generated/api.ts', true],
    ['package-lock.json', 'package-lock.json', true],
    ['package-lock.json', 'sub/package-lock.json', false],
    ['a/?.ts', 'a/b.ts', true],
    ['a/?.ts', 'a/bb.ts', false],
    ['a.b', 'axb', false],
  ])('%s vs %s → %s', (glob, path, expected) => {
    expect(globToRegExp(glob).test(path)).toBe(expected);
  });
});

describe('loadAllowlist', () => {
  it('reads every JSON file of the directory', () => {
    const directory = withDirectory({
      'a.json': [{ path: 'x/**', rules: ['H1'], reason: 'why' }],
      'b.json': [{ path: 'y', reason: 'why' }],
      'ignored.txt': 'nothing',
    });
    try {
      const entries = loadAllowlist(directory);
      expect(entries.map((entry) => [entry.path, entry.rules, entry.file])).toEqual([
        ['x/**', ['H1'], 'a.json'],
        ['y', 'all', 'b.json'],
      ]);
    } finally {
      rmSync(directory, { recursive: true });
    }
  });

  it('gives an empty list for a missing directory', () => {
    expect(loadAllowlist(join(tmpdir(), 'does-not-exist-allowlist'))).toEqual([]);
  });

  it('rejects an entry without a reason or with bad rules', () => {
    for (const content of [
      [{ path: 'x' }],
      [{ path: 'x', reason: ' ' }],
      [{ path: 'x', reason: 'r', rules: 'H1' }],
      { path: 'x' },
    ]) {
      const directory = withDirectory({ 'a.json': content });
      try {
        expect(() => loadAllowlist(directory)).toThrow();
      } finally {
        rmSync(directory, { recursive: true });
      }
    }
  });
});

describe('allowedRulesFor / unusedEntries', () => {
  it('combines the rules of all matching entries, "all" winning', () => {
    const directory = withDirectory({
      'a.json': [
        { path: 'x/*.ts', rules: ['H1'], reason: 'r' },
        { path: 'x/a.ts', rules: ['H2'], reason: 'r' },
        { path: 'z/**', rules: 'all', reason: 'r' },
        { path: 'never', rules: 'all', reason: 'r' },
      ],
    });
    try {
      const entries = loadAllowlist(directory);
      expect([...(allowedRulesFor(entries, 'x/a.ts') as Set<string>)].sort()).toEqual(['H1', 'H2']);
      expect(allowedRulesFor(entries, 'z/deep/f.ts')).toBe('all');
      expect([...(allowedRulesFor(entries, 'other.ts') as Set<string>)]).toEqual([]);
      expect(unusedEntries(entries).map((entry) => entry.path)).toEqual(['never']);
    } finally {
      rmSync(directory, { recursive: true });
    }
  });
});
