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

/** True when the video element currently has a decoded frame. */
export function hasVideoFrame(video: HTMLVideoElement): boolean {
  return video.videoWidth > 0 && video.videoHeight > 0;
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
 * Copies the current frame of a video into `canvas` (resized when needed). Returns false when there is no frame, no 2D
 * context, or the browser refuses the copy (errors are expected here and deliberately ignored); the canvas then keeps
 * its previous content.
 */
export function copyVideoFrame(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  limit: DesiredSize,
): boolean {
  if (!hasVideoFrame(video) || !hasRunningTrack(video)) {
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
 * blur or the browser refuses (the copy then stays sharp under the dark scrim).
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
      context.clearRect(0, 0, width, height);
      context.filter = `blur(${radius}px)`;
      context.drawImage(copy, 0, 0);
      context.filter = 'none';
      return true;
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
    context.clearRect(0, 0, width, height);
    context.imageSmoothingEnabled = true;
    context.drawImage(copy, 0, 0, width, height);
    return true;
  } catch {
    return false;
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
