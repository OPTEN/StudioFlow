import { animatePresence } from './presence';
import { fakeAnimate, withoutAnimate } from './testing/fixtures';

describe('animatePresence', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  function element(): HTMLElement {
    const target = document.createElement('div');
    document.body.append(target);
    return target;
  }

  it('fades and slides in from the offset to rest, decelerating', () => {
    const animations = fakeAnimate();
    const spy = vi.spyOn(Element.prototype, 'animate');

    animatePresence(element(), true, { x: -10, y: 4 }, 300, () => undefined);

    expect(animations[0].keyframes).toEqual([
      { opacity: 0, transform: 'translate(-10px, 4px)' },
      { opacity: 1, transform: 'none' },
    ]);
    expect(spy.mock.calls[0][1]).toMatchObject({ duration: 300, fill: 'forwards' });
  });

  it('fades and slides out to the offset, accelerating', () => {
    const animations = fakeAnimate();

    animatePresence(element(), false, { x: -10, y: 4 }, 300, () => undefined);

    expect(animations[0].keyframes).toEqual([
      { opacity: 1, transform: 'none' },
      { opacity: 0, transform: 'translate(-10px, 4px)' },
    ]);
  });

  it('calls onEnd once, when the animation has run, and cancels it afterwards', async () => {
    const animations = fakeAnimate();
    const onEnd = vi.fn(() => {
      expect(animations[0].cancelled).toBe(false);
    });
    animatePresence(element(), false, { x: 0, y: 0 }, 300, onEnd);

    await vi.advanceTimersByTimeAsync(299);
    expect(onEnd).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(500);

    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(animations[0].cancelled).toBe(true);
  });

  it('finish() ends it at once and is idempotent', async () => {
    fakeAnimate();
    const onEnd = vi.fn();
    const running = animatePresence(element(), true, { x: 0, y: 0 }, 300, onEnd);

    running.finish();
    running.finish();
    await vi.advanceTimersByTimeAsync(1000);

    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('ends at once without a duration (reduced motion)', () => {
    const animations = fakeAnimate();
    const onEnd = vi.fn();

    animatePresence(element(), true, { x: 0, y: 0 }, 0, onEnd);

    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(animations).toHaveLength(0);
  });

  it('ends at once in a browser without Web Animations', () => {
    const restore = withoutAnimate();
    const onEnd = vi.fn();
    try {
      animatePresence(element(), true, { x: 0, y: 0 }, 300, onEnd);
    } finally {
      restore();
    }

    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('ends at once when starting the animation throws', () => {
    vi.spyOn(Element.prototype, 'animate').mockImplementation(() => {
      throw new Error('detached');
    });
    const onEnd = vi.fn();

    animatePresence(element(), true, { x: 0, y: 0 }, 300, onEnd);

    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('ends through the safety timer when the end is never reported', async () => {
    vi.spyOn(Element.prototype, 'animate').mockImplementation(
      () =>
        ({
          finished: new Promise<void>(() => undefined),
          cancel: () => undefined,
        }) as unknown as Animation,
    );
    const onEnd = vi.fn();

    animatePresence(element(), true, { x: 0, y: 0 }, 300, onEnd);
    await vi.advanceTimersByTimeAsync(399);
    expect(onEnd).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);

    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('does not end through the safety timer while the animation still moves', async () => {
    const animation = {
      currentTime: 250,
      finished: new Promise<void>(() => undefined),
      cancel: () => undefined,
    };
    vi.spyOn(Element.prototype, 'animate').mockImplementation(
      () => animation as unknown as Animation,
    );
    const onEnd = vi.fn();

    animatePresence(element(), true, { x: 0, y: 0 }, 300, onEnd);
    await vi.advanceTimersByTimeAsync(400);
    animation.currentTime = 290;
    await vi.advanceTimersByTimeAsync(100);
    expect(onEnd).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100);

    expect(onEnd).toHaveBeenCalledTimes(1);
  });
});
