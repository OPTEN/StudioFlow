import { compile } from 'sass';

/** WCAG 2.x contrast of the Regie's colour tokens, read from the CSS that apps/studio/src/styles.scss compiles to. */

type Rgb = readonly [number, number, number];
interface Colour {
  readonly rgb: Rgb;
  readonly alpha: number;
}
type Tokens = ReadonlyMap<string, Colour>;

const SURFACES = ['ground', 'panel', 'raised', 'raised-2', 'float'] as const;
/** Where state hues appear as text: not on Raised Higher, which only holds chips, pressed buttons and the toast. */
const HUE_SURFACES = ['ground', 'panel', 'raised', 'float'] as const;
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
    for (const surface of HUE_SURFACES) {
      expectContrast(colour(name), colour(surface), AA_TEXT, `${name} on ${surface}`);
    }
  });

  it.each(WASHED_TEXT)('keeps text and the %s hue readable on the %s wash (4.5:1)', (name) => {
    const wash = composite(colour(`${name}-wash`), colour('panel'));
    expectContrast(colour('text'), wash, AA_TEXT, `text on ${name}-wash`);
    expectContrast(colour('muted'), wash, AA_TEXT, `muted on ${name}-wash`);
    expectContrast(colour(name), wash, AA_TEXT, `${name} on ${name}-wash`);
  });

  it('keeps lamps, tally outlines and the focus ring visible on the surfaces (3:1)', () => {
    for (const hue of STATE_HUES) {
      for (const surface of ['panel', 'ground', 'raised'] as const) {
        expectContrast(colour(hue), colour(surface), AA_COMPONENT, `${hue} on ${surface}`);
      }
    }
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

describe('the light theme', () => {
  it('draws the borders of controls at 3:1 against the surfaces they sit on', () => {
    for (const surface of ['panel', 'ground'] as const) {
      expectContrast(token(light, 'seam-strong'), token(light, surface), AA_COMPONENT, surface);
    }
  });

  it('defines every themed colour of the dark theme, and none of the picture surfaces', () => {
    const themed = [...dark.keys()].filter((name) => !isPictureToken(name));
    expect(themed.length).toBeGreaterThan(20);
    const overridden = new Set(lightProperties.keys());
    expect(themed.filter((name) => !overridden.has(name))).toEqual([]);
    expect([...overridden].filter(isPictureToken)).toEqual([]);
  });

  it('declares the colour scheme of the theme', () => {
    expect(css).toMatch(/:root\s*\{[^}]*color-scheme:\s*dark/);
    expect(css).toMatch(/:root\[data-theme=light\]\s*\{[^}]*color-scheme:\s*light/);
  });
});
