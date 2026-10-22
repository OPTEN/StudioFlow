import { decodeStamp, latencyMs, STAMP, stampBlocks, stripLuma } from './latency-stamp';

/**
 * Paints a stamp the way the test publisher does (research section 4: grey picture, 16 px black/white blocks in a
 * 48 px bar) into a 640 × 48 RGBA strip, optionally with noise and reduced contrast like a decoded video frame.
 */
function paintStrip(
  timeMs: number,
  options: { noise?: number; black?: number; white?: number } = {},
) {
  const { noise = 0, black = 0, white = 255 } = options;
  const pixels = new Uint8ClampedArray(STAMP.width * STAMP.barHeight * 4).fill(128);
  const blocks = stampBlocks(timeMs);
  let seed = 7;
  const jitter = (): number => {
    seed = (seed * 16807) % 2147483647;
    return ((seed / 2147483647) * 2 - 1) * noise;
  };
  for (let y = 0; y < STAMP.barHeight; y += 1) {
    for (let x = 0; x < STAMP.width; x += 1) {
      const block = Math.floor(x / STAMP.blockWidth);
      const offset = (y * STAMP.width + x) * 4;
      if (block < blocks.length) {
        const value = blocks[block] ? white : black;
        pixels[offset] = value + jitter();
        pixels[offset + 1] = value + jitter();
        pixels[offset + 2] = value + jitter();
      }
      pixels[offset + 3] = 255;
    }
  }
  return pixels;
}

describe('latency stamp', () => {
  it('lays out reference blocks, 32 data bits and parity', () => {
    const blocks = stampBlocks(0b1011);
    expect(blocks).toHaveLength(35);
    expect(blocks.slice(0, 2)).toEqual([false, true]);
    expect(blocks.slice(30, 34)).toEqual([true, false, true, true]);
    expect(blocks[34]).toBe(true);
  });

  it.each([0, 1, 1_761_127_200_123, 2 ** 32 - 1, 2 ** 40 + 12345])(
    'round-trips %d through a synthetic frame',
    (timeMs) => {
      const decoded = decodeStamp(stripLuma(paintStrip(timeMs)));
      expect(decoded).toEqual({ ok: true, ts: Math.round(timeMs) >>> 0 });
    },
  );

  it('decodes a noisy, low-contrast frame (compressed video)', () => {
    const decoded = decodeStamp(
      stripLuma(paintStrip(1_761_127_200_456, { noise: 25, black: 30, white: 200 })),
    );
    expect(decoded).toEqual({ ok: true, ts: 1_761_127_200_456 >>> 0 });
  });

  it('rejects a picture without stamp (no contrast between the references)', () => {
    const grey = new Uint8ClampedArray(STAMP.width * STAMP.barHeight * 4).fill(128);
    expect(decodeStamp(stripLuma(grey)).ok).toBe(false);
  });

  it('rejects a parity error', () => {
    const pixels = paintStrip(123_456);
    // Flip data bit 0 (block 2) in the sampled centre region.
    for (let y = 0; y < STAMP.barHeight; y += 1) {
      for (let x = 2 * STAMP.blockWidth; x < 3 * STAMP.blockWidth; x += 1) {
        const offset = (y * STAMP.width + x) * 4;
        const flipped = pixels[offset] > 128 ? 0 : 255;
        pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = flipped;
      }
    }
    expect(decodeStamp(stripLuma(pixels)).ok).toBe(false);
  });

  it('computes the latency wrap-safe', () => {
    expect(latencyMs(1000, 1042)).toBe(42);
    expect(latencyMs(2 ** 32 - 10, 2 ** 32 + 30)).toBe(40);
  });
});
