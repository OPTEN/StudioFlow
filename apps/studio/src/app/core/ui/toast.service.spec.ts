import { TestBed } from '@angular/core/testing';
import { ApiError } from '../api/api-error';
import { TOAST_MS, TOAST_WITH_ACTION_MS, ToastService } from './toast.service';

describe('ToastService', () => {
  let toasts: ToastService;

  beforeEach(() => {
    vi.useFakeTimers();
    toasts = TestBed.inject(ToastService);
  });

  afterEach(() => vi.useRealTimers());

  it('shows one toast at a time and hides it after 3.2 s', () => {
    toasts.show('First');
    toasts.show('Second');
    expect(toasts.current()?.message).toBe('Second');
    vi.advanceTimersByTime(TOAST_MS - 1);
    expect(toasts.current()).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(toasts.current()).toBeNull();
  });

  it('keeps toasts with an action for 6 s and runs the action once', () => {
    const run = vi.fn();
    toasts.show('Removed', { label: 'Undo', run });
    vi.advanceTimersByTime(TOAST_MS);
    expect(toasts.current()?.action?.label).toBe('Undo');
    toasts.runAction();
    toasts.runAction();
    expect(run).toHaveBeenCalledTimes(1);
    expect(toasts.current()).toBeNull();
    toasts.show('Again', { label: 'x', run });
    vi.advanceTimersByTime(TOAST_WITH_ACTION_MS);
    expect(toasts.current()).toBeNull();
  });

  it('a newer toast is not hidden by the timer of an older one', () => {
    toasts.show('Old');
    vi.advanceTimersByTime(3000);
    toasts.show('New');
    vi.advanceTimersByTime(300);
    expect(toasts.current()?.message).toBe('New');
  });

  it('keeps one toast for a message that repeats while it is shown (no announcement storm)', () => {
    const unavailable = new ApiError({ status: 503, code: 'service_unavailable' });
    toasts.error(unavailable);
    const first = toasts.current();
    vi.advanceTimersByTime(TOAST_MS - 100);
    toasts.error(unavailable);
    toasts.error(unavailable);
    expect(toasts.current()).toBe(first);
    expect(first?.message).toBe('The server is not reachable right now. Please try again shortly.');
    // The timer restarted with the repeat.
    vi.advanceTimersByTime(TOAST_MS - 1);
    expect(toasts.current()).toBe(first);
    vi.advanceTimersByTime(1);
    expect(toasts.current()).toBeNull();
    // Once gone, the same message is a new toast (announced again).
    toasts.error(unavailable);
    expect(toasts.current()?.id).not.toBe(first?.id);
  });

  it('turns errors into English messages', () => {
    toasts.error(new ApiError({ status: 409, code: 'scene_is_live' }));
    expect(toasts.current()?.message).toBe('The live scene cannot be deleted.');
  });
});
