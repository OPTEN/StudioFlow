// Turns prototype/regie.html (and any font it names) into one self-contained HTML file (tools/build-prototype.mjs).
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
.sf-proto-note { position: fixed; z-index: 55; left: 50%; bottom: 8px; transform: translateX(-50%); display: flex; align-items: center; gap: 10px; max-width: calc(100vw - 16px); padding: 5px 5px 5px 14px; border-radius: 999px; background: rgba(42, 42, 46, .96); color: #f5f5f7; font: 500 12.5px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, Roboto, sans-serif; box-shadow: 0 12px 32px rgba(0, 0, 0, .42), 0 2px 6px rgba(0, 0, 0, .28), 0 0 0 .5px rgba(255, 255, 255, .1); }
.sf-proto-note button { flex: none; border: 0; border-radius: 999px; padding: 4px 11px; background: rgba(120, 120, 128, .32); color: #f5f5f7; font: inherit; font-weight: 600; cursor: pointer; }
.sf-proto-note button:hover { background: rgba(120, 120, 128, .45); }
.sf-proto-note button:focus-visible { outline: 2px solid #5aa9ff; outline-offset: 2px; }
.sf-proto-note[hidden] { display: none; }
</style>
<div class="sf-proto-note" id="sf-proto-note" role="note" lang="en"><span>${NOTE_TEXT}</span><button type="button" onclick="this.parentNode.hidden = true">Got it</button></div>`;
}

/** A comment right after the doctype that says what the file is; it names the embedded fonts, if there are any. */
export function headerComment(licenses = []) {
  const names = licenses.map(({ name }) => name);
  const fonts =
    names.length === 0
      ? '  It uses the system fonts of the device, like the control room itself.'
      : `  The fonts ${names.join(' and ')} are embedded and licensed under the SIL Open Font License 1.1;\n  their texts are in the element #${LICENSES_ID} at the end of the page.`;
  return `<!--
  StudioFlow clickable prototype (one file, works offline).
  Built by tools/build-prototype.mjs from prototype/regie.html.
  All names, pictures and values in it are synthetic; it talks to no server.
  Licence: MIT (https://opensource.org/license/mit).
${fonts}
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
  const withComment = inlined.replace(/^(\s*<!doctype html>)/i, (doctype) => `${doctype}\n${headerComment(licenses)}`);
  const withTitle = withComment.replace(
    '<title>StudioFlow control room</title>',
    () => '<title>StudioFlow control room (prototype)</title>',
  );
  const close = withTitle.toLowerCase().lastIndexOf('</body>');
  const fonts = licenses.length > 0 ? `${licenseBlock(licenses)}\n` : '';
  return `${withTitle.slice(0, close)}${noteBlock()}\n${fonts}${withTitle.slice(close)}`;
}
