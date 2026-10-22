/**
 * Latency stamp codec for automated glass-to-glass measurements (test research, section 4 «Glass-to-glass latency»).
 *
 * A test publisher draws the current time as a 32-bit millisecond stamp into the top bar of a 640 × 360 picture:
 * block 0 black and block 1 white as references, then 32 data bits MSB first, then one even-parity bit; each block is
 * 16 px wide and 48 px high. The receiver scales the picture back onto the 640 grid (any received simulcast layer
 * works), samples a 6 × 6 patch in the centre of every block and compares the stamp with its own clock. Publisher and
 * receiver use `performance.timeOrigin + performance.now()`, i.e. the OS clock, so pages on one machine share it.
 */

/** Geometry of the stamp in the publisher's 640 × 360 grid. */
export const STAMP = {
  width: 640,
  height: 360,
  blockWidth: 16,
  barHeight: 48,
  bits: 32,
  firstBit: 2,
  parityBlock: 34,
  /** Minimum luma difference between the white and the black reference. */
  minContrast: 100,
  /** Side of the sampled square in the centre of each block. */
  patch: 6,
} as const;

/** Decoded stamp; `ok` is false for pictures without a stamp or with a parity error. */
export interface DecodedStamp {
  readonly ok: boolean;
  /** Milliseconds since the epoch modulo 2³². */
  readonly ts: number;
}

/** Wall clock shared by publisher and receiver: the OS clock in ms. */
export function stampNow(): number {
  return performance.timeOrigin + performance.now();
}

/** Bits of a stamp: [ref black, ref white, 32 data bits MSB first, parity] (true = white). */
export function stampBlocks(timeMs: number): boolean[] {
  const value = Math.round(timeMs) >>> 0;
  const blocks = [false, true];
  let parity = 0;
  for (let bit = 0; bit < STAMP.bits; bit += 1) {
    const on = (value >>> (STAMP.bits - 1 - bit)) & 1;
    parity ^= on;
    blocks.push(on === 1);
  }
  blocks.push(parity === 1);
  return blocks;
}

/** Decodes a stamp from a per-block luma reader (0…255). */
export function decodeStamp(luma: (block: number) => number): DecodedStamp {
  const black = luma(0);
  const white = luma(1);
  if (!(white - black >= STAMP.minContrast)) {
    return { ok: false, ts: 0 };
  }
  const threshold = (black + white) / 2;
  let value = 0;
  let parity = 0;
  for (let bit = 0; bit < STAMP.bits; bit += 1) {
    const on = luma(STAMP.firstBit + bit) > threshold ? 1 : 0;
    value = (value * 2 + on) >>> 0;
    parity ^= on;
  }
  const parityBit = luma(STAMP.parityBlock) > threshold ? 1 : 0;
  return { ok: parityBit === parity, ts: value };
}

/**
 * Luma reader over the RGBA pixels of the stamp bar scaled to 640 × 48 (`getImageData` of a 640 × 48 canvas): mean
 * Rec. 601 luma of the 6 × 6 patch in the centre of each block.
 */
export function stripLuma(
  pixels: ArrayLike<number>,
  width: number = STAMP.width,
): (block: number) => number {
  const half = STAMP.patch / 2;
  const top = STAMP.barHeight / 2 - half;
  return (block) => {
    const left = block * STAMP.blockWidth + STAMP.blockWidth / 2 - half;
    let sum = 0;
    for (let y = top; y < top + STAMP.patch; y += 1) {
      for (let x = left; x < left + STAMP.patch; x += 1) {
        const offset = (y * width + x) * 4;
        sum += 0.299 * pixels[offset] + 0.587 * pixels[offset + 1] + 0.114 * pixels[offset + 2];
      }
    }
    return sum / (STAMP.patch * STAMP.patch);
  };
}

/** Latency of a decoded stamp, wrap-safe across the 2³² ms boundary (49.7 days). */
export function latencyMs(ts: number, nowMs: number = stampNow()): number {
  return ((Math.round(nowMs) >>> 0) - ts) >>> 0;
}
