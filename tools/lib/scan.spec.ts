import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadAllowlist } from './allowlist.mjs';
import { filterPaths, ignoredLines, isScanned, isTestFile, listFiles, scanFile } from './scan.mjs';

const rulesOf = (findings: { rule: string }[]): string[] => findings.map((finding) => finding.rule);

describe('scanFile: what is scanned', () => {
  it('scans the strings of TypeScript but not its comments or identifiers', () => {
    const text = ['// Gerät ist hier', 'const nicht = 1;', "const label = 'Szene löschen';"].join(
      '\n',
    );
    const findings = scanFile({ path: 'apps/x.ts', text });
    expect(findings.map((finding) => finding.line)).toEqual([3, 3]);
    expect(rulesOf(findings).sort()).toEqual(['H1', 'H4']);
  });

  it('scans Angular templates including attributes, but not <!-- --> comments', () => {
    const text = '<!-- Gerät -->\n<button aria-label="Gerät koppeln">Szene</button>';
    const findings = scanFile({ path: 'apps/x/y.html', text });
    expect(findings.every((finding) => finding.line === 2)).toBe(true);
    expect(findings.length).toBeGreaterThan(0);
  });

  it('scans scripts completely, comments included, because operators read them', () => {
    const findings = scanFile({
      path: 'update.sh',
      text: '# Images bauen und Stack neu starten\necho done',
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ line: 1, rule: 'H3', severity: 'error' });
  });

  it('ignores guillemets in Markdown and documentation HTML', () => {
    expect(scanFile({ path: 'docs/guide.md', text: 'Say «hello» to everyone.' })).toEqual([]);
    expect(scanFile({ path: 'docs/page.html', text: '<p>Say «hello»</p>' })).toEqual([]);
    expect(rulesOf(scanFile({ path: 'apps/x/y.html', text: '<p>Say «hello»</p>' }))).toEqual([
      'H2',
    ]);
  });

  it('finds German in JSON and in a C# string but not in a C# comment', () => {
    expect(
      scanFile({ path: 'x.webmanifest', text: '{ "description": "Kamera senden" }' }),
    ).not.toEqual([]);
    const cs = '/// Szene «A»\nvar a = $"Szene {name} ist live";';
    expect(scanFile({ path: 'apps/api/A.cs', text: cs }).map((finding) => finding.line)).toEqual([
      2,
    ]);
  });
});

describe('scanFile: severity', () => {
  it('downgrades an umlaut alone in test code to info', () => {
    const text = "const name = 'Bühne';";
    expect(scanFile({ path: 'apps/x/y.spec.ts', text })).toMatchObject([
      { rule: 'H1', severity: 'info' },
    ]);
    expect(scanFile({ path: 'apps/x/y.ts', text })).toMatchObject([
      { rule: 'H1', severity: 'error' },
    ]);
  });

  it('keeps an error when other rules hit the same line in test code', () => {
    const findings = scanFile({
      path: 'apps/x/y.spec.ts',
      text: "expect(a).toBe('Szene löschen');",
    });
    expect(findings.length).toBe(2);
    expect(findings.every((finding) => finding.severity === 'error')).toBe(true);
  });

  it('recognises test files', () => {
    expect(isTestFile('apps/a/b.spec.ts')).toBe(true);
    expect(isTestFile('tests/e2e/specs/a.ts')).toBe(true);
    expect(isTestFile('apps/api/tests/Core.Tests/A.cs')).toBe(true);
    expect(isTestFile('apps/a/b.ts')).toBe(false);
  });
});

describe('scanFile: markers', () => {
  it('honours i18n-ignore on the same and on the previous line', () => {
    const same = "const a = 'Szene'; // i18n-ignore: product term";
    expect(scanFile({ path: 'a.ts', text: same })).toEqual([]);
    const before = "// i18n-ignore: product term\nconst a = 'Szene';\nconst b = 'Szene';";
    expect(scanFile({ path: 'a.ts', text: before }).map((finding) => finding.line)).toEqual([3]);
  });

  it('honours # and <!-- --> forms', () => {
    expect(scanFile({ path: 'a.sh', text: '# i18n-ignore: example\necho Szene' })).toEqual([]);
    expect(
      scanFile({ path: 'a/b.html', text: '<!-- i18n-ignore: example -->\n<p>Szene</p>' }),
    ).toEqual([]);
  });

  it('honours start and end markers', () => {
    const text = [
      "const a = 'Szene';",
      '// i18n-ignore-start',
      "const b = 'Szene';",
      "const c = 'Szene';",
      '// i18n-ignore-end',
      "const d = 'Szene';",
    ].join('\n');
    expect(scanFile({ path: 'a.ts', text }).map((finding) => finding.line)).toEqual([1, 6]);
  });

  it('computes the ignored lines', () => {
    expect([...ignoredLines('a\n// i18n-ignore: x\nb\nc')].sort()).toEqual([2, 3]);
  });
});

describe('scanFile: the --comments tier', () => {
  it('flags umlauts in comments and only notes guillemets', () => {
    const text = ['// Größe ändern', '/** «quoted» */', "const a = 'Gerät';"].join('\n');
    const findings = scanFile({ path: 'a.ts', text, comments: true });
    expect(findings).toMatchObject([
      { line: 1, rule: 'H1', severity: 'error' },
      { line: 2, rule: 'H2', severity: 'info' },
    ]);
  });

  it('does not look at scripts or templates', () => {
    expect(scanFile({ path: 'a.sh', text: '# Größe', comments: true })).toEqual([]);
  });
});

describe('scanFile: allowlist', () => {
  const allowlist = (rules: 'all' | string[]) => {
    const directory = mkdtempSync(join(tmpdir(), 'allow-'));
    writeFileSync(
      join(directory, 'x.json'),
      JSON.stringify([{ path: 'apps/**/*.ts', rules, reason: 'test' }]),
    );
    const entries = loadAllowlist(directory);
    rmSync(directory, { recursive: true });
    return entries;
  };

  it('skips a file entirely for "all"', () => {
    expect(
      scanFile({ path: 'apps/a/b.ts', text: "const a = 'Szene';", allowlist: allowlist('all') }),
    ).toEqual([]);
  });

  it('skips only the listed rules', () => {
    const findings = scanFile({
      path: 'apps/a/b.ts',
      text: "const a = 'Gerät';",
      allowlist: allowlist(['H1']),
    });
    expect(rulesOf(findings)).toEqual(['H4']);
  });

  it('marks the entry used', () => {
    const entries = allowlist('all');
    scanFile({ path: 'apps/a/b.ts', text: '', allowlist: entries });
    expect(entries[0]?.used).toBe(true);
  });
});

describe('file selection', () => {
  it('reads the listed extensions and special names', () => {
    for (const path of [
      'a.ts',
      'a.html',
      'a.scss',
      'a.css',
      'A.cs',
      'a.json',
      'a.sh',
      'a.ps1',
      'a.psm1',
      'a.yml',
      'a.yaml',
      'a.md',
      'a.webmanifest',
      'infra/caddy/Caddyfile',
      '.env.example',
    ]) {
      expect(isScanned(path), path).toBe(true);
    }
    for (const path of ['a.png', 'a.woff2', 'a.txt', 'a.lock']) {
      expect(isScanned(path), path).toBe(false);
    }
  });

  it('filters by path prefix', () => {
    const files = ['apps/a/x.ts', 'apps/ab/x.ts', 'README.md'];
    expect(filterPaths(files, ['apps/a'])).toEqual(['apps/a/x.ts']);
    expect(filterPaths(files, ['README.md'])).toEqual(['README.md']);
    expect(filterPaths(files, [])).toEqual(files);
  });

  it('lists the tracked files of a repository and walks a plain directory', () => {
    const directory = mkdtempSync(join(tmpdir(), 'scan-'));
    try {
      mkdirSync(join(directory, 'src'));
      mkdirSync(join(directory, 'node_modules'));
      writeFileSync(join(directory, 'src', 'a.ts'), '');
      writeFileSync(join(directory, 'node_modules', 'b.ts'), '');
      writeFileSync(join(directory, 'c.png'), '');
      expect(listFiles(directory)).toEqual(['src/a.ts']);
      execFileSync('git', ['init', '-q'], { cwd: directory });
      execFileSync('git', ['add', 'src/a.ts', 'c.png'], { cwd: directory });
      expect(listFiles(directory)).toEqual(['src/a.ts']);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
