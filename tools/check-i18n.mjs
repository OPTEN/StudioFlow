#!/usr/bin/env node
/**
 * Checks the i18n rules of the repository (see docs/i18n.md):
 *   - catalogue files own exactly their prefix, keys are unique, German values are not copies of English ones;
 *   - number and date formatting only through @studioflow/i18n (no toFixed + replace, toLocale*String, Intl, Angular
 *     locale pipes) and no translated string at module scope (R1);
 *   - @studioflow/i18n/angular is imported by the Angular apps only; the framework-free entry never imports Angular;
 *   - keys nobody uses (warning).
 * The freshness of the generated indexes is checked by `tools/i18n-index.mjs --check`.
 * Known violations of a work package are listed in `tools/i18n-baseline/<package>.json` until it fixes them.
 * Exit codes: 0 clean (warnings allowed), 1 errors.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyBaseline,
  checkIdenticalValues,
  checkNamespaces,
  findBannedFormatting,
  findForbiddenImports,
  findModuleLevelT,
  findUnusedKeys,
  loadBaseline,
} from './lib/check-i18n.mjs';
import { loadCatalogues, sourceFiles } from './lib/catalogue-files.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const quiet = process.argv.includes('--quiet');

const catalogues = loadCatalogues(join(root, 'packages/i18n/src/messages'));
const files = sourceFiles(root, ['apps', 'packages']).filter(
  (path) => !path.includes('/generated/'),
);
const isSpec = (path) => /\.spec\.ts$/.test(path) || path.includes('/testing/');
const texts = new Map(files.map((path) => [path, readFileSync(join(root, path), 'utf8')]));

const findings = [...checkNamespaces(catalogues), ...checkIdenticalValues(catalogues)];
const baseline = loadBaseline(join(root, 'tools/i18n-baseline'));
const sourceFindings = [];
for (const [path, text] of texts) {
  if (!path.startsWith('packages/i18n/') && !isSpec(path)) {
    sourceFindings.push(...findBannedFormatting(path, text));
    if (path.endsWith('.ts')) {
      sourceFindings.push(...findModuleLevelT(path, text));
    }
  }
  sourceFindings.push(...findForbiddenImports(path, text));
}
findings.push(...applyBaseline(sourceFindings, baseline));
for (const entry of baseline.filter((candidate) => !candidate.used)) {
  findings.push({
    rule: 'baseline',
    file: `tools/i18n-baseline/${entry.file}`,
    line: 0,
    message: `entry covers nothing, remove it: ${entry.rule} ${entry.path}`,
  });
}

const usageSources = new Map(
  [...texts].filter(([path]) => !isSpec(path) && !path.startsWith('packages/i18n/')),
);
findings.push(...findUnusedKeys(catalogues, usageSources));

let errors = 0;
for (const finding of findings) {
  const warning = finding.severity === 'warning';
  if (!warning) {
    errors += 1;
  }
  if (!warning || !quiet) {
    const where = finding.line > 0 ? `${finding.file}:${finding.line}` : finding.file;
    console.log(`${warning ? 'warning' : 'error'}  ${finding.rule}  ${where}  ${finding.message}`);
  }
}
const warnings = findings.length - errors;
console.log(`check-i18n: ${errors} errors, ${warnings} warnings`);
process.exitCode = errors > 0 ? 1 : 0;
