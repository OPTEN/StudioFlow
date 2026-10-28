import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { CDPSession, Locator, Page } from '@playwright/test';

/**
 * Screen recording of a page through the DevTools screencast (`Page.startScreencast`): JPEG frames at the page's device
 * pixels, timed by the browser, encoded afterwards with ffmpeg into a constant 30 fps H.264 file. Sharper than
 * Playwright's `recordVideo` (a fixed low bitrate VP8), and a recording can start and stop at any moment of a test.
 * Pointer moves made through {@link Screencast.click} are logged as `<name>.cursor.json` (CSS pixels, seconds from the
 * first frame), because the screencast does not show the mouse; a video adds the cursor from that log.
 */
export class Screencast {
  private readonly frames: { file: string; at: number }[] = [];
  private readonly cursor: { t: number; x: number; y: number; action: 'move' | 'down' | 'up' }[] = [];
  private readonly dir: string;
  private trimAt = 0;
  private stoppedAt = 0;
  private pointer = { x: 0, y: 0 };
  private loop: Promise<void> | undefined;

  private constructor(
    readonly page: Page,
    private readonly cdp: CDPSession,
    readonly outDir: string,
    readonly name: string,
  ) {
    this.dir = path.join(outDir, `.frames-${name}`);
  }

  /**
   * Starts recording `page`; frames go to `<outDir>/.frames-<name>` until {@link encode}. The screencast delivers CSS
   * pixels; `screenshots: true` records a loop of device-pixel screenshots instead (sharp on a 3x phone, about 10 fps).
   */
  static async start(page: Page, outDir: string, name: string, options: { screenshots?: boolean } = {}): Promise<Screencast> {
    const cdp = await page.context().newCDPSession(page);
    const cast = new Screencast(page, cdp, outDir, name);
    rmSync(cast.dir, { recursive: true, force: true });
    mkdirSync(cast.dir, { recursive: true });
    if (options.screenshots) {
      cast.loop = (async () => {
        while (!cast.stoppedAt) {
          const at = Date.now() / 1000;
          const file = path.join(cast.dir, `f${String(cast.frames.length).padStart(6, '0')}.jpg`);
          try {
            await page.screenshot({ path: file, type: 'jpeg', quality: 92, scale: 'device', animations: 'allow', caret: 'initial' });
            cast.frames.push({ file, at });
          } catch {
            await page.waitForTimeout(50).catch(() => undefined);
          }
        }
      })();
      return cast;
    }
    const size = page.viewportSize() ?? { width: 1920, height: 1080 };
    const scale = await page.evaluate(() => window.devicePixelRatio);
    cdp.on('Page.screencastFrame', (frame) => {
      const file = path.join(cast.dir, `f${String(cast.frames.length).padStart(6, '0')}.jpg`);
      writeFileSync(file, Buffer.from(frame.data, 'base64'));
      cast.frames.push({ file, at: frame.metadata.timestamp ?? Date.now() / 1000 });
      void cdp.send('Page.screencastFrameAck', { sessionId: frame.sessionId }).catch(() => undefined);
    });
    await cdp.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 95,
      maxWidth: Math.round(size.width * scale),
      maxHeight: Math.round(size.height * scale),
      everyNthFrame: 1,
    });
    return cast;
  }

  /** Drops everything recorded so far from the clip (loading, login): the clip starts here. */
  markStart(): void {
    this.trimAt = Date.now() / 1000;
  }

  /** Moves the pointer to the centre of `target` in visible steps (logged), then clicks it. */
  async click(target: Locator, options: { pauseMs?: number } = {}): Promise<void> {
    await target.scrollIntoViewIfNeeded();
    const box = await target.boundingBox();
    if (!box) throw new Error(`no box for ${target.toString()}`);
    await this.moveTo(box.x + box.width / 2, box.y + box.height / 2);
    await this.page.waitForTimeout(options.pauseMs ?? 250);
    this.log('down');
    await this.page.mouse.down();
    await this.page.waitForTimeout(90);
    this.log('up');
    await this.page.mouse.up();
  }

  /** Moves the pointer in about 0.6 s of small steps. */
  async moveTo(x: number, y: number, steps = 24): Promise<void> {
    const from = { ...this.pointer };
    for (let step = 1; step <= steps; step++) {
      const k = step / steps;
      const ease = 1 - (1 - k) ** 3;
      this.pointer = { x: from.x + (x - from.x) * ease, y: from.y + (y - from.y) * ease };
      await this.page.mouse.move(this.pointer.x, this.pointer.y);
      this.log('move');
      await this.page.waitForTimeout(25);
    }
  }

  async stop(): Promise<void> {
    this.stoppedAt = Date.now() / 1000;
    await this.loop;
    await this.cdp.send('Page.stopScreencast').catch(() => undefined);
    await this.cdp.detach().catch(() => undefined);
  }

  /**
   * Writes `<outDir>/<name>.mp4` (30 fps, H.264, yuv420p, crf 18) from the frames after {@link markStart}, each held
   * until the next one, the last until {@link stop}; then removes the frames. Returns the length in seconds.
   */
  encode(): number {
    if (!this.stoppedAt) throw new Error('stop() first');
    let first = this.frames.findIndex((frame) => frame.at >= this.trimAt);
    if (first < 0) first = this.frames.length - 1;
    // The frame on screen at the start mark is the one before it.
    if (first > 0 && this.frames[first]!.at > this.trimAt) first -= 1;
    const used = this.frames.slice(first);
    if (used.length === 0) throw new Error(`${this.name}: no frames`);
    const start = Math.max(this.trimAt, used[0]!.at);
    // Each frame is held for a whole number of 1/30 s ticks (cumulative rounding, so the clip does not drift); a frame
    // that falls between two ticks is dropped. The concat demuxer then needs no resampling.
    const lines: string[] = ['ffconcat version 1.0'];
    let ticks = 0;
    used.forEach((frame, index) => {
      const until = index + 1 < used.length ? used[index + 1]!.at : this.stoppedAt;
      const end = Math.round((until - start) * 30);
      if (end <= ticks) return;
      lines.push(`file '${path.basename(frame.file)}'`, `duration ${((end - ticks) / 30).toFixed(6)}`);
      ticks = end;
    });
    lines.push(lines.at(-2)!);
    const list = path.join(this.dir, 'list.txt');
    writeFileSync(list, lines.join('\n') + '\n');
    const out = path.join(this.outDir, `${this.name}.mp4`);
    const result = spawnSync(
      'ffmpeg',
      ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p', '-fps_mode', 'cfr', '-r', '30', '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-movflags', '+faststart', out],
      { encoding: 'utf8' },
    );
    if (result.status !== 0) throw new Error(`ffmpeg ${this.name}: ${result.stderr || result.error}`);
    const cursor = this.cursor.filter((entry) => entry.t >= start).map((entry) => ({ ...entry, t: +(entry.t - start).toFixed(3) }));
    writeFileSync(path.join(this.outDir, `${this.name}.cursor.json`), JSON.stringify({ viewport: this.page.viewportSize(), events: cursor }, null, 1));
    rmSync(this.dir, { recursive: true, force: true });
    return this.stoppedAt - start;
  }

  private log(action: 'move' | 'down' | 'up'): void {
    this.cursor.push({ t: Date.now() / 1000, x: Math.round(this.pointer.x), y: Math.round(this.pointer.y), action });
  }
}
