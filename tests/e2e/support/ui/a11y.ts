import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * axe-core on a page (docs/testing.md E2E-A11Y: tags `wcag2a` and `wcag2aa`, 0 critical/serious violations; colour
 * contrast findings are reviewed one by one and listed, not silenced). The full result is attached to the test.
 */

export interface AxeViolationSummary {
  id: string;
  impact: string | null | undefined;
  help: string;
  nodes: number;
  targets: string[];
}

export interface AxeOptions {
  /** Only these regions (CSS selectors). */
  include?: string[];
  /** Skip these regions. */
  exclude?: string[];
  tags?: string[];
  /** Rules switched off, each with the reason: an accepted finding is written down, never hidden. */
  accepted?: Record<string, string>;
}

export interface AxeSummary {
  violations: AxeViolationSummary[];
  /** critical and serious ones, the ones that fail a test. */
  blocking: AxeViolationSummary[];
  passes: number;
  incomplete: number;
  url: string;
}

/** Runs axe on the page (default tags `wcag2a`, `wcag2aa`). */
export async function runAxe(page: Page, options: AxeOptions = {}): Promise<AxeSummary> {
  let builder = new AxeBuilder({ page }).withTags(options.tags ?? ['wcag2a', 'wcag2aa']);
  for (const selector of options.include ?? []) builder = builder.include(selector);
  for (const selector of options.exclude ?? []) builder = builder.exclude(selector);
  const accepted = Object.keys(options.accepted ?? {});
  if (accepted.length > 0) builder = builder.disableRules(accepted);
  const result = await builder.analyze();
  const violations = result.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    help: violation.help,
    nodes: violation.nodes.length,
    targets: violation.nodes.slice(0, 5).map((node) => node.target.join(' ')),
  }));
  return {
    violations,
    blocking: violations.filter(
      (violation) => violation.impact === 'critical' || violation.impact === 'serious',
    ),
    passes: result.passes.length,
    incomplete: result.incomplete.length,
    url: result.url,
  };
}

/**
 * Asserts that axe finds no critical or serious violation and attaches the summary (`axe-<label>.json`) to the test.
 * Returns the summary, so a test can also look at the minor and moderate findings.
 */
export async function expectNoSeriousViolations(
  page: Page,
  label: string,
  options: AxeOptions = {},
): Promise<AxeSummary> {
  const summary = await runAxe(page, options);
  await test.info().attach(`axe-${label}.json`, {
    body: JSON.stringify({ label, accepted: options.accepted ?? {}, ...summary }, null, 2),
    contentType: 'application/json',
  });
  expect(
    summary.blocking.map(
      (violation) =>
        `${violation.id} (${violation.impact}): ${violation.help} - ${violation.targets.join(', ')}`,
    ),
    `axe: critical/serious violations on ${label}`,
  ).toEqual([]);
  return summary;
}
