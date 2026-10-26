import { AssetLoader } from './asset-loader';
import { createElement, FILL, type StyleMap } from './dom';
import type { ResolvedSource } from './source-resolver';
import type { SourceMediaProvider } from './types';

/** Styles every media element shares: it fills its box; fit and mirror are set by the item. */
const MEDIA_STYLES: StyleMap = { ...FILL, display: 'block', 'pointer-events': 'none' };

/** What a media view needs from the renderer. */
export interface MediaHost {
  readonly doc: Document;
  readonly provider: SourceMediaProvider;
  /** Runs provider code without letting errors escape. */
  guard(run: () => void): void;
}

function createVideo(doc: Document, className: string): HTMLVideoElement {
  const video = createElement(doc, 'video', className, MEDIA_STYLES);
  // Properties for the running element, attributes for iOS Safari, which decides autoplay on the markup.
  video.muted = true;
  video.defaultMuted = true;
  video.autoplay = true;
  video.playsInline = true;
  video.setAttribute('muted', '');
  video.setAttribute('autoplay', '');
  video.setAttribute('playsinline', '');
  video.setAttribute('aria-hidden', 'true');
  return video;
}

function createDeviceVideo(doc: Document): HTMLVideoElement {
  const video = createVideo(doc, 'sf-r-media sf-r-media--device');
  video.disablePictureInPicture = true;
  video.setAttribute('disablepictureinpicture', '');
  return video;
}

function createAssetVideo(doc: Document): HTMLVideoElement {
  const video = createVideo(doc, 'sf-r-media sf-r-media--video');
  video.loop = true;
  video.setAttribute('loop', '');
  video.preload = 'auto';
  return video;
}

/** A decorative `<img>` (asset items, scene backgrounds, slates); the source is set through an {@link AssetLoader}. */
export function createImage(doc: Document, className: string, styles: StyleMap): HTMLImageElement {
  const image = createElement(doc, 'img', className, styles);
  image.decoding = 'async';
  image.draggable = false;
  image.alt = '';
  image.setAttribute('decoding', 'async');
  image.setAttribute('draggable', 'false');
  image.setAttribute('aria-hidden', 'true');
  return image;
}

/**
 * The media element of one resolved source: a provider-fed `<video>` for device sources (registered with
 * `provider.attach`), a looping `<video>` for video assets, an `<img>` for images, nothing for texts (drawn by the item)
 * and missing sources.
 * A view is reused as long as its source stays the same (recreating a video element flashes black).
 */
export class MediaView {
  /** The element to insert, or null for a missing source. */
  readonly element: HTMLVideoElement | HTMLImageElement | null;
  /** The same element when it is a video (device or video asset). */
  private readonly video: HTMLVideoElement | null;
  /** Loading and retries of asset elements. */
  private readonly loader: AssetLoader | null = null;
  private disposed = false;

  constructor(
    readonly source: ResolvedSource,
    private readonly host: MediaHost,
  ) {
    switch (source.kind) {
      case 'device': {
        const video = createDeviceVideo(host.doc);
        this.element = this.video = video;
        host.guard(() => host.provider.attach(source.sourceId, video));
        break;
      }
      case 'video':
        this.element = this.video = createAssetVideo(host.doc);
        this.loader = new AssetLoader(this.video);
        this.loader.load(source.url);
        break;
      case 'image':
        this.element = createImage(host.doc, 'sf-r-media sf-r-media--image', MEDIA_STYLES);
        this.video = null;
        this.loader = new AssetLoader(this.element);
        this.loader.load(source.url);
        break;
      case 'text':
      case 'missing':
        this.element = this.video = null;
        break;
    }
  }

  /** The video element of a device source (hold frame snapshot, first-frame detection), else null. */
  get deviceVideo(): HTMLVideoElement | null {
    return this.source.kind === 'device' ? this.video : null;
  }

  /** Releases the provider registration and the decoder, and removes the element. Idempotent. */
  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.loader?.dispose();
    const { element, video } = this;
    if (video && this.source.kind === 'device') {
      this.host.guard(() => this.host.provider.detach(this.source.sourceId, video));
    } else if (video) {
      this.host.guard(() => {
        video.pause();
        video.removeAttribute('src');
        video.load();
      });
    }
    element?.remove();
  }
}
