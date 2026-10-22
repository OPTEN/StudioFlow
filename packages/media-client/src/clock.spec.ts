import { TimeoutError, cancellableDelay, withTimeout } from './clock';
import { Listeners } from './listeners';

describe('withTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('passes a value through and clears its timer', async () => {
    await expect(withTimeout(Promise.resolve(42), 1000)).resolves.toBe(42);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('passes a rejection through', async () => {
    await expect(withTimeout(Promise.reject(new Error('nope')), 1000)).rejects.toThrow('nope');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects with TimeoutError when the promise hangs', async () => {
    const result = withTimeout(new Promise<never>(() => undefined), 1000);
    const assertion = expect(result).rejects.toBeInstanceOf(TimeoutError);
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
  });

  it('swallows a rejection that arrives after the timeout', async () => {
    let reject: (error: Error) => void = () => undefined;
    const late = new Promise<never>((_resolve, rejectLate) => (reject = rejectLate));
    const result = withTimeout(late, 10);
    const assertion = expect(result).rejects.toBeInstanceOf(TimeoutError);
    await vi.advanceTimersByTimeAsync(10);
    await assertion;
    reject(new Error('late'));
    await Promise.resolve();
  });
});

describe('cancellableDelay', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves true after the delay', async () => {
    const delay = cancellableDelay(500);
    await vi.advanceTimersByTimeAsync(500);
    await expect(delay.done).resolves.toBe(true);
  });

  it('resolves false at once when cancelled and clears the timer', async () => {
    const delay = cancellableDelay(500);
    delay.cancel();
    await expect(delay.done).resolves.toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('Listeners', () => {
  it('isolates throwing listeners and reports the error', () => {
    const onError = vi.fn();
    const listeners = new Listeners<[number]>(onError);
    const good = vi.fn();
    listeners.add(() => {
      throw new Error('bad listener');
    });
    listeners.add(good);
    listeners.emit(7);
    expect(good).toHaveBeenCalledWith(7);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('allows unsubscribing during emit and clears everything', () => {
    const listeners = new Listeners<[]>(() => undefined);
    const second = vi.fn();
    const unsubscribeSecond = listeners.add(second);
    listeners.add(() => unsubscribeSecond());
    listeners.emit();
    listeners.emit();
    expect(second).toHaveBeenCalledTimes(1);
    listeners.clear();
    const third = vi.fn();
    listeners.emit();
    expect(third).not.toHaveBeenCalled();
  });
});
