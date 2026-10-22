import { browserWakeSignals, pageWakeSignals, type WakeTargets } from './wake-signals';

class FakeDocument extends EventTarget {
  visibilityState: 'visible' | 'hidden' = 'hidden';
}

function targets(): { targets: WakeTargets; win: EventTarget; doc: FakeDocument } {
  const win = new EventTarget();
  const doc = new FakeDocument();
  return { targets: { window: win, document: doc }, win, doc };
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

describe('pageWakeSignals', () => {
  it.each([
    ['window', 'online'],
    ['window', 'pageshow'],
    ['document', 'resume'],
  ] as const)('wakes on %s %s', (target, type) => {
    const { targets: page, win, doc } = targets();
    const wake = vi.fn();
    pageWakeSignals(page)(wake);

    (target === 'window' ? win : doc).dispatchEvent(new Event(type));

    expect(wake).toHaveBeenCalledTimes(1);
  });

  it('ignores suspension and hidden pages', () => {
    const { targets: page, win, doc } = targets();
    const wake = vi.fn();
    pageWakeSignals(page)(wake);

    win.dispatchEvent(new Event('pagehide'));
    doc.dispatchEvent(new Event('freeze'));
    doc.dispatchEvent(new Event('visibilitychange'));

    expect(wake).not.toHaveBeenCalled();
  });

  it('removes every listener on dispose and is inert without targets', () => {
    const { targets: page, win, doc } = targets();
    const wake = vi.fn();
    const dispose = pageWakeSignals(page)(wake);
    dispose();
    win.dispatchEvent(new Event('online'));
    win.dispatchEvent(new Event('pageshow'));
    doc.dispatchEvent(new Event('resume'));
    expect(wake).not.toHaveBeenCalled();

    expect(() => pageWakeSignals(null)(wake)()).not.toThrow();
  });
});
