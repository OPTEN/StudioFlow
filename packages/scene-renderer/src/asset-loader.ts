import { setStyle } from './dom';

function isVideo(element: HTMLImageElement | HTMLVideoElement): element is HTMLVideoElement {
  return element.tagName === 'VIDEO';
}

/** First retry after a failed asset load; doubles per attempt. */
const RETRY_BASE_MS = 1000;
/** Longest wait between two attempts (the output must recover by itself after a network outage). */
const RETRY_MAX_MS = 30_000;

/**
 * Loads an image or video asset into its element robustly: the element stays invisible until it has a picture (no
 * broken-image icon or frame on the output, as WebKit and Firefox would paint), and failed loads are retried with
 * backoff without limit, immediately when the browser reports `online` again.
 */
export class AssetLoader {
  private url: string | null = null;
  private attempts = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private readonly video: HTMLVideoElement | null;
  private readonly readyEvent: 'load' | 'loadeddata';

  constructor(private readonly element: HTMLImageElement | HTMLVideoElement) {
    this.video = isVideo(element) ? element : null;
    this.readyEvent = this.video ? 'loadeddata' : 'load';
    element.addEventListener(this.readyEvent, this.onReady);
    element.addEventListener('error', this.onError);
    setStyle(element, 'visibility', 'hidden');
  }

  /** Loads `url` (no-op when unchanged); null removes the source. */
  load(url: string | null): void {
    if (this.disposed || url === this.url) {
      return;
    }
    this.url = url;
    this.attempts = 0;
    this.cancelRetry();
    setStyle(this.element, 'visibility', 'hidden');
    if (url) {
      this.element.src = url;
    } else {
      this.element.removeAttribute('src');
    }
  }

  /** Stops retrying and removes the listeners. Idempotent. */
  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.cancelRetry();
    this.element.removeEventListener(this.readyEvent, this.onReady);
    this.element.removeEventListener('error', this.onError);
  }

  private readonly onReady = (): void => {
    this.attempts = 0;
    this.cancelRetry();
    setStyle(this.element, 'visibility', '');
  };

  private readonly onError = (): void => {
    if (this.disposed || !this.url) {
      return;
    }
    setStyle(this.element, 'visibility', 'hidden');
    this.cancelRetry();
    const delay = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** this.attempts);
    this.attempts += 1;
    this.retryTimer = setTimeout(this.retry, delay);
    addEventListener('online', this.retry);
  };

  private readonly retry = (): void => {
    this.cancelRetry();
    const { element, url } = this;
    if (this.disposed || !url) {
      return;
    }
    if (this.video) {
      this.video.load();
    } else {
      // Re-setting the attribute starts a new request (a failed load is not cached).
      element.removeAttribute('src');
      element.src = url;
    }
  };

  private cancelRetry(): void {
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    removeEventListener('online', this.retry);
  }
}
