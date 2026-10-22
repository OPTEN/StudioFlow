import { keepVideosPlaying, resumeVideos } from './autoplay';
import { CURSOR_IDLE_CLASS, CURSOR_IDLE_MS, hideIdleCursor } from './cursor';
import { formatClockMs, startClockPage } from './clock-page';
import { CLOCK_HINT } from './slates';
import { whenFontsReady } from './fonts';

function pausedVideo(src: string | null): HTMLVideoElement {
  const video = document.createElement('video');
  if (src) {
    video.setAttribute('src', src);
  }
  Object.defineProperty(video, 'paused', { value: true, configurable: true });
  video.play = vi.fn(() => Promise.reject(new DOMException('blocked', 'NotAllowedError')));
  return video;
}

describe('autoplay', () => {
  it('resumes paused videos that have a source and swallows a blocked autoplay', async () => {
    const root = document.createElement('div');
    const withSource = pausedVideo('/media/a.mp4');
    const withoutSource = pausedVideo(null);
    const playing = pausedVideo('/media/b.mp4');
    Object.defineProperty(playing, 'paused', { value: false });
    root.append(withSource, withoutSource, playing);
    expect(resumeVideos(root)).toBe(1);
    expect(withSource.play).toHaveBeenCalledTimes(1);
    expect(withSource.muted).toBe(true);
    expect(withoutSource.play).not.toHaveBeenCalled();
    expect(playing.play).not.toHaveBeenCalled();
    await Promise.resolve();
  });

  it('leaves a stream whose tracks all ended alone (hold frame)', () => {
    const root = document.createElement('div');
    const video = pausedVideo(null);
    Object.defineProperty(video, 'srcObject', {
      value: { getVideoTracks: () => [{ readyState: 'ended' }] },
      configurable: true,
    });
    root.append(video);
    expect(resumeVideos(root)).toBe(0);
  });

  it('retries when the page becomes visible or is restored', () => {
    const root = document.createElement('div');
    const video = pausedVideo('/media/a.mp4');
    root.append(video);
    const stop = keepVideosPlaying(root, document);
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('pageshow'));
    expect(video.play).toHaveBeenCalledTimes(2);
    stop();
    document.dispatchEvent(new Event('visibilitychange'));
    expect(video.play).toHaveBeenCalledTimes(2);
  });
});

describe('cursor', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('hides the cursor after 3 s without movement and shows it on movement', () => {
    const root = document.documentElement;
    const stop = hideIdleCursor(document);
    vi.advanceTimersByTime(CURSOR_IDLE_MS - 1);
    expect(root.classList.contains(CURSOR_IDLE_CLASS)).toBe(false);
    vi.advanceTimersByTime(1);
    expect(root.classList.contains(CURSOR_IDLE_CLASS)).toBe(true);
    document.dispatchEvent(new Event('pointermove'));
    expect(root.classList.contains(CURSOR_IDLE_CLASS)).toBe(false);
    vi.advanceTimersByTime(CURSOR_IDLE_MS);
    expect(root.classList.contains(CURSOR_IDLE_CLASS)).toBe(true);
    stop();
    expect(root.classList.contains(CURSOR_IDLE_CLASS)).toBe(false);
  });
});

describe('measurement clock (/o/_uhr)', () => {
  it('formats HH:MM:SS.mmm', () => {
    expect(formatClockMs(new Date(2026, 9, 22, 9, 5, 7, 42))).toBe('09:05:07.042');
    expect(formatClockMs(new Date(2026, 9, 22, 23, 59, 59, 999))).toBe('23:59:59.999');
    expect(formatClockMs(new Date(Number.NaN))).toBe('--:--:--.---');
  });

  it('shows a running clock and the hint, redrawn every animation frame', async () => {
    const frames: FrameRequestCallback[] = [];
    const request = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => frames.push(callback));
    const root = document.createElement('main');
    document.body.append(root);
    const stop = startClockPage(document, root);
    await whenFontsReady(document, []);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const time = root.querySelector('.c-clock__time');
    expect(time?.textContent).toMatch(/^\d{2}:\d{2}:\d{2}\.\d{3}$/);
    expect(root.querySelector('.c-clock__hint')?.textContent).toBe(CLOCK_HINT);
    expect(document.title).toBe('FlowStudio Uhr');
    const before = frames.length;
    frames.at(-1)?.(0);
    expect(frames.length).toBe(before + 1);
    stop();
    request.mockRestore();
    root.remove();
  });
});
