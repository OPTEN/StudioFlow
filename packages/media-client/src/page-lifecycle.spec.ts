import { watchPageLifecycle, type PageLifecycleTargets } from './page-lifecycle';

class FakeDocument extends EventTarget {
  visibilityState: DocumentVisibilityState = 'visible';
}

function setup(): { targets: PageLifecycleTargets; win: EventTarget; doc: FakeDocument } {
  const win = new EventTarget();
  const doc = new FakeDocument();
  return { targets: { window: win, document: doc }, win, doc };
}

describe('watchPageLifecycle', () => {
  it.each([
    ['window', 'online'],
    ['window', 'pageshow'],
    ['document', 'resume'],
  ] as const)('wakes on %s %s', (target, type) => {
    const { targets, win, doc } = setup();
    const lifecycle = watchPageLifecycle(targets);
    const wake = vi.fn();
    lifecycle.onWake(wake);
    (target === 'window' ? win : doc).dispatchEvent(new Event(type));
    expect(wake).toHaveBeenCalledTimes(1);
  });

  it('wakes when the document becomes visible, not when it is hidden', () => {
    const { targets, doc } = setup();
    const lifecycle = watchPageLifecycle(targets);
    const wake = vi.fn();
    lifecycle.onWake(wake);
    doc.visibilityState = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(wake).not.toHaveBeenCalled();
    doc.visibilityState = 'visible';
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(wake).toHaveBeenCalledTimes(1);
  });

  it('is suspended between pagehide and pageshow and between freeze and resume', () => {
    const { targets, win, doc } = setup();
    const lifecycle = watchPageLifecycle(targets);
    win.dispatchEvent(new Event('pagehide'));
    expect(lifecycle.suspended).toBe(true);
    win.dispatchEvent(new Event('pageshow'));
    expect(lifecycle.suspended).toBe(false);
    doc.dispatchEvent(new Event('freeze'));
    expect(lifecycle.suspended).toBe(true);
    doc.dispatchEvent(new Event('resume'));
    expect(lifecycle.suspended).toBe(false);
  });

  it('a hidden page is not suspended (background screen shares keep reconnecting)', () => {
    const { targets, doc } = setup();
    const lifecycle = watchPageLifecycle(targets);
    doc.visibilityState = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(lifecycle.suspended).toBe(false);
  });

  it('stops listening after unsubscribe and dispose', () => {
    const { targets, win } = setup();
    const lifecycle = watchPageLifecycle(targets);
    const first = vi.fn();
    const second = vi.fn();
    const unsubscribe = lifecycle.onWake(first);
    lifecycle.onWake(second);
    unsubscribe();
    win.dispatchEvent(new Event('online'));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    lifecycle.dispose();
    win.dispatchEvent(new Event('online'));
    win.dispatchEvent(new Event('pagehide'));
    expect(second).toHaveBeenCalledTimes(1);
    expect(lifecycle.suspended).toBe(false);
  });

  it('uses window and document by default and is inert without a DOM', () => {
    const lifecycle = watchPageLifecycle();
    const wake = vi.fn();
    lifecycle.onWake(wake);
    window.dispatchEvent(new Event('online'));
    expect(wake).toHaveBeenCalledTimes(1);
    lifecycle.dispose();

    const inert = watchPageLifecycle(null);
    expect(inert.suspended).toBe(false);
    expect(() => inert.onWake(wake)()).not.toThrow();
    expect(() => inert.dispose()).not.toThrow();
  });
});
