/**
 * Keeps the stage's videos playing. All of them are muted and inline, which every browser allows to autoplay (in an
 * iframe with `allow="autoplay"` as well), but a browser may still pause them: background tabs, power saving, a page
 * restored from the back/forward cache. {@link resumeVideos} calls `play()` on paused videos that have a picture
 * source; it runs when the page becomes visible again and on the 2 s report tick. A refused `play()` (autoplay
 * blocked) shows nothing extra; the next check tries again.
 */

function hasLiveSource(video: HTMLVideoElement): boolean {
  const stream: unknown = video.srcObject;
  if (stream !== null && stream !== undefined) {
    const tracks =
      typeof (stream as MediaStream).getVideoTracks === 'function'
        ? (stream as MediaStream).getVideoTracks()
        : [];
    // A stream whose tracks all ended has no picture left; playing it again could only turn it black.
    return tracks.length === 0 || tracks.some((track) => track.readyState !== 'ended');
  }
  return Boolean(video.currentSrc || video.getAttribute('src'));
}

/** Calls `play()` on every paused video inside `root` that has a source; returns how many were resumed. */
export function resumeVideos(root: ParentNode): number {
  let resumed = 0;
  for (const video of root.querySelectorAll('video')) {
    if (!video.paused || video.ended || !hasLiveSource(video)) {
      continue;
    }
    video.muted = true;
    try {
      const playing: Promise<void> | undefined = video.play();
      playing?.catch(() => undefined);
      resumed += 1;
    } catch {
      // Old engines throw synchronously; the next check tries again.
    }
  }
  return resumed;
}

/** Resumes paused videos whenever the page becomes visible or is restored; returns the function that stops it. */
export function keepVideosPlaying(root: ParentNode, doc: Document): () => void {
  const view = doc.defaultView;
  const onVisible = (): void => {
    if (doc.visibilityState !== 'hidden') {
      resumeVideos(root);
    }
  };
  doc.addEventListener('visibilitychange', onVisible);
  view?.addEventListener('pageshow', onVisible);
  return () => {
    doc.removeEventListener('visibilitychange', onVisible);
    view?.removeEventListener('pageshow', onVisible);
  };
}
