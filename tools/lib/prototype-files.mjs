// Reads prototype/regie.html, its fonts and the font licences from disk and builds the standalone file with prototype.mjs.
// Used by tools/build-prototype.mjs (release asset) and by the product site (site/vite.config.ts).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildPrototype } from './prototype.mjs';

/** The standalone prototype as a string; `root` is the repository root. */
export function buildPrototypeFile(root) {
  const source = join(root, 'prototype');
  const readFont = (path) => {
    const file = join(source, path);
    return existsSync(file) ? readFileSync(file) : null;
  };
  const licenses = [
    { name: 'Sofia Sans Semi Condensed', file: 'fonts/OFL-SofiaSansSemiCondensed.txt' },
    { name: 'JetBrains Mono', file: 'fonts/OFL-JetBrainsMono.txt' },
  ].map(({ name, file }) => ({ name, text: readFileSync(join(source, file), 'utf8') }));
  return buildPrototype({ html: readFileSync(join(source, 'regie.html'), 'utf8'), readFont, licenses });
}
