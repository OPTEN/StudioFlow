import { watchVisibility } from './visibility';

/** Minimal IntersectionObserver whose reports a test drives. */
class FakeObserver {
  static instances: FakeObserver[] = [];
  observed: Element[] = [];
  disconnected = false;

  constructor(
    private readonly callback: IntersectionObserverCallback,
    readonly options?: IntersectionObserverInit,
  ) {
    FakeObserver.instances.push(this);
  }

  observe(element: Element): void {
    this.observed.push(element);
  }

  disconnect(): void {
    this.disconnected = true;
  }

  report(...states: boolean[]): void {
    this.callback(
      states.map((isIntersecting) => ({ isIntersecting }) as IntersectionObserverEntry),
      this as unknown as IntersectionObserver,
    );
  }
}

function setPageVisibility(state: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('watchVisibility', () => {
  let target: HTMLDivElement;

  beforeEach(() => {
    FakeObserver.instances = [];
    vi.stubGlobal('IntersectionObserver', FakeObserver);
    target = document.createElement('div');
    document.body.append(target);
  });

  afterEach(() => {
    target.remove();
    setPageVisibility('visible');
    vi.unstubAllGlobals();
  });

  it('is visible at first, follows the intersection and tells only about changes', () => {
    const changes: boolean[] = [];
    const watch = watchVisibility(target, (visible) => changes.push(visible));
    const [observer] = FakeObserver.instances;
    expect(observer.observed).toEqual([target]);
    expect(observer.options?.rootMargin).toBeTruthy();
    expect(watch.visible()).toBe(true);
    observer.report(true);
    expect(changes).toEqual([]);
    observer.report(false);
    observer.report(false);
    expect(changes).toEqual([false]);
    expect(watch.visible()).toBe(false);
    observer.report(true);
    expect(changes).toEqual([false, true]);
    watch.dispose();
  });

  it('takes the newest entry of a report', () => {
    const changes: boolean[] = [];
    const watch = watchVisibility(target, (visible) => changes.push(visible));
    FakeObserver.instances[0].report(false, true, false);
    expect(changes).toEqual([false]);
    watch.dispose();
  });

  it('is not visible while the page is in the background, whatever the intersection says', () => {
    const changes: boolean[] = [];
    const watch = watchVisibility(target, (visible) => changes.push(visible));
    setPageVisibility('hidden');
    expect(watch.visible()).toBe(false);
    FakeObserver.instances[0].report(true);
    expect(watch.visible()).toBe(false);
    setPageVisibility('visible');
    expect(watch.visible()).toBe(true);
    expect(changes).toEqual([false, true]);
    watch.dispose();
  });

  it('starts hidden when the page is in the background', () => {
    setPageVisibility('hidden');
    const watch = watchVisibility(target, () => undefined);
    expect(watch.visible()).toBe(false);
    watch.dispose();
  });

  it('only watches the page visibility without IntersectionObserver', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const changes: boolean[] = [];
    const watch = watchVisibility(target, (visible) => changes.push(visible));
    expect(watch.visible()).toBe(true);
    setPageVisibility('hidden');
    expect(changes).toEqual([false]);
    watch.dispose();
  });

  it('stops observing and listening on dispose, and is idempotent', () => {
    const changes: boolean[] = [];
    const watch = watchVisibility(target, (visible) => changes.push(visible));
    watch.dispose();
    watch.dispose();
    expect(FakeObserver.instances[0].disconnected).toBe(true);
    FakeObserver.instances[0].report(false);
    setPageVisibility('hidden');
    expect(changes).toEqual([]);
  });
});
