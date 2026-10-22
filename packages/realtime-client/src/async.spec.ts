import { defaultSchedule, isPromiseLike, promiseFrom } from './async';

describe('defaultSchedule', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs the callback once after the delay', () => {
    const callback = vi.fn();
    defaultSchedule(callback, 100);
    vi.advanceTimersByTime(99);
    expect(callback).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(callback).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('cancels idempotently, also after the callback ran', () => {
    const callback = vi.fn();
    const cancel = defaultSchedule(callback, 100);
    cancel();
    cancel();
    vi.advanceTimersByTime(200);
    expect(callback).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    const late = defaultSchedule(callback, 10);
    vi.advanceTimersByTime(10);
    expect(() => late()).not.toThrow();
  });
});

describe('isPromiseLike', () => {
  it('recognises promises and thenables only', () => {
    expect(isPromiseLike(Promise.resolve())).toBe(true);
    expect(isPromiseLike({ then: () => undefined })).toBe(true);
    expect(isPromiseLike({ then: 1 })).toBe(false);
    expect(isPromiseLike(null)).toBe(false);
    expect(isPromiseLike(undefined)).toBe(false);
    expect(isPromiseLike(() => undefined)).toBe(false);
  });
});

describe('promiseFrom', () => {
  it('passes results and rejections through', async () => {
    await expect(promiseFrom(() => Promise.resolve(1))).resolves.toBe(1);
    await expect(promiseFrom(() => Promise.reject(new Error('no')))).rejects.toThrow('no');
  });

  it('turns a synchronous throw into a rejection', async () => {
    await expect(
      promiseFrom(() => {
        throw new Error('sync');
      }),
    ).rejects.toThrow('sync');
  });
});
