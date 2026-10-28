#!/usr/bin/env node
/**
 * Builds the standalone prototype: prototype/regie.html and prototype/fonts/*.woff2 become one self-contained
 * `studioflow-prototype.html` (fonts as base64 data URLs, the font licences embedded, a visible note that all data is
 * synthetic). The file works offline and needs no server; it is attached to every release (docs/releasing.md).
 *
 * Usage: node tools/build-prototype.mjs [--out FILE]      (default: dist/studioflow-prototype.html)
 *
 * Plain Node without dependencies, so the release workflow runs it on the GitHub runner as it is. The output is
 * deterministic: the same sources give the same bytes.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPrototypeFile } from './lib/prototype-files.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

const args = process.argv.slice(2);
let out = join(root, 'dist', 'studioflow-prototype.html');
if (args.length === 2 && args[0] === '--out') {
  out = resolve(args[1]);
} else if (args.length > 0) {
  console.error('Usage: node tools/build-prototype.mjs [--out FILE]');
  process.exit(2);
}

const html = buildPrototypeFile(root);

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, html);
console.log(`Wrote ${out} (${(Buffer.byteLength(html) / 1024).toFixed(0)} KiB).`);
