import { STALL_MARGIN_MS, watchForStall } from './stall-guard';

/** An animation whose time the test moves by hand. */
function timedAnimation(currentTime: number | null): {
  animation: Animation;
  set(time: number | null): void;
} {
  const state = { currentTime };
  return {
    animation: state as unknown as Animation,
    set: (time) => {
      state.currentTime = time;
    },
  };
}

describe('watchForStall', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reports an animation without a clock one margin after its end', async () => {
    const onStalled = vi.fn();

    watchForStall(null, 500, onStalled);
    await vi.advanceTimersByTimeAsync(500 + STALL_MARGIN_MS - 1);
    expect(onStalled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(onStalled).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('leaves an animation alone whose time advances, however late it is', async () => {
    const { animation, set } = timedAnimation(1999);
    const onStalled = vi.fn();

    watchForStall(animation, 2000, onStalled);
    // The frames stall around the end: the wall-clock end passes while the animation is a hair before its own.
    await vi.advanceTimersByTimeAsync(2000 + STALL_MARGIN_MS);
    expect(onStalled).not.toHaveBeenCalled();
    set(1999.5);
    await vi.advanceTimersByTimeAsync(STALL_MARGIN_MS);
    expect(onStalled).not.toHaveBeenCalled();
    set(2000);
    await vi.advanceTimersByTimeAsync(STALL_MARGIN_MS);
    expect(onStalled).not.toHaveBeenCalled();
  });

  it('reports an animation whose time stands still for a margin', async () => {
    const { animation } = timedAnimation(300);
    const onStalled = vi.fn();

    watchForStall(animation, 2000, onStalled);
    await vi.advanceTimersByTimeAsync(2000 + STALL_MARGIN_MS);
    expect(onStalled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(STALL_MARGIN_MS);

    expect(onStalled).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reports an animation that never got a time', async () => {
    const { animation } = timedAnimation(null);
    const onStalled = vi.fn();

    watchForStall(animation, 300, onStalled);
    await vi.advanceTimersByTimeAsync(300 + STALL_MARGIN_MS);

    expect(onStalled).toHaveBeenCalledTimes(1);
  });

  it('stops the watch', async () => {
    const { animation } = timedAnimation(10);
    const onStalled = vi.fn();

    const stop = watchForStall(animation, 300, onStalled);
    stop();
    stop();
    await vi.advanceTimersByTimeAsync(5000);

    expect(onStalled).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops a watch that is already looking', async () => {
    const { animation, set } = timedAnimation(10);
    const onStalled = vi.fn();

    const stop = watchForStall(animation, 300, onStalled);
    await vi.advanceTimersByTimeAsync(300 + STALL_MARGIN_MS);
    set(20);
    stop();
    await vi.advanceTimersByTimeAsync(5000);

    expect(onStalled).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
