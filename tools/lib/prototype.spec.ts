import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LICENSES_ID,
  NOTE_TEXT,
  buildPrototype,
  externalReferences,
  inlineFonts,
  licenseBlock,
} from './prototype.mjs';

const FONT = new Uint8Array([0x77, 0x4f, 0x46, 0x32, 0x00, 0xff]);
const FONT_BASE64 = Buffer.from(FONT).toString('base64');
const readFont = (path: string): Uint8Array | null => (path === 'fonts/a.woff2' ? FONT : null);

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>StudioFlow control room</title>
<style>
@font-face { font-family: "A"; src: url("fonts/a.woff2") format("woff2"); }
@font-face { font-family: "B"; src: url('fonts/a.woff2') format("woff2"); }
.x { background: url(data:image/png;base64,AAAA); }
</style>
</head>
<body>
<svg><use href="#i-grip"/></svg>
<p>price: $& and $1</p>
</body>
</html>
`;
const LICENSES = [{ name: 'Font A', text: 'Copyright 2020 A\nlicensed under the OFL' }];

describe('inlineFonts', () => {
  it('replaces every font url by a data URL, whatever the quotes', () => {
    const result = inlineFonts(PAGE, readFont);
    expect(result).not.toContain('fonts/a.woff2');
    expect(result.split(`url("data:font/woff2;base64,${FONT_BASE64}")`)).toHaveLength(3);
  });

  it('names a font that is missing instead of writing a broken file', () => {
    expect(() => inlineFonts(PAGE.replace('fonts/a.woff2', 'fonts/missing.woff2'), readFont)).toThrow(
      /fonts\/missing\.woff2/,
    );
  });
});

describe('externalReferences', () => {
  it('accepts data URLs, anchors and absolute links', () => {
    const html = `<style>a{background:url(data:image/png;base64,AA)} b{filter:url(#blur)}</style>
      <use href="#icon"/><a href="https://example.com/x">x</a><img src="data:image/gif;base64,R0lGOD">`;
    expect(externalReferences(html)).toEqual([]);
  });

  it('finds relative files that the single file would lose', () => {
    const html = `<style>@font-face{src:url("fonts/a.woff2")}</style><img src="pic.png"><script src="app.js"></script><link rel="stylesheet" href="x.css">`;
    expect(externalReferences(html)).toEqual([
      'url("fonts/a.woff2")',
      '<img src="pic.png"',
      '<script src="app.js"',
      '<link rel="stylesheet" href="x.css"',
    ]);
  });
});

describe('licenseBlock', () => {
  it('keeps the texts as plain data and cannot be closed from inside', () => {
    const block = licenseBlock([{ name: 'X', text: 'evil </script><b>x</b>' }]);
    expect(block.startsWith(`<script type="text/plain" id="${LICENSES_ID}">`)).toBe(true);
    expect(block.match(/<\/script/g)).toHaveLength(1);
  });
});

describe('buildPrototype', () => {
  const build = (): string => buildPrototype({ html: PAGE, readFont, licenses: LICENSES });

  it('is one self-contained page with the note and the licences', () => {
    const html = build();
    expect(html.startsWith('<!doctype html>\n<!--')).toBe(true);
    expect(externalReferences(html)).toEqual([]);
    expect(html).toContain('<title>StudioFlow control room (prototype)</title>');
    expect(html).toContain(NOTE_TEXT);
    expect(html).toContain('Copyright 2020 A');
    expect(html.indexOf('sf-proto-note')).toBeGreaterThan(html.indexOf('<p>price'));
    expect(html.trimEnd().endsWith('</body>\n</html>')).toBe(true);
  });

  it('does not interpret dollar signs of the page or of the texts', () => {
    expect(build()).toContain('<p>price: $& and $1</p>');
    const dollar = buildPrototype({
      html: PAGE,
      readFont,
      licenses: [{ name: 'D', text: 'costs $& and $` and $\'' }],
    });
    expect(dollar).toContain("costs $& and $` and $'");
  });

  it('gives the same bytes every time', () => {
    expect(build()).toBe(build());
  });

  it('refuses a page it cannot finish', () => {
    expect(() => buildPrototype({ html: PAGE.replace('</body>', ''), readFont, licenses: LICENSES })).toThrow(/<\/body>/);
    expect(() => buildPrototype({ html: PAGE.replace('<!doctype html>', ''), readFont, licenses: LICENSES })).toThrow(
      /doctype/,
    );
    expect(() =>
      buildPrototype({ html: PAGE.replace('</body>', '<img src="x.png"></body>'), readFont, licenses: LICENSES }),
    ).toThrow(/x\.png/);
  });
});

describe('tools/build-prototype.mjs', () => {
  it('builds the real prototype into one file without references to other files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sf-prototype-'));
    try {
      const out = join(dir, 'studioflow-prototype.html');
      const script = fileURLToPath(new URL('../build-prototype.mjs', import.meta.url));
      execFileSync(process.execPath, [script, '--out', out], { stdio: 'pipe' });
      const html = readFileSync(out, 'utf8');
      expect(externalReferences(html)).toEqual([]);
      expect(html).not.toMatch(/url\("fonts\//);
      expect(html.match(/url\("data:font\/woff2;base64,/g)).toHaveLength(2);
      expect(html).toContain('Sofia Sans Semi Condensed');
      expect(html).toContain('JetBrains Mono');
      expect(html).toContain(NOTE_TEXT);
      expect(html).toContain('SIL OPEN FONT LICENSE Version 1.1');
      expect(html.length).toBeGreaterThan(150_000);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('shows how to use it for an unknown argument', () => {
    const script = fileURLToPath(new URL('../build-prototype.mjs', import.meta.url));
    expect(() => execFileSync(process.execPath, [script, '--bad'], { stdio: 'pipe' })).toThrow(/Usage/);
  });
});
