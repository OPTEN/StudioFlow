import { TestBed } from '@angular/core/testing';
import { LiveAnnouncerService } from './live-announcer.service';

describe('LiveAnnouncerService', () => {
  let announcer: LiveAnnouncerService;

  function region(): HTMLElement | null {
    return document.body.querySelector<HTMLElement>('[aria-live="assertive"]');
  }

  beforeEach(() => {
    vi.useFakeTimers();
    announcer = TestBed.inject(LiveAnnouncerService);
  });

  afterEach(() => {
    vi.useRealTimers();
    TestBed.resetTestingModule();
  });

  it('creates one hidden assertive status region on the first announcement', () => {
    expect(region()).toBeNull();
    announcer.announce('Moved to position 2 of 5');
    announcer.announce('Moved to position 3 of 5');
    expect(document.body.querySelectorAll('[aria-live="assertive"]')).toHaveLength(1);
    expect(region()?.getAttribute('role')).toBe('status');
    expect(region()?.classList.contains('u-sr-only')).toBe(true);
  });

  it('shows the text after a short pause and replaces an unread one', () => {
    announcer.announce('first');
    announcer.announce('second');
    expect(region()?.textContent).toBe('');
    vi.advanceTimersByTime(40);
    expect(region()?.textContent).toBe('second');
  });

  it('announces the same text twice by emptying the region in between', () => {
    announcer.announce('same');
    vi.advanceTimersByTime(40);
    announcer.announce('same');
    expect(region()?.textContent).toBe('');
    vi.advanceTimersByTime(40);
    expect(region()?.textContent).toBe('same');
  });

  it('removes the region with the service', () => {
    announcer.announce('x');
    TestBed.resetTestingModule();
    expect(region()).toBeNull();
  });
});
