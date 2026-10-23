#!/usr/bin/env node
/**
 * Regenerates `packages/i18n/src/messages/<locale>/index.ts` from the catalogue files next to it, so nobody edits an
 * aggregation list by hand. `--check` only verifies (exit 1 when an index is missing, stale or damaged by a merge, or
 * when the locales do not have the same files).
 */
import { fileURLToPath } from 'node:url';
import { syncIndexes } from './lib/catalogue-index.mjs';

const messages = fileURLToPath(new URL('../packages/i18n/src/messages', import.meta.url));
const check = process.argv.includes('--check');

const { problems, written } = syncIndexes(messages, { check });
for (const problem of problems) {
  console.error(`i18n-index: ${problem}`);
}
if (problems.length > 0) {
  process.exit(1);
}
if (!check) {
  console.log(
    written.length > 0 ? `i18n-index: wrote ${written.join(', ')}` : 'i18n-index: up to date',
  );
}
