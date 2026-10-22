import jsQR from 'jsqr';
import { PNG } from 'pngjs';

/**
 * Pixel access for screenshots (docs/testing.md 1.5): decode a PNG, read single pixels, mean colour and luminance of a
 * region, compare colours with a tolerance, and decode QR codes (`jsqr`). Everything works on the decoded RGBA bytes in
 * Node, so a test can assert what a stage, a monitor or a QR code really shows.
 */

export type Rgba = readonly [r: number, g: number, b: number, a: number];

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** `#rrggbb` / `#rgb` to [r, g, b]. */
export function parseHex(color: string): [number, number, number] {
  const hex = color.replace('#', '');
  const full =
    hex.length === 3
      ? hex
          .split('')
          .map((c) => c + c)
          .join('')
      : hex;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

/** Rec. 601 luma, 0..255. */
export function luma(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/** A decoded screenshot. Coordinates are in screenshot pixels (CSS pixels at a device scale factor of 1). */
export class PixelImage {
  private constructor(
    readonly width: number,
    readonly height: number,
    readonly data: Buffer,
  ) {}

  static fromPng(png: Buffer): PixelImage {
    const decoded = PNG.sync.read(png);
    return new PixelImage(decoded.width, decoded.height, decoded.data);
  }

  static fromRgba(width: number, height: number, data: ArrayLike<number>): PixelImage {
    return new PixelImage(width, height, Buffer.from(data as ArrayLike<number> as Uint8Array));
  }

  pixel(x: number, y: number): Rgba {
    const px = Math.min(this.width - 1, Math.max(0, Math.round(x)));
    const py = Math.min(this.height - 1, Math.max(0, Math.round(y)));
    const offset = (py * this.width + px) * 4;
    return [
      this.data[offset]!,
      this.data[offset + 1]!,
      this.data[offset + 2]!,
      this.data[offset + 3]!,
    ];
  }

  /** Mean colour of a region (default: the whole image). Alpha is averaged too. */
  mean(rect: Rect = { x: 0, y: 0, width: this.width, height: this.height }): Rgba {
    const x0 = Math.max(0, Math.round(rect.x));
    const y0 = Math.max(0, Math.round(rect.y));
    const x1 = Math.min(this.width, Math.round(rect.x + rect.width));
    const y1 = Math.min(this.height, Math.round(rect.y + rect.height));
    let r = 0;
    let g = 0;
    let b = 0;
    let a = 0;
    let count = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const offset = (y * this.width + x) * 4;
        r += this.data[offset]!;
        g += this.data[offset + 1]!;
        b += this.data[offset + 2]!;
        a += this.data[offset + 3]!;
        count += 1;
      }
    }
    if (count === 0)
      throw new Error(
        `empty region ${JSON.stringify(rect)} in a ${this.width}x${this.height} image`,
      );
    return [r / count, g / count, b / count, a / count];
  }

  meanLuma(rect?: Rect): number {
    const [r, g, b] = this.mean(rect);
    return luma(r, g, b);
  }

  /** Share (0..1) of the pixels of a region within `tolerance` (per channel) of a colour. */
  shareOfColor(
    color: string | readonly [number, number, number],
    rect: Rect = { x: 0, y: 0, width: this.width, height: this.height },
    tolerance = 24,
  ): number {
    const [tr, tg, tb] = typeof color === 'string' ? parseHex(color) : color;
    const x1 = Math.min(this.width, Math.round(rect.x + rect.width));
    const y1 = Math.min(this.height, Math.round(rect.y + rect.height));
    let match = 0;
    let count = 0;
    for (let y = Math.max(0, Math.round(rect.y)); y < y1; y++) {
      for (let x = Math.max(0, Math.round(rect.x)); x < x1; x++) {
        const offset = (y * this.width + x) * 4;
        count += 1;
        if (
          Math.abs(this.data[offset]! - tr) <= tolerance &&
          Math.abs(this.data[offset + 1]! - tg) <= tolerance &&
          Math.abs(this.data[offset + 2]! - tb) <= tolerance
        )
          match += 1;
      }
    }
    return count === 0 ? 0 : match / count;
  }

  /** The sub-image of a region. */
  crop(rect: Rect): PixelImage {
    const x0 = Math.max(0, Math.round(rect.x));
    const y0 = Math.max(0, Math.round(rect.y));
    const width = Math.min(this.width - x0, Math.round(rect.width));
    const height = Math.min(this.height - y0, Math.round(rect.height));
    const out = Buffer.alloc(width * height * 4);
    for (let y = 0; y < height; y++)
      this.data.copy(
        out,
        y * width * 4,
        ((y0 + y) * this.width + x0) * 4,
        ((y0 + y) * this.width + x0 + width) * 4,
      );
    return new PixelImage(width, height, out);
  }

  /** Re-encoded as PNG (for attachments). */
  toPng(): Buffer {
    const png = new PNG({ width: this.width, height: this.height });
    this.data.copy(png.data);
    return PNG.sync.write(png);
  }
}

/** True when the colour of `actual` is within `tolerance` (per channel) of `expected` (`#rrggbb`). */
export function colorsClose(
  actual: Rgba | readonly number[],
  expected: string,
  tolerance = 24,
): boolean {
  const [r, g, b] = parseHex(expected);
  return (
    Math.abs(actual[0]! - r) <= tolerance &&
    Math.abs(actual[1]! - g) <= tolerance &&
    Math.abs(actual[2]! - b) <= tolerance
  );
}

/** Scales a region of an image up by an integer factor (nearest neighbour), so a small QR code decodes reliably. */
export function upscale(image: PixelImage, factor: number): PixelImage {
  const width = image.width * factor;
  const height = image.height * factor;
  const out = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const source = (Math.floor(y / factor) * image.width + Math.floor(x / factor)) * 4;
      image.data.copy(out, (y * width + x) * 4, source, source + 4);
    }
  }
  return PixelImage.fromRgba(width, height, out);
}

/** Decodes the first QR code of an image, or null. Tries the image as it is, then enlarged. */
export function decodeQr(image: PixelImage): string | null {
  for (const factor of [1, 3]) {
    const scaled = factor === 1 ? image : upscale(image, factor);
    const result = jsQR(new Uint8ClampedArray(scaled.data), scaled.width, scaled.height, {
      inversionAttempts: 'dontInvert',
    });
    if (result) return result.data;
  }
  return null;
}
