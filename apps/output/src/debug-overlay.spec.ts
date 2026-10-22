import {
  DEBUG_REFRESH_MS,
  formatDebugLines,
  mountDebugOverlay,
  type DebugInfo,
} from './debug-overlay';

const INFO: DebugInfo = {
  productionName: 'Webinar',
  sceneName: 'Begrüssung',
  broadcast: 'live',
  revision: 1_761_127_200_000_123,
  hubState: 'connected',
  syncStatus: 'live',
  mediaState: 'connected',
  latencyMs: 61.6,
  rendererFps: 60,
  sources: [
    {
      code: 'K1',
      label: 'Handy Lea',
      availability: 'live',
      stats: {
        width: 1920,
        height: 1080,
        fps: 29.97,
        bitrateKbps: 2800,
        packetLossPct: 0.25,
        jitterBufferDelayMs: 48.4,
      },
    },
    { code: 'S1', label: 'Laptop Tom · Screen 1', availability: 'lost', stats: null },
  ],
};

describe('formatDebugLines', () => {
  it('shows production, scene, revision, connections, latency, fps and per-source stats', () => {
    expect(formatDebugLines(INFO)).toEqual([
      'Webinar · Szene «Begrüssung»',
      'Revision 1761127200000123 · Sendung live',
      'Hub verbunden · Sync aktuell',
      'LiveKit verbunden',
      'Latenz ≈ 62 ms · Renderer 60 fps',
      'K1 Handy Lea · 1920×1080 · 30 fps · 2,8 Mbit/s · Verlust 0,3 % · Puffer 48 ms',
      'S1 Laptop Tom · Screen 1 · Standbild',
    ]);
  });

  it('shows what is missing while connecting', () => {
    const lines = formatDebugLines({
      productionName: null,
      sceneName: null,
      broadcast: null,
      revision: null,
      hubState: 'reconnecting',
      syncStatus: 'offline',
      mediaState: null,
      latencyMs: null,
      rendererFps: 0,
      sources: [],
    });
    expect(lines).toEqual([
      'Produktion unbekannt · keine Szene',
      'Revision – · Sendung –',
      'Hub verbindet neu · Sync offline, letzter Stand',
      'LiveKit lädt …',
      'Latenz ≈ – · Renderer 0 fps',
      'Keine Kamera- oder Screen-Quelle im Bild',
    ]);
  });

  it('marks partial stats and sources without picture', () => {
    const [line] = formatDebugLines({
      ...INFO,
      sources: [{ code: 'K2', label: null, availability: 'pending', stats: { width: 640 } }],
    }).slice(5);
    expect(line).toBe('K2 · –×– · – fps · – Mbit/s · Verlust – · Puffer – · kein Bild');
  });
});

describe('mountDebugOverlay', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('mounts a fixed mono panel outside the stage and refreshes it every second', async () => {
    const stage = document.createElement('main');
    document.body.append(stage);
    let revision = 1;
    const collect = vi.fn(() => Promise.resolve({ ...INFO, revision: revision++ }));
    const unmount = mountDebugOverlay(document, collect);
    await vi.advanceTimersByTimeAsync(0);
    const panel = document.querySelector('.c-debug');
    expect(panel?.parentElement).toBe(document.body);
    expect(panel?.getAttribute('aria-hidden')).toBe('true');
    expect(stage.contains(panel)).toBe(false);
    expect(panel?.textContent).toContain('Revision 1 ·');
    await vi.advanceTimersByTimeAsync(DEBUG_REFRESH_MS);
    expect(panel?.textContent).toContain('Revision 2 ·');
    await vi.advanceTimersByTimeAsync(DEBUG_REFRESH_MS * 3);
    expect(collect).toHaveBeenCalledTimes(5);
    unmount();
    expect(document.querySelector('.c-debug')).toBeNull();
    await vi.advanceTimersByTimeAsync(DEBUG_REFRESH_MS * 3);
    expect(collect).toHaveBeenCalledTimes(5);
    stage.remove();
  });

  it('keeps the last text when collecting fails', async () => {
    const collect = vi
      .fn<() => Promise<DebugInfo>>()
      .mockResolvedValueOnce(INFO)
      .mockRejectedValue(new Error('stats'));
    const unmount = mountDebugOverlay(document, collect);
    await vi.advanceTimersByTimeAsync(DEBUG_REFRESH_MS * 2);
    expect(document.querySelector('.c-debug')?.textContent).toContain('Webinar');
    unmount();
  });
});
