// Turns prototype/regie.html and its fonts into one self-contained HTML file (tools/build-prototype.mjs).
// Pure functions: the caller reads the files, so the unit tests need no disk.

/** `url("fonts/name.woff2")` in the CSS of the prototype. */
const FONT_URL = /url\(\s*(["']?)(fonts\/[^"')\s]+\.woff2)\1\s*\)/g;

/** Id of the element that carries the licence texts of the fonts. */
export const LICENSES_ID = 'sf-font-licenses';

/** What the visible note says; the prototype menu says the same in its own words. */
export const NOTE_TEXT =
  'Prototype with synthetic data: all names, pictures and values are made up. Nothing is sent anywhere.';

/** Base64 data URLs instead of the font files; throws when the prototype names a font that is not there. */
export function inlineFonts(html, readFont) {
  const missing = [];
  const result = html.replace(FONT_URL, (match, _quote, path) => {
    const bytes = readFont(path);
    if (bytes === null || bytes === undefined) {
      missing.push(path);
      return match;
    }
    return `url("data:font/woff2;base64,${Buffer.from(bytes).toString('base64')}")`;
  });
  if (missing.length > 0) {
    throw new Error(`The prototype uses fonts that were not found: ${[...new Set(missing)].join(', ')}.`);
  }
  return result;
}

/**
 * References that would break the file when it is opened on its own: a relative `url(...)`, `src` or `href` that is
 * neither a data URL, an in-page anchor nor an absolute address. Returns the offending snippets.
 */
export function externalReferences(html) {
  const found = [];
  for (const match of html.matchAll(/url\(\s*(["']?)([^"')\s]+)\1\s*\)/g)) {
    if (!/^(data:|#)/.test(match[2])) found.push(match[0]);
  }
  for (const match of html.matchAll(/<(?:script|img|link|source|iframe)\b[^>]*?\b(?:src|href)\s*=\s*(["'])([^"']*)\1/gi)) {
    if (!/^(data:|#|https?:|mailto:|about:)/i.test(match[2]) && match[2] !== '') found.push(match[0]);
  }
  return found;
}

/** The licence texts as plain-text data inside the page (OFL: every copy of the fonts carries its licence). */
export function licenseBlock(licenses) {
  const body = licenses
    .map(({ name, text }) => `${name}\n${'='.repeat(name.length)}\n\n${text.trim()}\n`)
    .join('\n\n')
    .replaceAll('</script', '<\\/script');
  return `<script type="text/plain" id="${LICENSES_ID}">\n${body}</script>`;
}

/** Banner (fixed, dismissable) that says the data is synthetic. Own class names, so it cannot clash with the page. */
export function noteBlock() {
  return `<style>
.sf-proto-note { position: fixed; z-index: 2147483000; left: 50%; bottom: 8px; transform: translateX(-50%); display: flex; align-items: center; gap: 10px; max-width: calc(100vw - 16px); padding: 5px 6px 5px 14px; border: 1px solid #353d4a; border-radius: 16px; background: rgba(13, 17, 23, .94); color: #e6edf3; font: 600 12.5px/1.35 "Sofia Sans Semi Condensed", system-ui, sans-serif; box-shadow: 0 4px 18px rgba(0, 0, 0, .45); }
.sf-proto-note button { flex: none; border: 0; border-radius: 12px; padding: 3px 10px; background: #232a36; color: #e6edf3; font: inherit; cursor: pointer; }
.sf-proto-note button:hover { background: #353d4a; }
.sf-proto-note button:focus-visible { outline: 2px solid #79c0ff; outline-offset: 2px; }
.sf-proto-note[hidden] { display: none; }
</style>
<div class="sf-proto-note" id="sf-proto-note" role="note" lang="en"><span>${NOTE_TEXT}</span><button type="button" onclick="this.parentNode.hidden = true">Got it</button></div>`;
}

/** A comment right after the doctype that says what the file is. */
export function headerComment() {
  return `<!--
  StudioFlow clickable prototype (one file, works offline; fonts are embedded).
  Built by tools/build-prototype.mjs from prototype/regie.html and prototype/fonts/.
  All names, pictures and values in it are synthetic; it talks to no server.
  Licence: Apache-2.0 (https://www.apache.org/licenses/LICENSE-2.0). The fonts Sofia Sans Semi Condensed and JetBrains
  Mono are licensed under the SIL Open Font License 1.1; their texts are in the element #${LICENSES_ID} at the end of
  the page.
-->`;
}

/**
 * The standalone file: fonts inlined, note and licences added, doctype kept first. Deterministic: the same input gives
 * the same bytes (the release checksum does not depend on the build time).
 */
export function buildPrototype({ html, readFont, licenses }) {
  const inlined = inlineFonts(html, readFont);
  const problems = externalReferences(inlined);
  if (problems.length > 0) {
    throw new Error(`The prototype refers to files that the single file does not contain: ${problems.join(' ')}`);
  }
  const end = inlined.toLowerCase().lastIndexOf('</body>');
  if (end < 0) throw new Error('The prototype has no </body>.');
  if (!/^\s*<!doctype html>/i.test(inlined)) throw new Error('The prototype does not start with <!doctype html>.');
  // Function replacers: the texts contain "$" characters that a replacement string would interpret.
  const withComment = inlined.replace(/^(\s*<!doctype html>)/i, (doctype) => `${doctype}\n${headerComment()}`);
  const withTitle = withComment.replace(
    '<title>StudioFlow control room</title>',
    () => '<title>StudioFlow control room (prototype)</title>',
  );
  const close = withTitle.toLowerCase().lastIndexOf('</body>');
  return `${withTitle.slice(0, close)}${noteBlock()}\n${licenseBlock(licenses)}\n${withTitle.slice(close)}`;
}
