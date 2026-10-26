import { canvasDto } from '@studioflow/scene-model';
import {
  DEBUG_REFRESH_MS,
  formatDebugLines,
  mountDebugOverlay,
  type DebugInfo,
} from './debug-overlay';

const INFO: DebugInfo = {
  productionName: 'Webinar',
  sceneName: 'Welcome',
  broadcast: 'live',
  revision: 1_761_127_200_000_123,
  canvas: canvasDto('portrait', 'p1080'),
  hubState: 'connected',
  syncStatus: 'live',
  mediaState: 'connected',
  latencyMs: 61.6,
  rendererFps: 60,
  version: '0.1.0+1a2b3c4',
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
      'Webinar · Scene “Welcome”',
      'Revision 1761127200000123 · Broadcast live',
      'Canvas 1080 × 1920 · 9:16 · 1080p',
      'Hub connected · Sync up to date',
      'LiveKit connected',
      'Latency ≈ 62 ms · Renderer 60 fps',
      'K1 Handy Lea · 1920×1080 · 30 fps · 2.8 Mbit/s · Loss 0.3% · Buffer 48 ms',
      'S1 Laptop Tom · Screen 1 · freeze frame',
      'StudioFlow 0.1.0+1a2b3c4',
    ]);
  });

  it('shows what is missing while connecting', () => {
    const lines = formatDebugLines({
      productionName: null,
      sceneName: null,
      broadcast: null,
      revision: null,
      canvas: null,
      hubState: 'reconnecting',
      syncStatus: 'offline',
      mediaState: null,
      latencyMs: null,
      rendererFps: 0,
      version: '0.1.0',
      sources: [],
    });
    expect(lines).toEqual([
      'Unknown production · no scene',
      'Revision – · Broadcast –',
      'Canvas unknown',
      'Hub reconnecting · Sync offline, last state',
      'LiveKit loading…',
      'Latency ≈ – · Renderer 0 fps',
      'No camera or screen source in the picture',
      'StudioFlow 0.1.0',
    ]);
  });

  it('names the build in the last line, whatever the number of sources', () => {
    const none = formatDebugLines({ ...INFO, sources: [] });
    const two = formatDebugLines(INFO);
    expect(none.at(-1)).toBe('StudioFlow 0.1.0+1a2b3c4');
    expect(two.at(-1)).toBe('StudioFlow 0.1.0+1a2b3c4');
    expect(two.slice(0, 6)).toEqual(none.slice(0, 6));
    expect(formatDebugLines({ ...INFO, version: '0.0.0' }).at(-1)).toBe('StudioFlow 0.0.0');
  });

  it('marks partial stats and sources without picture', () => {
    const [line] = formatDebugLines({
      ...INFO,
      sources: [{ code: 'K2', label: null, availability: 'pending', stats: { width: 640 } }],
    }).slice(6);
    expect(line).toBe('K2 · –×– · – fps · – Mbit/s · Loss – · Buffer – · no picture');
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
