import { TestBed } from '@angular/core/testing';
import { ApiError } from '../api/api-error';
import {
  TOAST_ERROR_MS,
  TOAST_MAX,
  TOAST_MS,
  TOAST_WITH_ACTION_MS,
  ToastService,
} from './toast.service';

describe('ToastService', () => {
  let toasts: ToastService;

  beforeEach(() => {
    vi.useFakeTimers();
    toasts = TestBed.inject(ToastService);
  });

  afterEach(() => vi.useRealTimers());

  it('queues toasts instead of replacing them and hides each one after 3.2 s', () => {
    toasts.show('First');
    vi.advanceTimersByTime(1000);
    toasts.show('Second');
    expect(toasts.toasts().map((toast) => toast.message)).toEqual(['First', 'Second']);
    expect(toasts.current()?.message).toBe('Second');
    vi.advanceTimersByTime(TOAST_MS - 1000);
    expect(toasts.toasts().map((toast) => toast.message)).toEqual(['Second']);
    vi.advanceTimersByTime(1000);
    expect(toasts.current()).toBeNull();
  });

  it('keeps at most three toasts; a fourth pushes the oldest out', () => {
    for (const message of ['A', 'B', 'C', 'D']) {
      toasts.show(message);
    }
    expect(toasts.toasts()).toHaveLength(TOAST_MAX);
    expect(toasts.toasts().map((toast) => toast.message)).toEqual(['B', 'C', 'D']);
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

  it('runs the action of an older toast by id, not the one of the newest', () => {
    const undo = vi.fn();
    toasts.show('Scenes is docked on the left', { label: 'Undo', run: undo });
    const moved = toasts.current();
    toasts.show('“Break” is live');
    toasts.runAction(moved?.id);
    expect(undo).toHaveBeenCalledOnce();
    expect(toasts.toasts().map((toast) => toast.message)).toEqual(['“Break” is live']);
  });

  it('dismisses one toast by id or all of them', () => {
    toasts.show('One');
    toasts.show('Two');
    toasts.dismiss(toasts.toasts()[0].id);
    expect(toasts.toasts().map((toast) => toast.message)).toEqual(['Two']);
    toasts.show('Three');
    toasts.dismiss();
    expect(toasts.toasts()).toEqual([]);
  });

  it('gives errors the error tone and 8 s to be read', () => {
    toasts.error(new ApiError({ status: 409, code: 'scene_is_live' }));
    expect(toasts.current()).toMatchObject({
      message: 'The live scene cannot be deleted.',
      kind: 'error',
    });
    vi.advanceTimersByTime(TOAST_ERROR_MS - 1);
    expect(toasts.current()).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(toasts.current()).toBeNull();
  });

  it('marks success and plain toasts with their kind', () => {
    toasts.success('Saved');
    expect(toasts.current()?.kind).toBe('success');
    toasts.show('A fade is still running');
    expect(toasts.current()?.kind).toBe('info');
  });

  it('holds every timer while the pointer or the focus is on the toasts', () => {
    toasts.show('Read me');
    vi.advanceTimersByTime(TOAST_MS - 100);
    toasts.hold(true);
    vi.advanceTimersByTime(TOAST_MS * 3);
    expect(toasts.current()?.message).toBe('Read me');
    toasts.hold(false);
    vi.advanceTimersByTime(TOAST_MS - 1);
    expect(toasts.current()).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(toasts.current()).toBeNull();
  });

  it('keeps one toast for a message that repeats while it is shown (no announcement storm)', () => {
    const unavailable = new ApiError({ status: 503, code: 'service_unavailable' });
    toasts.error(unavailable);
    const first = toasts.current();
    vi.advanceTimersByTime(TOAST_ERROR_MS - 100);
    toasts.error(unavailable);
    toasts.error(unavailable);
    expect(toasts.toasts()).toEqual([first]);
    expect(first?.message).toBe('The server is not reachable right now. Please try again shortly.');
    // The timer restarted with the repeat.
    vi.advanceTimersByTime(TOAST_ERROR_MS - 1);
    expect(toasts.current()).toBe(first);
    vi.advanceTimersByTime(1);
    expect(toasts.current()).toBeNull();
    // Once gone, the same message is a new toast (announced again).
    toasts.error(unavailable);
    expect(toasts.current()?.id).not.toBe(first?.id);
  });
});
