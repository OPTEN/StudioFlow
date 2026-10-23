import type { MonitorSourceStatus } from './types';
import {
  CAMERA,
  CAMERA_2,
  mount,
  scene,
  sceneItem,
  SCREEN,
  type Mounted,
} from './testing/fixtures';

describe('scene renderer: monitor alerts', () => {
  let mounted: Mounted;
  let statuses: Map<string, MonitorSourceStatus>;
  const codes = new Map([
    [CAMERA, 'K1'],
    [CAMERA_2, 'K2'],
    [SCREEN, 'S1'],
  ]);

  beforeEach(() => {
    vi.useFakeTimers();
    statuses = new Map([
      [CAMERA, 'ok'],
      [CAMERA_2, 'ok'],
      [SCREEN, 'ok'],
    ]);
  });

  afterEach(() => {
    mounted?.renderer.destroy();
    mounted?.container.remove();
    vi.useRealTimers();
  });

  function mountMonitor(width = 1920, height = 1080, mode: 'monitor' | 'output' = 'monitor'): void {
    mounted = mount(
      { mode, statusOf: (id) => statuses.get(id), codeOf: (id) => codes.get(id) },
      { width, height },
    );
    mounted.renderer.show(
      scene('scn_a', [
        sceneItem('itm_k1', CAMERA, { w: 640, h: 360, radius: 12 }),
        sceneItem('itm_k2', CAMERA_2, { w: 640, h: 360 }),
        sceneItem('itm_s1', SCREEN, { w: 300, h: 170 }),
      ]),
    );
  }

  function setStatus(sourceId: string, status: MonitorSourceStatus): void {
    statuses.set(sourceId, status);
    mounted.renderer.setSourceStatuses();
  }

  const outline = (id: string): HTMLElement | null => mounted.part(id, '.sf-r-alert');
  const label = (id: string): HTMLElement | null => mounted.part(id, '.sf-r-alert-label');

  it('draws nothing while sources are ok', () => {
    mountMonitor();
    for (const id of ['itm_k1', 'itm_k2', 'itm_s1']) {
      expect(outline(id)?.style.display).toBe('none');
      expect(label(id)?.style.display).toBe('none');
    }
  });

  it('draws an amber dashed outline and the running hold timer while reconnecting', async () => {
    mountMonitor();
    mounted.provider.live(CAMERA);
    mounted.provider.lose(CAMERA);
    setStatus(CAMERA, 'reconnecting');

    expect(outline('itm_k1')?.style.display).toBe('block');
    expect(outline('itm_k1')?.style.borderColor).toBe('#e3b341');
    expect(outline('itm_k1')?.style.borderStyle).toBe('dashed');
    expect(outline('itm_k1')?.style.borderWidth).toBe('2px');
    expect(outline('itm_k1')?.style.left).toBe('1px');
    expect(outline('itm_k1')?.style.bottom).toBe('1px');
    expect(outline('itm_k1')?.style.borderRadius).toBe('11px');
    expect(label('itm_k1')?.style.backgroundColor).toBe('#e3b341');
    expect(label('itm_k1')?.style.color).toBe('#0d1117');
    expect(label('itm_k1')?.style.fontSize).toBe('11.5px');
    expect(label('itm_k1')?.style.height).toBe('18px');
    expect(label('itm_k1')?.style.fontWeight).toBe('700');
    expect(label('itm_k1')?.textContent).toBe('K1 · Standbild 00:00');

    await vi.advanceTimersByTimeAsync(12_000);
    expect(label('itm_k1')?.textContent).toBe('K1 · Standbild 00:12');
  });

  it('counts from the status change when the provider has no lost time', async () => {
    mountMonitor();
    await vi.advanceTimersByTimeAsync(5000);
    setStatus(CAMERA_2, 'reconnecting');
    expect(label('itm_k2')?.textContent).toBe('K2 · Standbild 00:00');
    await vi.advanceTimersByTimeAsync(3000);
    expect(label('itm_k2')?.textContent).toBe('K2 · Standbild 00:03');
    setStatus(CAMERA_2, 'ended');
    setStatus(CAMERA_2, 'reconnecting');
    expect(label('itm_k2')?.textContent).toBe('K2 · Standbild 00:00');
  });

  it('draws red outlines with fixed words for ended, lost and blocked (an ended camera is «Kamera beendet»)', () => {
    mountMonitor();
    setStatus(CAMERA, 'ended');
    setStatus(CAMERA_2, 'blocked');
    expect(outline('itm_k1')?.style.borderColor).toBe('#f85149');
    expect(label('itm_k1')?.textContent).toBe('K1 · Kamera beendet');
    expect(label('itm_k2')?.textContent).toBe('K2 · gesperrt');
    setStatus(CAMERA_2, 'lost');
    expect(label('itm_k2')?.textContent).toBe('K2 · kein Bild');
    expect(label('itm_k2')?.style.backgroundColor).toBe('#f85149');
  });

  it('uses short labels for items narrower than 190 screen pixels and adapts on resize', () => {
    mountMonitor(1920, 1080);
    setStatus(SCREEN, 'ended');
    setStatus(CAMERA, 'reconnecting');
    // 300 canvas px at scale 1 = 300 screen px: long variant.
    expect(label('itm_s1')?.textContent).toBe('S1 · Teilen beendet');
    // At scale 0.5 the screen item is 150 screen px wide, the cameras 320.
    mounted.setSize(960, 540);
    expect(label('itm_s1')?.textContent).toBe('S1 · beendet');
    expect(label('itm_k1')?.textContent).toBe('K1 · Standbild 00:00');
    mounted.setSize(480, 270);
    expect(label('itm_k1')?.textContent).toBe('K1 · 00:00');
    // Screen-pixel lengths follow the scale (0.25): 11.5 screen px = 46 canvas px.
    expect(label('itm_k1')?.style.fontSize).toBe('46px');
    expect(outline('itm_k1')?.style.borderWidth).toBe('8px');
  });

  it('only ticks while a timer label is visible', async () => {
    mountMonitor();
    expect(vi.getTimerCount()).toBe(0);
    setStatus(CAMERA, 'reconnecting');
    expect(vi.getTimerCount()).toBe(1);
    setStatus(CAMERA, 'ended');
    expect(vi.getTimerCount()).toBe(0);
    setStatus(CAMERA, 'reconnecting');
    mounted.renderer.update(
      scene('scn_a', [sceneItem('itm_k1', CAMERA, { hidden: true })], { version: 2 }),
    );
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(5000);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears the alert when the source is ok again', () => {
    mountMonitor();
    setStatus(CAMERA, 'blocked');
    setStatus(CAMERA, 'ok');
    expect(outline('itm_k1')?.style.display).toBe('none');
    expect(label('itm_k1')?.style.display).toBe('none');
  });

  it('never draws alerts on the output', () => {
    mountMonitor(1920, 1080, 'output');
    setStatus(CAMERA, 'reconnecting');
    expect(outline('itm_k1')?.style.display).toBe('none');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('survives throwing status and code callbacks', () => {
    mounted = mount({
      mode: 'monitor',
      statusOf: () => {
        throw new Error('store not ready');
      },
      codeOf: () => {
        throw new Error('no code');
      },
    });
    mounted.renderer.show(scene('scn_a', [sceneItem('itm_k1', CAMERA)]));
    expect(mounted.item('itm_k1')).not.toBeNull();
    expect(mounted.errors.length).toBeGreaterThan(0);
  });
});
