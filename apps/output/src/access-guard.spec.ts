import { ACCESS_RETRY_MS, AccessGuard, type AccessSide } from './access-guard';

describe('AccessGuard', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup() {
    const events: string[] = [];
    const retries: AccessSide[] = [];
    const guard = new AccessGuard({
      onDenied: () => events.push('denied'),
      onAllowed: () => events.push('allowed'),
      retry: (side) => retries.push(side),
    });
    return { guard, events, retries };
  }

  it('reports the first refusal once and retries after 30 s', () => {
    const { guard, events, retries } = setup();
    guard.deny('hub');
    guard.deny('hub');
    expect(events).toEqual(['denied']);
    expect(guard.denied).toBe(true);
    vi.advanceTimersByTime(ACCESS_RETRY_MS - 1);
    expect(retries).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(retries).toEqual(['hub']);
  });

  it('never retries faster than every 30 s, also when the retry is refused at once', () => {
    const { guard, retries } = setup();
    const retryTimes: number[] = [];
    const started = Date.now();
    const guarded = new AccessGuard({
      onDenied: () => undefined,
      onAllowed: () => undefined,
      retry: () => {
        retryTimes.push(Date.now() - started);
        // The restarted connection is refused again 50 ms later.
        setTimeout(() => guarded.deny('hub'), 50);
      },
    });
    guarded.deny('hub');
    vi.advanceTimersByTime(ACCESS_RETRY_MS * 4 + 100);
    expect(retryTimes).toEqual([30_000, 60_000, 90_000, 120_000]);
    expect(retries).toEqual([]);
    guard.dispose();
  });

  it('keeps retrying every 30 s while a restarted side stays silent', () => {
    const { guard, retries } = setup();
    guard.deny('media');
    vi.advanceTimersByTime(ACCESS_RETRY_MS * 3);
    expect(retries).toEqual(['media', 'media', 'media']);
  });

  it('recovers by itself when the side connects again', () => {
    const { guard, events, retries } = setup();
    guard.deny('hub');
    vi.advanceTimersByTime(ACCESS_RETRY_MS);
    guard.allow('hub');
    expect(events).toEqual(['denied', 'allowed']);
    expect(guard.denied).toBe(false);
    vi.advanceTimersByTime(ACCESS_RETRY_MS * 2);
    expect(retries).toEqual(['hub']);
  });

  it('stays denied until every refused side connected again', () => {
    const { guard, events, retries } = setup();
    guard.deny('hub');
    guard.deny('media');
    vi.advanceTimersByTime(ACCESS_RETRY_MS);
    expect(retries).toEqual(['hub', 'media']);
    guard.allow('hub');
    expect(events).toEqual(['denied']);
    expect(guard.isDenied('media')).toBe(true);
    guard.allow('media');
    expect(events).toEqual(['denied', 'allowed']);
  });

  it('ignores allow for a side that was not refused', () => {
    const { guard, events } = setup();
    guard.allow('hub');
    guard.deny('media');
    guard.allow('hub');
    expect(events).toEqual(['denied']);
  });

  it('starts a fresh 30 s wait after a recovery', () => {
    const { guard, retries } = setup();
    guard.deny('hub');
    vi.advanceTimersByTime(ACCESS_RETRY_MS);
    guard.allow('hub');
    vi.advanceTimersByTime(5000);
    guard.deny('hub');
    vi.advanceTimersByTime(ACCESS_RETRY_MS - 1);
    expect(retries).toEqual(['hub']);
    vi.advanceTimersByTime(1);
    expect(retries).toEqual(['hub', 'hub']);
  });

  it('stops retrying after dispose', () => {
    const { guard, retries } = setup();
    guard.deny('hub');
    guard.dispose();
    vi.advanceTimersByTime(ACCESS_RETRY_MS * 2);
    expect(retries).toEqual([]);
  });
});
