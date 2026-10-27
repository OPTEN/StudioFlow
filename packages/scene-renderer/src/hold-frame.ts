import type { DesiredSize } from './types';

/**
 * Hold-frame helpers (spec 7). Chromium paints a `<video>` black the moment its MediaStreamTrack ends (Firefox keeps
 * the last frame), and LiveKit ends remote tracks when they are unsubscribed. A copy taken after the loss would
 * therefore be black, so the renderer keeps a rolling copy of every live device picture (about once per second, at
 * on-screen resolution) and refreshes it once more at the moment of the loss while the track is still running.
 */

/** Longest edge of a copy; larger frames are scaled down (a 4K screen would otherwise cost 33 MB per copy). */
const MAX_COPY_EDGE = 1920;
/** Smallest edge of a copy. */
const MIN_COPY_EDGE = 16;

/** Events that mean the element has (new) frame data. */
const FRAME_EVENTS = ['loadeddata', 'playing'] as const;

/** `HTMLMediaElement.HAVE_CURRENT_DATA`: the element has a frame of the current position to show. */
const HAVE_CURRENT_DATA = 2;

/**
 * True when the video element currently has a decoded frame. The size of a video is known from its metadata on, before the
 * first frame is decoded (under load that takes a moment): a copy taken then is empty, and an empty hold frame is black on
 * air (issue #50).
 */
export function hasVideoFrame(video: HTMLVideoElement): boolean {
  return video.videoWidth > 0 && video.videoHeight > 0 && video.readyState >= HAVE_CURRENT_DATA;
}

/** Edge of the sample that tells whether a picture shows anything. */
const PROBE_EDGE = 8;

/** A 2D context of eight by eight pixels that is read back; null where there is no `OffscreenCanvas`. */
function probe(): OffscreenCanvasRenderingContext2D | null {
  return typeof OffscreenCanvas === 'function'
    ? new OffscreenCanvas(PROBE_EDGE, PROBE_EDGE).getContext('2d', { willReadFrequently: true })
    : null;
}

/**
 * True unless the source is known to show nothing: every pixel of an eight by eight sample is transparent or black. That
 * is a video that was never painted (the decoder is late), a track that ends and is painted black by the browser a moment
 * before its state says so, or a picture that is black. A copy of such a frame must never replace a good hold frame, and
 * must never become one (issue #50, "nothing black on air"). Where the browser cannot tell (no `OffscreenCanvas`, a read
 * that is refused), the frame counts as a picture: it is better to copy than to lose the copy.
 */
export function showsPicture(source: CanvasImageSource): boolean {
  try {
    const context = probe();
    if (!context) {
      return true;
    }
    context.clearRect(0, 0, PROBE_EDGE, PROBE_EDGE);
    context.drawImage(source, 0, 0, PROBE_EDGE, PROBE_EDGE);
    const { data } = context.getImageData(0, 0, PROBE_EDGE, PROBE_EDGE);
    for (let i = 0; i + 3 < data.length; i += 4) {
      if (data[i + 3]! >= 16 && (data[i]! > 1 || data[i + 1]! > 1 || data[i + 2]! > 1)) {
        return true;
      }
    }
    return false;
  } catch {
    return true;
  }
}

function isMediaStream(value: unknown): value is MediaStream {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as MediaStream).getVideoTracks === 'function'
  );
}

/**
 * False when the element plays a MediaStream whose video tracks all ended: its picture is gone (black in Chromium),
 * so copying it would overwrite a good hold frame. Elements without a MediaStream count as running.
 */
export function hasRunningTrack(video: HTMLVideoElement): boolean {
  const stream: unknown = video.srcObject;
  if (!isMediaStream(stream)) {
    return true;
  }
  return stream.getVideoTracks().some((track) => track.readyState !== 'ended');
}

/** Size of a copy: the frame scaled down to fit `limit` (on-screen pixels) and {@link MAX_COPY_EDGE}, aspect kept. */
export function copySize(frameWidth: number, frameHeight: number, limit: DesiredSize): DesiredSize {
  const factor = Math.min(
    1,
    MAX_COPY_EDGE / Math.max(frameWidth, frameHeight),
    Math.max(limit.width / frameWidth, limit.height / frameHeight),
  );
  return {
    width: Math.max(MIN_COPY_EDGE, Math.round(frameWidth * factor)),
    height: Math.max(MIN_COPY_EDGE, Math.round(frameHeight * factor)),
  };
}

/**
 * Copies the current frame of a video into `canvas` (resized when needed). Returns false when there is no frame, the frame
 * shows nothing (see {@link showsPicture}), no 2D context, or the browser refuses the copy (errors are expected here and
 * deliberately ignored); the canvas then keeps its previous content.
 */
export function copyVideoFrame(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  limit: DesiredSize,
): boolean {
  if (!hasVideoFrame(video) || !hasRunningTrack(video) || !showsPicture(video)) {
    return false;
  }
  try {
    const context = canvas.getContext('2d');
    if (!context) {
      return false;
    }
    const size = copySize(video.videoWidth, video.videoHeight, limit);
    if (canvas.width !== size.width || canvas.height !== size.height) {
      canvas.width = size.width;
      canvas.height = size.height;
    }
    context.drawImage(video, 0, 0, size.width, size.height);
    return true;
  } catch {
    return false;
  }
}

/**
 * Copies another hold frame (same source, other item) into `target`: an item that appears while its source is already
 * lost cannot copy from the video any more (black in Chromium), but another item may still hold the last picture.
 */
export function copyHoldFrame(source: HTMLCanvasElement, target: HTMLCanvasElement): boolean {
  if (source.width === 0 || source.height === 0) {
    return false;
  }
  try {
    const context = target.getContext('2d');
    if (!context) {
      return false;
    }
    target.width = source.width;
    target.height = source.height;
    context.drawImage(source, 0, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Blurs a copy once, in place (issue #12): the held state of an item shows its last picture blurred, and a CSS `filter`
 * on the live element would make the browser re-run the blur for every frame. Returns false when there is nothing to
 * blur or the browser refuses (the copy then stays sharp under the dark scrim). The canvas is cleared before the blurred
 * picture is drawn, so a refusal in between would leave it empty, which is black on air: the sharp picture is put back
 * then (issue #50).
 */
export function blurCanvas(canvas: HTMLCanvasElement, radius: number): boolean {
  if (canvas.width === 0 || canvas.height === 0 || !(radius > 0)) {
    return false;
  }
  try {
    const context = canvas.getContext('2d');
    if (!context) {
      return false;
    }
    const { width, height } = canvas;
    const copy = canvas.ownerDocument.createElement('canvas');
    if (typeof context.filter === 'string') {
      copy.width = width;
      copy.height = height;
      const copyContext = copy.getContext('2d');
      if (!copyContext) {
        return false;
      }
      copyContext.drawImage(canvas, 0, 0);
      try {
        context.clearRect(0, 0, width, height);
        context.filter = `blur(${radius}px)`;
        context.drawImage(copy, 0, 0);
        return true;
      } catch {
        putBack(context, copy, width, height);
        return false;
      } finally {
        context.filter = 'none';
      }
    }
    // No canvas filter (Safari): a picture shrunk and drawn large again is as soft as a blur of that radius.
    const shrink = Math.min(32, Math.max(2, Math.round(radius * 0.8)));
    copy.width = Math.max(1, Math.round(width / shrink));
    copy.height = Math.max(1, Math.round(height / shrink));
    const copyContext = copy.getContext('2d');
    if (!copyContext) {
      return false;
    }
    copyContext.imageSmoothingEnabled = true;
    copyContext.drawImage(canvas, 0, 0, copy.width, copy.height);
    // `copy` replaces the picture in one step: a refusal leaves the sharp one, not an empty canvas.
    context.imageSmoothingEnabled = true;
    context.globalCompositeOperation = 'copy';
    try {
      context.drawImage(copy, 0, 0, width, height);
      return true;
    } finally {
      context.globalCompositeOperation = 'source-over';
    }
  } catch {
    return false;
  }
}

/** Draws the sharp picture back after a blur that failed half way; refused again, there is nothing more to do. */
function putBack(
  context: CanvasRenderingContext2D,
  sharp: HTMLCanvasElement,
  width: number,
  height: number,
): void {
  try {
    context.filter = 'none';
    context.clearRect(0, 0, width, height);
    context.drawImage(sharp, 0, 0);
  } catch {
    // The canvas is lost; the item falls back to its CSS blur and the scrim.
  }
}

/** Frees the pixel buffer of a copy right away and removes it. */
export function releaseCanvas(canvas: HTMLCanvasElement): void {
  canvas.width = 0;
  canvas.height = 0;
  canvas.remove();
}

/**
 * Calls `onReady` once when the video reports new frame data or after `timeoutMs` (safety net: never keep a hold
 * picture forever over a live source). Returns a cancel function; after cancelling, `onReady` is never called.
 */
export function waitForVideoFrame(
  video: HTMLVideoElement,
  timeoutMs: number,
  onReady: () => void,
): () => void {
  let active = true;
  const cancel = (): void => {
    if (!active) {
      return;
    }
    active = false;
    clearTimeout(timer);
    for (const type of FRAME_EVENTS) {
      video.removeEventListener(type, ready);
    }
  };
  function ready(): void {
    if (active) {
      cancel();
      onReady();
    }
  }
  const timer = setTimeout(ready, timeoutMs);
  for (const type of FRAME_EVENTS) {
    video.addEventListener(type, ready);
  }
  return cancel;
}
