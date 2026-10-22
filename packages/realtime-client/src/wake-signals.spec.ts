import { browserWakeSignals } from './wake-signals';

class FakeDocument extends EventTarget {
  visibilityState: 'visible' | 'hidden' = 'hidden';
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('browserWakeSignals', () => {
  it('subscribes to nothing outside the browser', () => {
    expect(typeof window).toBe('undefined');
    const wake = vi.fn();
    const dispose = browserWakeSignals(wake);
    expect(() => dispose()).not.toThrow();
    expect(wake).not.toHaveBeenCalled();
  });

  it('wakes on online and on visibilitychange to visible, until disposed', () => {
    const win = new EventTarget();
    const doc = new FakeDocument();
    vi.stubGlobal('window', win);
    vi.stubGlobal('document', doc);
    const wake = vi.fn();
    const dispose = browserWakeSignals(wake);

    win.dispatchEvent(new Event('online'));
    expect(wake).toHaveBeenCalledTimes(1);

    doc.dispatchEvent(new Event('visibilitychange'));
    expect(wake).toHaveBeenCalledTimes(1);
    doc.visibilityState = 'visible';
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(wake).toHaveBeenCalledTimes(2);

    win.dispatchEvent(new Event('offline'));
    expect(wake).toHaveBeenCalledTimes(2);

    dispose();
    win.dispatchEvent(new Event('online'));
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(wake).toHaveBeenCalledTimes(2);
  });
});
