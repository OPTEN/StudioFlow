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

  it('shows one toast at a time and hides it after 3,2 s', () => {
    toasts.show('Erste');
    toasts.show('Zweite');
    expect(toasts.current()?.message).toBe('Zweite');
    vi.advanceTimersByTime(TOAST_MS - 1);
    expect(toasts.current()).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(toasts.current()).toBeNull();
  });

  it('keeps toasts with an action for 6 s and runs the action once', () => {
    const run = vi.fn();
    toasts.show('Entfernt', { label: 'Rückgängig', run });
    vi.advanceTimersByTime(TOAST_MS);
    expect(toasts.current()?.action?.label).toBe('Rückgängig');
    toasts.runAction();
    toasts.runAction();
    expect(run).toHaveBeenCalledTimes(1);
    expect(toasts.current()).toBeNull();
    toasts.show('Wieder', { label: 'x', run });
    vi.advanceTimersByTime(TOAST_WITH_ACTION_MS);
    expect(toasts.current()).toBeNull();
  });

  it('a newer toast is not hidden by the timer of an older one', () => {
    toasts.show('Alt');
    vi.advanceTimersByTime(3000);
    toasts.show('Neu');
    vi.advanceTimersByTime(300);
    expect(toasts.current()?.message).toBe('Neu');
  });

  it('turns errors into German messages', () => {
    toasts.error(new ApiError({ status: 409, code: 'scene_is_live' }));
    expect(toasts.current()?.message).toBe('Die Live-Szene lässt sich nicht löschen.');
  });
});
