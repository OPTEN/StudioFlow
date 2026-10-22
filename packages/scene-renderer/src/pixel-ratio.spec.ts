import { devicePixelRatioNow, watchDevicePixelRatio } from './pixel-ratio';

describe('device pixel ratio', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads the ratio and falls back to 1 for malformed values', () => {
    vi.stubGlobal('devicePixelRatio', 2);
    expect(devicePixelRatioNow()).toBe(2);
    vi.stubGlobal('devicePixelRatio', 0);
    expect(devicePixelRatioNow()).toBe(1);
    vi.stubGlobal('devicePixelRatio', Number.NaN);
    expect(devicePixelRatioNow()).toBe(1);
  });

  it('reports changes and listens for the new ratio afterwards', () => {
    const queries: { media: string; listener: (() => void) | null; removed: boolean }[] = [];
    vi.stubGlobal(
      'matchMedia',
      vi.fn((media: string) => {
        const entry = { media, listener: null as (() => void) | null, removed: false };
        queries.push(entry);
        return {
          addEventListener: (_: string, listener: () => void) => (entry.listener = listener),
          removeEventListener: () => (entry.removed = true),
        };
      }),
    );
    vi.stubGlobal('devicePixelRatio', 1);
    const onChange = vi.fn();
    const stop = watchDevicePixelRatio(onChange);
    expect(queries.map((query) => query.media)).toEqual(['(resolution: 1dppx)']);

    vi.stubGlobal('devicePixelRatio', 2);
    queries[0].listener?.();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(queries[0].removed).toBe(true);
    expect(queries[1].media).toBe('(resolution: 2dppx)');

    stop();
    expect(queries[1].removed).toBe(true);
  });

  it('does nothing without matchMedia or change events', () => {
    vi.stubGlobal('matchMedia', undefined);
    expect(() => watchDevicePixelRatio(() => undefined)()).not.toThrow();
    vi.stubGlobal('matchMedia', () => ({}));
    expect(() => watchDevicePixelRatio(() => undefined)()).not.toThrow();
  });
});
