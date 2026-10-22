import fs from 'node:fs';
import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { OUTPUT_DIR } from '../env';
import { isOpenBug } from './known-bug';

/**
 * axe-core scans of the a11y specs (docs/testing.md E2E-DEV-15, task: WCAG 2.1 AA). Every scan writes its full result
 * to `.output/<project>/a11y/axe/<label>.json`, attaches it to the test and appends one line to
 * `.output/<project>/a11y/axe-summary.jsonl` (violations by impact, for the report). The assertion is the plan's:
 * zero critical and zero serious violations; moderate and minor ones are reported, not asserted. A second,
 * informational pass over the `best-practice` rules (landmarks, heading order, ...) is attached as well.
 */

export const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
export const AXE_DIR = path.join(OUTPUT_DIR, 'a11y');

/**
 * Nodes of confirmed, still open product bugs. They are left out of the generic scans so that one finding does not
 * hide the next one; each has a dedicated test (marked with `knownBug`) that asserts the node passes. When the bug is
 * `fixed` in the registry the exclusion disappears and the generic scans cover the node again.
 */
export const KNOWN_BUG_EXCLUDES: Record<string, { selector: string; rule: string; why: string }> = {
  'A11Y-01': { selector: '[role=separator][tabindex]', rule: 'aria-required-attr', why: 'focusable separators (splitters) lack aria-valuenow' },
  'A11Y-02': { selector: '.c-tag--pgm', rule: 'color-contrast', why: 'PGM tag red on red wash is 4.32:1' },
  'A11Y-03': { selector: '.c-take__hint', rule: 'color-contrast', why: 'Take hint on the blue fill is 3.78:1' },
  'A11Y-06': { selector: '.c-status__target, button.c-scene, .c-src__select, .c-st__row', rule: 'label-content-name-mismatch', why: 'accessible names of rows and incident targets do not contain their visible text (WCAG 2.5.3)' },
  'A11Y-09': { selector: '.c-src-dock__list:not(:has([role=listitem]))', rule: 'aria-required-children', why: 'the Quellen list of an empty scene is role=list without a listitem (the empty note sits inside it)' },
  'A11Y-07': { selector: '.c-phone__dark-code, .c-phone__dark-hint', rule: 'color-contrast', why: 'dark mode of the phone sender: code 2.96:1, hint 2.35:1' },
};

export interface AxeNode {
  target: string;
  html: string;
  summary: string;
  data?: unknown;
}

export interface AxeViolation {
  id: string;
  impact: string;
  help: string;
  helpUrl: string;
  nodes: AxeNode[];
}

export interface ScanResult {
  label: string;
  url: string;
  violations: AxeViolation[];
  blocking: AxeViolation[];
  byImpact: Record<string, number>;
  passes: number;
  incomplete: string[];
  bestPractice: AxeViolation[];
  excluded: string[];
}

export interface ScanOptions {
  include?: string[];
  /** Further regions to skip (CSS selectors). */
  exclude?: string[];
  /** Skip the informational best-practice pass. */
  noBestPractice?: boolean;
  /** Do not exclude the nodes of open known bugs (the dedicated bug tests scan them). */
  includeKnownBugs?: boolean;
}

function summarize(violation: Awaited<ReturnType<AxeBuilder['analyze']>>['violations'][number]): AxeViolation {
  return {
    id: violation.id,
    impact: String(violation.impact ?? 'minor'),
    help: violation.help,
    helpUrl: violation.helpUrl,
    nodes: violation.nodes.map((node) => ({
      target: node.target.join(' '),
      html: node.html.slice(0, 200),
      summary: (node.failureSummary ?? '').replace(/\s+/g, ' ').slice(0, 300),
      data: node.any[0]?.data ?? node.all[0]?.data ?? node.none[0]?.data,
    })),
  };
}

/** Runs axe on the page in its current state. */
export async function scanAxe(page: Page, label: string, options: ScanOptions = {}): Promise<ScanResult> {
  const excluded: string[] = [];
  let builder = new AxeBuilder({ page }).withTags(AXE_TAGS);
  for (const selector of options.include ?? []) builder = builder.include(selector);
  for (const selector of options.exclude ?? []) builder = builder.exclude(selector);
  if (!options.includeKnownBugs) {
    for (const [id, entry] of Object.entries(KNOWN_BUG_EXCLUDES)) {
      if (!isOpenBug(id)) continue;
      builder = builder.exclude(entry.selector);
      excluded.push(`${id}: ${entry.selector} (${entry.rule})`);
    }
  }
  const result = await builder.analyze();
  const violations = result.violations.map(summarize);
  let bestPractice: AxeViolation[] = [];
  if (!options.noBestPractice) {
    let extra = new AxeBuilder({ page }).withTags(['best-practice']);
    for (const selector of options.include ?? []) extra = extra.include(selector);
    for (const selector of options.exclude ?? []) extra = extra.exclude(selector);
    bestPractice = (await extra.analyze()).violations.map(summarize);
  }
  const byImpact: Record<string, number> = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  for (const violation of violations) byImpact[violation.impact] = (byImpact[violation.impact] ?? 0) + violation.nodes.length;
  const scan: ScanResult = {
    label,
    url: result.url,
    violations,
    blocking: violations.filter((violation) => violation.impact === 'critical' || violation.impact === 'serious'),
    byImpact,
    passes: result.passes.length,
    incomplete: result.incomplete.map((entry) => entry.id),
    bestPractice,
    excluded,
  };
  fs.mkdirSync(path.join(AXE_DIR, 'axe'), { recursive: true });
  const safe = label.replace(/[^a-z0-9._-]+/gi, '-');
  fs.writeFileSync(path.join(AXE_DIR, 'axe', `${safe}.json`), JSON.stringify(scan, null, 2));
  fs.appendFileSync(
    path.join(AXE_DIR, 'axe-summary.jsonl'),
    `${JSON.stringify({ label, url: scan.url, byImpact, violations: violations.map((entry) => `${entry.id}(${entry.impact}) x${entry.nodes.length}`), bestPractice: bestPractice.map((entry) => `${entry.id}(${entry.impact}) x${entry.nodes.length}`), excluded })}\n`,
  );
  await test.info().attach(`axe-${safe}.json`, { body: JSON.stringify(scan, null, 2), contentType: 'application/json' });
  return scan;
}

function describeViolation(violation: AxeViolation): string {
  const nodes = violation.nodes
    .slice(0, 4)
    .map((node) => `${node.target}${node.data && typeof node.data === 'object' && 'contrastRatio' in node.data ? ` [${String((node.data as { contrastRatio: number }).contrastRatio)}:1]` : ''}`)
    .join(' | ');
  return `${violation.id} (${violation.impact}) x${violation.nodes.length}: ${violation.help} - ${nodes}`;
}

/** Scans and asserts zero critical/serious violations; returns the scan for further checks. */
export async function expectNoSeriousAxe(page: Page, label: string, options: ScanOptions = {}): Promise<ScanResult> {
  const scan = await scanAxe(page, label, options);
  expect(scan.blocking.map(describeViolation), `axe (WCAG 2.1 A/AA): critical/serious violations on ${label}`).toEqual([]);
  return scan;
}

/**
 * Collects several scans of one test (one per state of the page) and asserts at the end, so that a violation in one state
 * does not stop the scans of the others: the report lists every state that fails.
 */
export class Scanner {
  readonly scans: ScanResult[] = [];

  constructor(private readonly page: Page) {}

  async scan(label: string, options: ScanOptions = {}): Promise<ScanResult> {
    const scan = await scanAxe(this.page, label, options);
    this.scans.push(scan);
    return scan;
  }

  /** Zero critical and zero serious violations in every scan so far. */
  verify(): void {
    const blocking = this.scans.flatMap((scan) => scan.blocking.map((violation) => `${scan.label}: ${describeViolation(violation)}`));
    expect(blocking, `axe (WCAG 2.1 A/AA): critical/serious violations in ${this.scans.map((scan) => scan.label).join(', ')}`).toEqual([]);
  }
}
