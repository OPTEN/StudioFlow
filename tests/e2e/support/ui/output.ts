import { expect, type BrowserContext, type Frame, type Locator, type Page } from '@playwright/test';
import { stackConfig, type StackConfig } from '../env';
import { percentile } from '../helpers';
import { watchPage, type PageProblems } from './diagnostics';
import { EMBED_ORIGIN, serveFakeOrigin } from './init';
import { PixelImage, type Rect, type Rgba } from './pixels';
import { expectVideoPlaying, type VideoMeasurement } from './video';

/**
 * Page object of the output page (`apps/output`, `/o/{slug}?k=…`, docs/testing.md 1.5 and E2E-OUT-*): opened directly or
 * inside an iframe on a fake origin (`https://embed.test`, served with `page.route`; the test stack lists it in
 * STUDIOFLOW_FRAME_ANCESTORS), plus the checks the output tests share: a playing video, pixels of the stage and the
 * latency samples of the `?latency=1` test aid (`window.__studioflowLatency`).
 */

/** What a production exposes to open its output (the `production` fixture satisfies this). */
export interface OutputTarget {
  slug: string;
  outputKey: string;
}

export interface OutputFlags {
  /** `latency=1`: decode latency stamps of device videos into `window.__studioflowLatency`. */
  latency?: boolean;
  /** `debug=1`: measuring overlay. */
  debug?: boolean;
  /** `bg=transparent` */
  transparent?: boolean;
}

export interface EmbedOptions extends OutputFlags {
  /** Size of the iframe in CSS pixels (default 1280 x 720). */
  size?: { width: number; height: number };
  /** Origin of the embedding page (default {@link EMBED_ORIGIN}). */
  origin?: string;
  /** Background of the embedding page (default dark grey; a red one shows transparency). */
  hostBackground?: string;
  /** `title` attribute of the iframe. */
  title?: string;
  /**
   * Wait until the iframe holds the output document (default true). Pass false for an origin the stack refuses
   * to be framed by (`FOREIGN_ORIGIN`): the frame then never loads.
   */
  waitForFrame?: boolean;
}

/** One measurement of `?latency=1`. */
export interface LatencySample {
  sourceId: string;
  latencyMs: number;
  at: number;
  width: number;
  height: number;
}

export interface LatencyStats {
  count: number;
  p50: number;
  p95: number;
  max: number;
  min: number;
  /** Frame widths seen (the simulcast layers). */
  widths: number[];
}

/** The output link of a target. */
export function outputPath(target: OutputTarget, flags: OutputFlags = {}): string {
  const query = new URLSearchParams({ k: target.outputKey });
  if (flags.transparent) query.set('bg', 'transparent');
  if (flags.debug) query.set('debug', '1');
  if (flags.latency) query.set('latency', '1');
  return `/o/${target.slug}?${query.toString()}`;
}

export function latencyStats(
  samples: readonly LatencySample[],
  options: { sourceId?: string; skip?: number } = {},
): LatencyStats {
  const usable = samples
    .filter(
      (sample) =>
        Number.isFinite(sample.latencyMs) &&
        (options.sourceId === undefined || sample.sourceId === options.sourceId),
    )
    .slice(options.skip ?? 0);
  const values = usable.map((sample) => sample.latencyMs);
  return {
    count: values.length,
    p50: percentile(values, 50),
    p95: percentile(values, 95),
    max: values.length ? Math.max(...values) : NaN,
    min: values.length ? Math.min(...values) : NaN,
    widths: [...new Set(usable.map((sample) => sample.width))].sort((a, b) => a - b),
  };
}

/** Value of an HTML attribute in double quotes. */
function attribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

export class OutputPage {
  readonly problems: PageProblems;

  private constructor(
    /** The page that was opened: the output itself, or the embedding page. */
    readonly page: Page,
    readonly embedded: boolean,
    readonly config: StackConfig,
  ) {
    this.problems = watchPage(page);
  }

  /** Opens the output page itself in a new page of the context. */
  static async open(
    context: BrowserContext,
    target: OutputTarget,
    flags: OutputFlags = {},
    options: { viewport?: { width: number; height: number } } = {},
  ): Promise<OutputPage> {
    const page = await context.newPage();
    if (options.viewport) await page.setViewportSize(options.viewport);
    const output = new OutputPage(page, false, stackConfig());
    await page.goto(outputPath(target, flags));
    return output;
  }

  /**
   * Opens the output in an iframe of a page on a fake origin (default `https://embed.test`): the way the proxy product
   * embeds it (`allow="autoplay; fullscreen"`). The fake origin is served from `page.route`.
   */
  static async embed(
    context: BrowserContext,
    target: OutputTarget,
    options: EmbedOptions = {},
  ): Promise<OutputPage> {
    const config = stackConfig();
    const origin = options.origin ?? EMBED_ORIGIN;
    const { width, height } = options.size ?? { width: 1280, height: 720 };
    const src = `${config.baseURL}${outputPath(target, options)}`;
    await serveFakeOrigin(
      context,
      origin,
      `<!doctype html><meta charset="utf-8"><title>Embed</title><body style="margin:0;background:${options.hostBackground ?? '#262626'}"><iframe id="output-frame" src="${attribute(src)}" title="${attribute(options.title ?? 'Output')}" allow="autoplay; fullscreen" allowfullscreen style="border:0;display:block;width:${width}px;height:${height}px"></iframe></body>`,
    );
    const page = await context.newPage();
    await page.setViewportSize({
      width: Math.max(width + 40, 320),
      height: Math.max(height + 40, 240),
    });
    const output = new OutputPage(page, true, config);
    await page.goto(`${origin}/`);
    if (options.waitForFrame ?? true) await output.frame();
    return output;
  }

  // --- the document of the output -------------------------------------------------------------------------------

  /** The frame that holds the output document (the page itself, or the iframe). Waits until the iframe has loaded it. */
  async frame(timeout = 15_000): Promise<Frame> {
    if (!this.embedded) return this.page.mainFrame();
    let found: Frame | undefined;
    await expect
      .poll(
        () => {
          found = this.page
            .frames()
            .find(
              (frame) =>
                frame !== this.page.mainFrame() &&
                /\/o\/[^/]+/.test(frame.url()) &&
                frame.url().startsWith(this.config.baseURL),
            );
          return Boolean(found);
        },
        {
          timeout,
          message: `the output frame loaded (frames: ${this.page
            .frames()
            .map((frame) => frame.url())
            .join(' | ')})`,
        },
      )
      .toBe(true);
    return found!;
  }

  /** The `<iframe>` element on the embedding page. */
  iframe(): Locator {
    return this.page.locator('#output-frame');
  }

  /** Resizes the iframe at run time (letterboxing tests); the embedding page's viewport grows with it. */
  async resizeFrame(size: { width: number; height: number }): Promise<void> {
    await this.page.setViewportSize({
      width: Math.max(size.width + 40, 320),
      height: Math.max(size.height + 40, 240),
    });
    await this.iframe().evaluate((element: HTMLIFrameElement, next) => {
      element.style.width = `${next.width}px`;
      element.style.height = `${next.height}px`;
    }, size);
  }

  private async scope(): Promise<Frame> {
    return this.frame();
  }

  /** The root of the output document (`<main id="output">`). */
  async root(): Promise<Locator> {
    return (await this.scope()).locator('#output');
  }

  /** The 1920 x 1080 stage (`.sf-r-stage`) inside the letterbox. */
  async stage(): Promise<Locator> {
    return (await this.scope()).locator('.sf-r-stage').first();
  }

  async videos(): Promise<Locator> {
    return (await this.scope()).locator('#output video');
  }

  /** Waits for `count` `<video>` elements that play (picture size, not paused, new frames). */
  async waitForPlayingVideos(
    count = 1,
    options: { minFps?: number; timeout?: number } = {},
  ): Promise<VideoMeasurement[]> {
    const videos = await this.videos();
    await expect(videos, `${count} video element(s) on the stage`).toHaveCount(count, {
      timeout: options.timeout ?? 20_000,
    });
    const measured: VideoMeasurement[] = [];
    for (let index = 0; index < count; index++)
      measured.push(await expectVideoPlaying(videos.nth(index), options));
    return measured;
  }

  /** Text of the slate layer («Gleich geht's los», «Danke fürs Zuschauen», «Kein Zugang»); empty when no slate shows. */
  async slateText(): Promise<string> {
    const frame = await this.scope();
    return frame.evaluate(() => {
      const slate = document.querySelector('[data-slate], .sf-r-slates');
      const text = (slate as HTMLElement | null)?.innerText ?? '';
      return text.trim();
    });
  }

  /** Ids of the scene layers on the stage (`[data-scene-id]`). */
  async sceneIds(): Promise<string[]> {
    const frame = await this.scope();
    return frame.evaluate(() =>
      [...document.querySelectorAll('[data-scene-id]')].map(
        (element) => element.getAttribute('data-scene-id') ?? '',
      ),
    );
  }

  /** Items on the stage: id, bounding box (page pixels) and whether they hold a video or an image. */
  async items(): Promise<
    Array<{
      id: string;
      box: Rect;
      hasVideo: boolean;
      hasImage: boolean;
      visible: boolean;
      state: string | null;
    }>
  > {
    const frame = await this.scope();
    return frame.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('[data-item-id]')].map((element) => {
        const box = element.getBoundingClientRect();
        return {
          id: element.getAttribute('data-item-id') ?? '',
          box: { x: box.x, y: box.y, width: box.width, height: box.height },
          hasVideo: Boolean(element.querySelector('video')),
          hasImage: Boolean(element.querySelector('img')),
          visible: getComputedStyle(element).display !== 'none' && box.width > 0 && box.height > 0,
          state: element.getAttribute('data-state'),
        };
      }),
    );
  }

  /**
   * The lines of the debug overlay (page opened with `debug: true`): scene, revision, connection states, per source
   * resolution/fps/bitrate, estimated latency. The product has no `window.__sfOutput` (spec 12); the overlay and the
   * DOM attributes of the stage are what an output test reads. Empty without the overlay.
   */
  async debugLines(): Promise<string[]> {
    const frame = await this.scope();
    return frame.evaluate(() => {
      const panel = document.querySelector('[data-testid=debug-overlay], .c-debug');
      return (panel?.textContent ?? '')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
    });
  }

  // --- pixels -------------------------------------------------------------------------------------------------

  /** Screenshot of the stage (letterbox excluded) as pixels; canvas coordinates are those of the production's canvas. `omitBackground` keeps transparency. */
  async stagePixels(options: { omitBackground?: boolean } = {}): Promise<{
    image: PixelImage;
    /** Screenshot pixels per canvas pixel. */
    scale: number;
    /** Size of the canvas (the stage element before it is scaled to the window). */
    canvas: { width: number; height: number };
    at: (canvasX: number, canvasY: number) => Rgba;
    mean: (canvasRect: Rect) => Rgba;
  }> {
    const stage = await this.stage();
    await expect(stage).toBeVisible();
    const box = (await stage.boundingBox())!;
    const png = await this.page.screenshot({
      clip: { x: Math.max(0, box.x), y: Math.max(0, box.y), width: box.width, height: box.height },
      omitBackground: options.omitBackground,
      animations: 'allow',
    });
    const image = PixelImage.fromPng(png);
    const canvas = await stage.evaluate((element: HTMLElement) => ({
      width: element.offsetWidth,
      height: element.offsetHeight,
    }));
    const scale = image.width / canvas.width;
    const toImage = (rect: Rect): Rect => ({
      x: rect.x * scale,
      y: rect.y * scale,
      width: Math.max(1, rect.width * scale),
      height: Math.max(1, rect.height * scale),
    });
    return {
      image,
      scale,
      canvas,
      at: (x, y) => image.pixel(x * scale, y * scale),
      mean: (rect) => image.mean(toImage(rect)),
    };
  }

  /** Screenshot of the whole viewport of the page that was opened (letterbox, host page and iframe included). */
  async viewportPixels(options: { omitBackground?: boolean } = {}): Promise<PixelImage> {
    return PixelImage.fromPng(
      await this.page.screenshot({ omitBackground: options.omitBackground, animations: 'allow' }),
    );
  }

  // --- latency (?latency=1) ------------------------------------------------------------------------------------

  /** Samples collected so far by the latency probe (empty when the page was not opened with `latency: true`). */
  async latencySamples(): Promise<LatencySample[]> {
    const frame = await this.scope();
    return frame.evaluate(
      () =>
        (
          window as unknown as { __studioflowLatency?: LatencySample[] }
        ).__studioflowLatency?.slice() ?? [],
    );
  }

  /** Waits for `count` decoded samples, then returns all of them with their statistics (warm-up samples skipped). */
  async collectLatency(
    options: { count?: number; skip?: number; timeout?: number; sourceId?: string } = {},
  ): Promise<{ samples: LatencySample[]; stats: LatencyStats }> {
    const { count = 60, skip = 10, timeout = 30_000, sourceId } = options;
    let samples: LatencySample[] = [];
    await expect
      .poll(
        async () => {
          samples = await this.latencySamples();
          return latencyStats(samples, { sourceId, skip }).count;
        },
        {
          timeout,
          intervals: [250],
          message: `${count} latency samples (page opened with latency=1?)`,
        },
      )
      .toBeGreaterThanOrEqual(count);
    return { samples, stats: latencyStats(samples, { sourceId, skip }) };
  }
}
