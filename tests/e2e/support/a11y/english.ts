import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { TextItem } from './german';

/**
 * English text audit (docs/testing.md E2E-DEV-17): the texts of a page in `en-US` must contain no German. The
 * detection is the one of `npm run check:german` (`tools/lib/german.mjs`), loaded once as an ES module.
 */

interface GermanDetector {
  analyzeLine(line: string): Array<{ rule: string; detail: string }>;
}

let detector: Promise<GermanDetector> | undefined;

function loadDetector(): Promise<GermanDetector> {
  detector ??= import(pathToFileURL(path.resolve(__dirname, '../../../../tools/lib/german.mjs')).href);
  return detector;
}

/** The texts that look German, as `[kind] "text" (rule detail)`; empty when the page is clean. */
export async function findGerman(items: TextItem[]): Promise<string[]> {
  const { analyzeLine } = await loadDetector();
  return items.flatMap((item) =>
    analyzeLine(item.text).map((hit) => `[${item.kind}] “${item.text.slice(0, 120)}” (${hit.rule} ${hit.detail}) on ${item.where}`),
  );
}
