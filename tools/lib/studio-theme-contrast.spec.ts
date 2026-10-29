import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { compile } from 'sass';

/**
 * WCAG 2.x contrast of the Regie's colour tokens, read from the CSS that apps/studio/src/styles.scss compiles to.
 * Also checks that the browser chrome colour (<meta name="theme-color">) is the Panel token of each theme.
 */

type Rgb = readonly [number, number, number];
interface Colour {
  readonly rgb: Rgb;
  readonly alpha: number;
}
type Tokens = ReadonlyMap<string, Colour>;

const SURFACES = ['ground', 'panel', 'raised', 'raised-2', 'float'] as const;
/** Where a form field with its own edge sits (dock bodies, the link box, popovers); the edge must stand out from these. */
const FIELD_SURFACES = ['ground', 'panel', 'float'] as const;
const STATE_HUES = ['blue', 'green', 'red', 'amber'] as const;
const WASHED_TEXT = ['red', 'amber', 'green', 'blue'] as const;
const AA_TEXT = 4.5;
const AA_COMPONENT = 3;

function parseColour(value: string): Colour | null {
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  if (hex?.[1]) {
    const n = parseInt(hex[1], 16);
    return { rgb: [(n >> 16) & 255, (n >> 8) & 255, n & 255], alpha: 1 };
  }
  const rgba = /^rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\s*\)$/.exec(value);
  if (rgba) {
    return {
      rgb: [Number(rgba[1]), Number(rgba[2]), Number(rgba[3])],
      alpha: rgba[4] === undefined ? 1 : Number(rgba[4]),
    };
  }
  return null;
}

/** Custom properties of every rule whose selector is exactly `selector`, later declarations winning. */
function customProperties(css: string, selector: string): Map<string, string> {
  const properties = new Map<string, string>();
  const rule = new RegExp(`(?:^|\\})\\s*${selector.replace(/[[\]]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 'g');
  for (const block of css.matchAll(rule)) {
    for (const declaration of (block[1] ?? '').matchAll(/--([\w-]+):\s*([^;]+);/g)) {
      properties.set(declaration[1] ?? '', (declaration[2] ?? '').trim());
    }
  }
  return properties;
}

function colours(properties: ReadonlyMap<string, string>): Map<string, Colour> {
  const result = new Map<string, Colour>();
  for (const [name, value] of properties) {
    const colour = parseColour(value);
    if (colour) {
      result.set(name, colour);
    }
  }
  return result;
}

function isPictureToken(name: string): boolean {
  return name === 'well' || name.startsWith('slot') || name.startsWith('pic-');
}

/** The section tiles of the settings sidebar: one hue per section, the same in both themes, under a white glyph. */
function isTileToken(name: string): boolean {
  return name.startsWith('tile-');
}

const css = compile('apps/studio/src/styles.scss', { loadPaths: ['apps/studio/src/styles'] }).css;
const darkProperties = customProperties(css, ':root');
const lightProperties = customProperties(css, ':root[data-theme=light]');
const dark: Tokens = colours(darkProperties);
const light: Tokens = new Map([...dark, ...colours(lightProperties)]);

function token(tokens: Tokens, name: string): Colour {
  const colour = tokens.get(name);
  if (!colour) {
    throw new Error(`token --${name} is not a colour in the compiled CSS`);
  }
  return colour;
}

/** `foreground` laid over `background`; opaque backgrounds only. */
function composite(foreground: Colour, background: Colour): Colour {
  const rgb = foreground.rgb.map((channel, index) =>
    Math.round(channel * foreground.alpha + background.rgb[index]! * (1 - foreground.alpha)),
  );
  return { rgb: rgb as unknown as Rgb, alpha: 1 };
}

function luminance({ rgb }: Colour): number {
  const [red, green, blue] = rgb.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(a: Colour, b: Colour): number {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (lighter + 0.05) / (darker + 0.05);
}

function expectContrast(
  foreground: Colour,
  background: Colour,
  minimum: number,
  what: string,
): void {
  expect(contrast(foreground, background), what).toBeGreaterThanOrEqual(minimum);
}

describe.each([
  ['dark', dark],
  ['light', light],
] as const)('the %s theme', (_name, tokens) => {
  const colour = (name: string): Colour => token(tokens, name);

  it.each(['text', 'text-2', 'muted'])('keeps %s readable on every surface (4.5:1)', (name) => {
    for (const surface of SURFACES) {
      expectContrast(colour(name), colour(surface), AA_TEXT, `${name} on ${surface}`);
    }
  });

  it.each([...STATE_HUES, 'violet'])('keeps the %s text readable on its surfaces (4.5:1)', (name) => {
    for (const surface of SURFACES) {
      expectContrast(colour(name), colour(surface), AA_TEXT, `${name} on ${surface}`);
    }
  });

  it.each(WASHED_TEXT)('keeps text and the %s hue readable on the %s wash (4.5:1)', (name) => {
    const wash = composite(colour(`${name}-wash`), colour('panel'));
    expectContrast(colour('text'), wash, AA_TEXT, `text on ${name}-wash`);
    expectContrast(colour('muted'), wash, AA_TEXT, `muted on ${name}-wash`);
    expectContrast(colour(name), wash, AA_TEXT, `${name} on ${name}-wash`);
  });

  // The Live tag is a filled red capsule (the brightest mark on screen, DESIGN.md "Only the live path burns").
  it('keeps the Live tag readable (on-state on red, 4.5:1)', () => {
    expectContrast(colour('on-state'), colour('red'), AA_TEXT, 'Live tag');
  });

  it('keeps the green Preview tag readable on its row (4.5:1)', () => {
    const wash = colour('green-wash');
    // The current scene row is Raised, and the tag adds its own wash to it.
    const currentRow = composite(wash, colour('raised'));
    expectContrast(colour('green'), currentRow, AA_TEXT, 'green tag on the current row');
    // A station row in the same state has the wash too, and the tag adds a second one.
    const stateRow = composite(wash, colour('panel'));
    expectContrast(colour('green'), composite(wash, stateRow), AA_TEXT, 'green tag on a green row');
  });

  it('keeps lamps, tally outlines and the focus ring visible on the surfaces (3:1)', () => {
    for (const hue of STATE_HUES) {
      for (const surface of SURFACES) {
        expectContrast(colour(hue), colour(surface), AA_COMPONENT, `${hue} on ${surface}`);
      }
    }
  });

  // Buttons, segmented controls, tabs, popovers and separators keep the quieter Strong Seam: a text label or a fill
  // identifies them (WCAG 1.4.11 asks for the boundary only where it is the sole indicator).
  it('draws the edge of text fields, selects, number fields and the switch track at 3:1 (WCAG 1.4.11)', () => {
    for (const surface of FIELD_SURFACES) {
      expectContrast(colour('control-edge'), colour(surface), AA_COMPONENT, `control-edge on ${surface}`);
    }
  });

  it('keeps the Take hint (on-fill on the blue fill and its hover) readable (4.5:1)', () => {
    expectContrast(colour('on-fill'), colour('blue-fill'), AA_TEXT, 'Take hint on blue-fill');
    expectContrast(colour('on-fill'), colour('blue-fill-hover'), AA_TEXT, 'Take hint on blue-fill-hover');
  });

  it('keeps white text readable on the blue fill and its hover (4.5:1)', () => {
    expectContrast(colour('on-fill'), colour('blue-fill'), AA_TEXT, 'on-fill on blue-fill');
    expectContrast(colour('on-fill'), colour('blue-fill-hover'), AA_TEXT, 'on-fill on hover');
  });

  it('keeps the text on green and red fills readable (4.5:1)', () => {
    expectContrast(colour('on-state'), colour('green'), AA_TEXT, 'on-state on green');
    expectContrast(colour('on-state'), colour('green-hover'), AA_TEXT, 'on-state on green-hover');
    expectContrast(colour('on-state'), colour('red'), AA_TEXT, 'on-state on red');
  });

  it('keeps the white glyph of every settings tile visible (3:1)', () => {
    const white: Colour = { rgb: [255, 255, 255], alpha: 1 };
    for (const name of [...tokens.keys()].filter(isTileToken)) {
      expectContrast(white, colour(name), AA_COMPONENT, `glyph on ${name}`);
    }
  });

  it('keeps the picture surfaces near black with readable ink on them', () => {
    const well = colour('well');
    expect(luminance(well)).toBeLessThan(0.01);
    const scrim = composite(colour('pic-scrim'), well);
    for (const name of ['pic-text', 'pic-text-2', 'pic-muted']) {
      expectContrast(colour(name), well, AA_TEXT, `${name} on well`);
      expectContrast(colour(name), scrim, AA_TEXT, `${name} on pic-scrim`);
    }
    for (const name of ['pic-blue', 'pic-red', 'pic-amber']) {
      expectContrast(colour(name), well, AA_COMPONENT, `${name} on well`);
    }
    expectContrast(colour('pic-ink'), colour('pic-blue'), AA_TEXT, 'pic-ink on pic-blue');
  });
});

function hex({ rgb }: Colour): string {
  return `#${rgb.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

describe('the browser chrome colour', () => {
  const service = readFileSync('apps/studio/src/app/core/ui/theme.service.ts', 'utf8');
  const initScript = readFileSync('apps/studio/public/theme-init.js', 'utf8');
  const index = readFileSync('apps/studio/src/index.html', 'utf8');

  /** Runs public/theme-init.js against a stand-in for the page; returns the colour it leaves in the meta tag. */
  function chromeAfterInit(stored: string | null, systemLight: boolean): string {
    const meta = { content: '', setAttribute: (_name: string, value: string) => void (meta.content = value) };
    const page = {
      documentElement: { dataset: {} },
      querySelector: (selector: string) => (selector === 'meta[name="theme-color"]' ? meta : null),
    };
    runInNewContext(initScript, {
      document: page,
      localStorage: { getItem: () => stored },
      matchMedia: () => ({ matches: systemLight }),
    });
    return meta.content;
  }

  it.each([
    ['dark', dark],
    ['light', light],
  ] as const)('is the Panel colour of the %s theme in ThemeService', (name, tokens) => {
    expect(service).toContain(`${name}: '${hex(token(tokens, 'panel'))}'`);
  });

  it('is the Panel colour of the dark theme in index.html, before any script ran', () => {
    expect(index).toContain(`<meta name="theme-color" content="${hex(token(dark, 'panel'))}" />`);
  });

  it.each([
    [null, false, hex(token(dark, 'panel'))],
    ['dark', true, hex(token(dark, 'panel'))],
    ['light', false, hex(token(light, 'panel'))],
    ['system', true, hex(token(light, 'panel'))],
    ['system', false, hex(token(dark, 'panel'))],
    ['sepia', true, hex(token(dark, 'panel'))],
  ] as const)('is set by theme-init.js for the stored setting %s (system light: %s) to %s', (stored, systemLight, expected) => {
    expect(chromeAfterInit(stored, systemLight)).toBe(expected);
  });
});

describe('the light theme', () => {
  it('defines every themed colour of the dark theme, and none of the picture surfaces', () => {
    const themed = [...dark.keys()].filter((name) => !isPictureToken(name) && !isTileToken(name));
    expect(themed.length).toBeGreaterThan(20);
    const overridden = new Set(lightProperties.keys());
    expect(themed.filter((name) => !overridden.has(name))).toEqual([]);
    expect([...overridden].filter(isPictureToken)).toEqual([]);
    expect([...overridden].filter(isTileToken)).toEqual([]);
  });

  it('declares the colour scheme of the theme', () => {
    expect(css).toMatch(/:root\s*\{[^}]*color-scheme:\s*dark/);
    expect(css).toMatch(/:root\[data-theme=light\]\s*\{[^}]*color-scheme:\s*light/);
  });
});
