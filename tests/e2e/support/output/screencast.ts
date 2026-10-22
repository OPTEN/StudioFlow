import type { CDPSession, Page } from '@playwright/test';
import { PNG } from 'pngjs';

/**
 * Screencast of a page through the DevTools protocol (`Page.startScreencast`, docs/testing.md 1.5): every frame the
 * compositor produces is kept with its time stamp, so a test can analyse the picture the audience sees (a fade shows
 * intermediate colours, a cut jumps, a source change leaves no black frame). The output iframe of an embedding page is
 * part of the screencast of the top page.
 */

export interface ScreencastFrame {
  /** Epoch milliseconds of the frame swap (same clock as `Date.now()`). */
  t: number;
  png: Buffer;
  width: number;
  height: number;
}

export interface Region {
  /** Fractions of the frame (0..1). */
  x: number;
  y: number;
  width: number;
  height: number;
}

export class Screencast {
  private readonly frames: ScreencastFrame[] = [];
  private active = false;

  private constructor(
    private readonly session: CDPSession,
    private readonly maxFrames: number,
  ) {}

  static async start(
    page: Page,
    options: { maxWidth?: number; maxHeight?: number; maxFrames?: number } = {},
  ): Promise<Screencast> {
    const session = await page.context().newCDPSession(page);
    const screencast = new Screencast(session, options.maxFrames ?? 4000);
    session.on('Page.screencastFrame', (event: { data: string; sessionId: number; metadata: { timestamp?: number; deviceWidth: number; deviceHeight: number } }) => {
      if (screencast.active && screencast.frames.length < screencast.maxFrames) {
        const png = Buffer.from(event.data, 'base64');
        screencast.frames.push({
          t: event.metadata.timestamp ? event.metadata.timestamp * 1000 : Date.now(),
          png,
          width: 0,
          height: 0,
        });
      }
      session.send('Page.screencastFrameAck', { sessionId: event.sessionId }).catch(() => undefined);
    });
    screencast.active = true;
    await session.send('Page.startScreencast', {
      format: 'png',
      maxWidth: options.maxWidth ?? 640,
      maxHeight: options.maxHeight ?? 360,
      everyNthFrame: 1,
    });
    return screencast;
  }

  /** Stops and returns the frames recorded so far. */
  async stop(): Promise<ScreencastFrame[]> {
    this.active = false;
    await this.session.send('Page.stopScreencast').catch(() => undefined);
    await this.session.detach().catch(() => undefined);
    return this.frames;
  }

  /** Frames so far (the screencast keeps running). */
  peek(): readonly ScreencastFrame[] {
    return this.frames;
  }
}

/** Decoded frame with fast region means. */
export class DecodedFrame {
  readonly width: number;
  readonly height: number;
  private readonly data: Buffer;

  constructor(
    readonly t: number,
    png: Buffer,
  ) {
    const decoded = PNG.sync.read(png);
    this.width = decoded.width;
    this.height = decoded.height;
    this.data = decoded.data;
  }

  /** Mean colour of a region given as fractions of the frame. */
  mean(region: Region): [number, number, number] {
    const x0 = Math.max(0, Math.floor(region.x * this.width));
    const y0 = Math.max(0, Math.floor(region.y * this.height));
    const x1 = Math.min(this.width, Math.max(x0 + 1, Math.ceil((region.x + region.width) * this.width)));
    const y1 = Math.min(this.height, Math.max(y0 + 1, Math.ceil((region.y + region.height) * this.height)));
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const offset = (y * this.width + x) * 4;
        r += this.data[offset]!;
        g += this.data[offset + 1]!;
        b += this.data[offset + 2]!;
        n += 1;
      }
    }
    return [r / n, g / n, b / n];
  }

  luma(region: Region): number {
    const [r, g, b] = this.mean(region);
    return 0.299 * r + 0.587 * g + 0.114 * b;
  }
}

export function decodeFrames(frames: readonly ScreencastFrame[]): DecodedFrame[] {
  return frames.map((frame) => new DecodedFrame(frame.t, frame.png));
}

/** The middle of the frame (avoids the stamp bar at the top and rounded corners). */
export const CENTRE: Region = { x: 0.3, y: 0.4, width: 0.4, height: 0.4 };
