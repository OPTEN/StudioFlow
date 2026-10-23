import {
  applyBaseline,
  checkIdenticalValues,
  checkNamespaces,
  findBannedFormatting,
  findForbiddenImports,
  findModuleLevelT,
  findUnusedKeys,
  loadBaseline,
} from './check-i18n.mjs';
import { globToRegExp } from './allowlist.mjs';

type Catalogues = Parameters<typeof checkNamespaces>[0];

function catalogues(
  en: Record<string, Record<string, unknown>>,
  de: Record<string, Record<string, unknown>> = en,
): Catalogues {
  const build = (data: Record<string, Record<string, unknown>>) =>
    new Map(
      Object.entries(data).map(([name, messages]) => [
        name,
        { prefix: name.replaceAll('-', '.'), messages, file: `messages/x/${name}.ts` },
      ]),
    );
  return new Map([
    ['en', build(en)],
    ['de-CH', build(de)],
  ]) as Catalogues;
}

describe('checkNamespaces', () => {
  it('accepts keys inside the prefix of their file', () => {
    expect(
      checkNamespaces(
        catalogues({
          'regie-scenes': { 'regie.scenes.title': 'A' },
          common: { 'common.ok': 'OK' },
        }),
      ),
    ).toEqual([]);
  });

  it('rejects a key outside the prefix', () => {
    const findings = checkNamespaces(
      catalogues({ 'regie-scenes': { 'regie.sources.title': 'A' } }),
    );
    expect(findings.map((finding) => finding.rule)).toContain('prefix');
  });

  it('rejects a key defined in two files', () => {
    const findings = checkNamespaces(
      catalogues({ common: { 'common.ok': 'OK' }, 'common-more': { 'common.ok': 'OK' } }),
    );
    expect(findings.map((finding) => finding.rule)).toContain('duplicate');
  });

  it('warns about keys with more than four segments', () => {
    const findings = checkNamespaces(catalogues({ common: { 'common.a.b.c.d': 'x' } }));
    expect(findings).toMatchObject([{ rule: 'depth', severity: 'warning' }]);
  });
});

describe('checkIdenticalValues', () => {
  it('warns when German equals English, except for symbols, units and loan words', () => {
    const en = {
      common: {
        'common.a': 'Please wait',
        'common.b': 'Output',
        'common.c': '{value} min',
        'common.d': '2 × 2',
        'common.e': { one: 'Same one', other: 'Same other' },
      },
    };
    const findings = checkIdenticalValues(catalogues(en));
    expect(findings.map((finding) => finding.message)).toEqual([
      expect.stringContaining('common.a'),
      expect.stringContaining('common.e (one)'),
      expect.stringContaining('common.e (other)'),
    ]);
    expect(findings.every((finding) => finding.severity === 'warning')).toBe(true);
  });

  it('is quiet for translated values', () => {
    expect(
      checkIdenticalValues(
        catalogues({ common: { 'common.a': 'Wait' } }, { common: { 'common.a': 'Warten' } }),
      ),
    ).toEqual([]);
  });
});

describe('findBannedFormatting', () => {
  it.each([
    ["const text = value.toFixed(1).replace('.', ',');", 1],
    ['date.toLocaleDateString("de-CH")', 1],
    ['value.toLocaleTimeString()', 1],
    ['value.toLocaleString("de-CH")', 1],
    ["new Intl.Collator('de-CH')", 1],
    ['Intl.NumberFormat("en")', 1],
    ["import { DatePipe } from '@angular/common';", 1],
    ["registerLocaleData(localeDe, 'de-CH');", 1],
    ["{ provide: LOCALE_ID, useValue: 'de-CH' }", 1],
    ['const px = `${(fraction * 100).toFixed(2)}%`;', 0],
    ['// new Intl.Collator() would be wrong here', 0],
    ['const intlShort = formatNumber(x);', 0],
  ])('%s → %s finding(s)', (line, count) => {
    expect(findBannedFormatting('apps/x/y.ts', line)).toHaveLength(count);
  });

  it('flags Angular pipes in templates only', () => {
    expect(findBannedFormatting('apps/x/y.html', '<p>{{ value | date }}</p>')).toHaveLength(1);
    expect(
      findBannedFormatting('apps/x/y.html', '<p>{{ value | number: "1.0-2" }}</p>'),
    ).toHaveLength(1);
    expect(findBannedFormatting('apps/x/y.html', '<p>{{ a || b }}</p>')).toHaveLength(0);
    expect(findBannedFormatting('apps/x/y.html', '<!-- {{ value | date }} -->')).toHaveLength(0);
  });
});

describe('findModuleLevelT', () => {
  it('flags a translated string at module scope', () => {
    expect(findModuleLevelT('a.ts', "const TITLE = t('common.ok');")).toHaveLength(1);
    expect(findModuleLevelT('a.ts', "export const TITLE: string = t('common.ok');")).toHaveLength(
      1,
    );
    expect(findModuleLevelT('a.ts', "const english = tFor('en')('common.ok');")).toHaveLength(0);
  });

  it('allows t() inside functions and classes', () => {
    expect(
      findModuleLevelT('a.ts', "function f() {\n  const title = t('common.ok');\n}"),
    ).toHaveLength(0);
    expect(findModuleLevelT('a.ts', 'class A {\n  protected readonly t = t;\n}')).toHaveLength(0);
  });
});

describe('findForbiddenImports', () => {
  const line = "import { injectI18n } from '@studioflow/i18n/angular';";

  it('lets only the Angular apps import the Angular glue', () => {
    expect(findForbiddenImports('apps/studio/src/a.ts', line)).toEqual([]);
    expect(findForbiddenImports('apps/sender/src/a.ts', line)).toEqual([]);
    expect(findForbiddenImports('apps/output/src/a.ts', line)).toHaveLength(1);
    expect(findForbiddenImports('packages/media-client/src/a.ts', line)).toHaveLength(1);
  });

  it('keeps Angular out of the framework-free entry', () => {
    const angular = "import { signal } from '@angular/core';";
    expect(findForbiddenImports('packages/i18n/src/store.ts', angular)).toHaveLength(1);
    expect(findForbiddenImports('packages/i18n/src/angular.ts', angular)).toEqual([]);
    expect(findForbiddenImports('packages/i18n/src/angular.spec.ts', angular)).toEqual([]);
  });
});

describe('findUnusedKeys', () => {
  it('reports keys no file mentions, literally or through a template literal prefix', () => {
    const sources = new Map([
      ['a.ts', "t('common.ok'); t(`errors.code.${code}`);"],
      ['b.html', '{{ t("common.save") }}'],
    ]);
    const data = catalogues({
      common: { 'common.ok': 'a', 'common.save': 'b', 'common.cancel': 'c' },
      errors: { 'errors.code.a': 'x', 'errors.status.b': 'y' },
    });
    expect(findUnusedKeys(data, sources).map((finding) => finding.message)).toEqual([
      expect.stringContaining('common.cancel'),
      expect.stringContaining('errors.status.b'),
    ]);
  });
});

describe('baseline', () => {
  const entry = (path: string, rule: string) => ({
    path,
    rule,
    file: 'p.json',
    matcher: globToRegExp(path),
    used: false,
  });

  it('hides covered findings and marks the entry used', () => {
    const baseline = [entry('apps/a/**', 'banned-format'), entry('apps/never', 'banned-format')];
    const findings = [
      { rule: 'banned-format', file: 'apps/a/x.ts', line: 1, message: '' },
      { rule: 'module-t', file: 'apps/a/x.ts', line: 2, message: '' },
    ];
    expect(applyBaseline(findings, baseline)).toEqual([findings[1]]);
    expect(baseline.map((candidate) => candidate.used)).toEqual([true, false]);
  });

  it('reads the baseline directory of the repository', () => {
    const entries = loadBaseline(`${process.cwd()}/tools/i18n-baseline`);
    // The baseline is empty once every banned construct is fixed; whatever is listed must be complete.
    expect(entries.every((candidate) => candidate.rule && candidate.path && candidate.reason)).toBe(
      true,
    );
  });
});
