// Reads prototype/regie.html, the fonts it names and their licences from disk and builds the standalone file with
// prototype.mjs. Used by tools/build-prototype.mjs (release asset) and by the product site (site/vite.config.ts).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildPrototype } from './prototype.mjs';

/**
 * The self-hosted fonts in prototype/fonts and their licence texts. The Regie prototype uses the platform's UI font
 * like the Regie itself, so it names none of them today; a font that the page does name is embedded with its licence.
 * The product site uses the same files for its display headlines.
 */
const FONTS = [
  { name: 'Sofia Sans Semi Condensed', file: 'fonts/sofia-sans-semi-condensed-latin.woff2', license: 'fonts/OFL-SofiaSansSemiCondensed.txt' },
  { name: 'JetBrains Mono', file: 'fonts/jetbrains-mono-latin.woff2', license: 'fonts/OFL-JetBrainsMono.txt' },
];

/** The standalone prototype as a string; `root` is the repository root. */
export function buildPrototypeFile(root) {
  const source = join(root, 'prototype');
  const html = readFileSync(join(source, 'regie.html'), 'utf8');
  const readFont = (path) => {
    const file = join(source, path);
    return existsSync(file) ? readFileSync(file) : null;
  };
  const licenses = FONTS.filter(({ file }) => html.includes(file)).map(({ name, license }) => ({
    name,
    text: readFileSync(join(source, license), 'utf8'),
  }));
  return buildPrototype({ html, readFont, licenses });
}
