import { AssetLoader } from './asset-loader';

describe('AssetLoader', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function image(): HTMLImageElement {
    return document.createElement('img');
  }

  it('keeps the element invisible until it has a picture', () => {
    const element = image();
    const loader = new AssetLoader(element);
    loader.load('/media/a.png');
    expect(element.getAttribute('src')).toBe('/media/a.png');
    expect(element.style.visibility).toBe('hidden');
    element.dispatchEvent(new Event('load'));
    expect(element.style.visibility).toBe('');
    loader.dispose();
  });

  it('retries failed loads with growing delays, without limit', async () => {
    const element = image();
    const loader = new AssetLoader(element);
    loader.load('/media/a.png');
    const removals = vi.spyOn(element, 'removeAttribute');
    const reloads = (): number => removals.mock.calls.filter(([name]) => name === 'src').length;
    const delays = [1000, 2000, 4000, 8000, 16_000, 30_000, 30_000];
    for (const delay of delays) {
      element.dispatchEvent(new Event('error'));
      expect(element.style.visibility).toBe('hidden');
      const before = reloads();
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(reloads()).toBe(before);
      await vi.advanceTimersByTimeAsync(1);
      expect(reloads()).toBe(before + 1);
      expect(element.getAttribute('src')).toBe('/media/a.png');
    }
    element.dispatchEvent(new Event('load'));
    expect(element.style.visibility).toBe('');
    // A success resets the backoff.
    element.dispatchEvent(new Event('error'));
    await vi.advanceTimersByTimeAsync(1000);
    expect(reloads()).toBe(delays.length + 1);
    loader.dispose();
  });

  it('retries at once when the browser is online again', () => {
    const element = image();
    const loader = new AssetLoader(element);
    loader.load('/media/a.png');
    element.dispatchEvent(new Event('error'));
    const removals = vi.spyOn(element, 'removeAttribute');
    const reloads = (): number => removals.mock.calls.filter(([name]) => name === 'src').length;
    window.dispatchEvent(new Event('online'));
    expect(reloads()).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
    // The online listener is gone after the retry.
    window.dispatchEvent(new Event('online'));
    expect(reloads()).toBe(1);
    loader.dispose();
  });

  it('reloads videos with load()', async () => {
    const element = document.createElement('video');
    const load = vi.spyOn(element, 'load').mockImplementation(() => undefined);
    const loader = new AssetLoader(element);
    loader.load('/media/clip.mp4');
    element.dispatchEvent(new Event('error'));
    await vi.advanceTimersByTimeAsync(1000);
    expect(load).toHaveBeenCalledTimes(1);
    element.dispatchEvent(new Event('loadeddata'));
    expect(element.style.visibility).toBe('');
    loader.dispose();
  });

  it('switches and clears URLs, and ignores the same URL', () => {
    const element = image();
    const loader = new AssetLoader(element);
    loader.load('/media/a.png');
    element.dispatchEvent(new Event('load'));
    loader.load('/media/a.png');
    expect(element.style.visibility).toBe('');
    loader.load('/media/b.png');
    expect(element.getAttribute('src')).toBe('/media/b.png');
    expect(element.style.visibility).toBe('hidden');
    loader.load(null);
    expect(element.hasAttribute('src')).toBe(false);
    element.dispatchEvent(new Event('error'));
    expect(vi.getTimerCount()).toBe(0);
    loader.dispose();
  });

  it('stops everything on dispose', () => {
    const element = image();
    const loader = new AssetLoader(element);
    loader.load('/media/a.png');
    element.dispatchEvent(new Event('error'));
    expect(vi.getTimerCount()).toBe(1);
    loader.dispose();
    loader.dispose();
    expect(vi.getTimerCount()).toBe(0);
    element.dispatchEvent(new Event('error'));
    expect(vi.getTimerCount()).toBe(0);
    loader.load('/media/c.png');
    expect(element.getAttribute('src')).toBe('/media/a.png');
  });
});
