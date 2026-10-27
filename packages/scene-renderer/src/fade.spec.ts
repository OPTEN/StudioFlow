import { fadeOpacity } from './fade';
import { fakeAnimate, flushMicrotasks, withoutAnimate } from './testing/fixtures';

describe('fadeOpacity', () => {
  let element: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers();
    element = document.createElement('div');
    document.body.append(element);
  });

  afterEach(() => {
    element.remove();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('animates opacity with the Web Animations API and resolves when it finished', async () => {
    const animations = fakeAnimate();
    const fade = fadeOpacity(element, 0, 1, 300);
    let done = false;
    void fade.done.then(() => {
      done = true;
    });
    expect(animations).toHaveLength(1);
    expect(animations[0].keyframes).toEqual([{ opacity: 0 }, { opacity: 1 }]);
    expect(animations[0].duration).toBe(300);
    expect(element.style.opacity).toBe('0');

    await vi.advanceTimersByTimeAsync(299);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await flushMicrotasks();
    expect(done).toBe(true);
    expect(element.style.opacity).toBe('1');
    expect(animations[0].cancelled).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('jumps to the end on finish() and resolves without rejecting', async () => {
    const animations = fakeAnimate();
    const fade = fadeOpacity(element, 1, 0, 2000);
    fade.finish();
    fade.finish();
    await expect(fade.done).resolves.toBeUndefined();
    expect(element.style.opacity).toBe('0');
    expect(animations[0].cancelled).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops at the current value', async () => {
    fakeAnimate();
    const fade = fadeOpacity(element, 0, 1, 1000);
    await vi.advanceTimersByTimeAsync(250);
    expect(fade.stop()).toBeCloseTo(0.25, 5);
    expect(Number(element.style.opacity)).toBeCloseTo(0.25, 5);
    expect(fade.stop()).toBeCloseTo(0.25, 5);
    await expect(fade.done).resolves.toBeUndefined();
  });

  it('ends at once for a zero or invalid duration', async () => {
    const animations = fakeAnimate();
    for (const duration of [0, -1, Number.NaN]) {
      const fade = fadeOpacity(element, 0, 1, duration);
      await expect(fade.done).resolves.toBeUndefined();
      expect(element.style.opacity).toBe('1');
    }
    expect(animations).toHaveLength(0);
  });

  it('completes through the safety timeout when the animation never reports its end', async () => {
    vi.spyOn(Element.prototype, 'animate').mockImplementation(
      () => ({ finished: new Promise(() => undefined), cancel: vi.fn() }) as unknown as Animation,
    );
    const fade = fadeOpacity(element, 0, 1, 500);
    let done = false;
    void fade.done.then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(599);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toBe(true);
    expect(element.style.opacity).toBe('1');
  });

  it('leaves a fade that is late with its frames to finish by itself (issue 31)', async () => {
    // A loaded machine stalls the frames around the end: the wall-clock end passes while the animation is one frame
    // short of its own. Cancelling it there would end the fade without the animation ever reporting it.
    let finish: () => void = () => undefined;
    const cancel = vi.fn();
    const animation = {
      currentTime: 1983,
      finished: new Promise<void>((resolve) => {
        finish = resolve;
      }),
      cancel,
    };
    vi.spyOn(Element.prototype, 'animate').mockImplementation(
      () => animation as unknown as Animation,
    );
    const fade = fadeOpacity(element, 0, 1, 2000);
    let done = false;
    void fade.done.then(() => {
      done = true;
    });

    await vi.advanceTimersByTimeAsync(2000 + 100);
    expect(done).toBe(false);
    animation.currentTime = 1990;
    await vi.advanceTimersByTimeAsync(100);
    expect(done).toBe(false);
    expect(cancel).not.toHaveBeenCalled();
    animation.currentTime = 2000;
    finish();
    await flushMicrotasks();

    expect(done).toBe(true);
    expect(element.style.opacity).toBe('1');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('completes a fade whose animation stands still after its end', async () => {
    const animation = {
      currentTime: 400,
      finished: new Promise<void>(() => undefined),
      cancel: vi.fn(),
    };
    vi.spyOn(Element.prototype, 'animate').mockImplementation(
      () => animation as unknown as Animation,
    );
    const fade = fadeOpacity(element, 0, 1, 500);
    let done = false;
    void fade.done.then(() => {
      done = true;
    });

    // The first look (100 ms after the end) sees the clock; a second of standing still counts from there.
    await vi.advanceTimersByTimeAsync(500 + 100 + 1000 - 1);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    expect(done).toBe(true);
    expect(element.style.opacity).toBe('1');
    expect(animation.cancel).toHaveBeenCalledTimes(1);
  });

  it('falls back to a CSS transition when element.animate is missing', async () => {
    const restore = withoutAnimate();
    try {
      const fade = fadeOpacity(element, 0, 1, 300);
      expect(element.style.transition).toBe('opacity 300ms linear');
      expect(element.style.opacity).toBe('1');
      const event = new Event('transitionend') as TransitionEvent;
      Object.defineProperty(event, 'propertyName', { value: 'opacity' });
      element.dispatchEvent(event);
      await expect(fade.done).resolves.toBeUndefined();
      expect(element.style.transition).toBe('');
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      restore();
    }
  });

  it('falls back to a CSS transition when element.animate throws', async () => {
    vi.spyOn(Element.prototype, 'animate').mockImplementation(() => {
      throw new Error('not supported');
    });
    const fade = fadeOpacity(element, 0, 1, 300);
    expect(element.style.transition).toBe('opacity 300ms linear');
    await vi.advanceTimersByTimeAsync(400);
    await expect(fade.done).resolves.toBeUndefined();
    expect(element.style.opacity).toBe('1');
  });
});
