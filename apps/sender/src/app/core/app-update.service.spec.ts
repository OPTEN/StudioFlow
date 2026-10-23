import { TestBed } from '@angular/core/testing';
import { SwUpdate, type VersionEvent } from '@angular/service-worker';
import { Subject } from 'rxjs';
import { AppUpdateService, PAGE_RELOAD } from './app-update.service';
import { LiveStateService } from './live-state.service';

describe('AppUpdateService', () => {
  let versionUpdates: Subject<VersionEvent>;
  let activateUpdate: ReturnType<typeof vi.fn>;
  let reload: ReturnType<typeof vi.fn>;

  function create(enabled = true): { service: AppUpdateService; live: LiveStateService } {
    vi.useFakeTimers();
    versionUpdates = new Subject<VersionEvent>();
    activateUpdate = vi.fn(() => Promise.resolve(true));
    reload = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: SwUpdate,
          useValue: {
            isEnabled: enabled,
            versionUpdates,
            unrecoverable: new Subject(),
            checkForUpdate: vi.fn(() => Promise.resolve(false)),
            activateUpdate,
          },
        },
        { provide: PAGE_RELOAD, useValue: reload },
      ],
    });
    return { service: TestBed.inject(AppUpdateService), live: TestBed.inject(LiveStateService) };
  }

  function versionReady(): void {
    versionUpdates.next({
      type: 'VERSION_READY',
      currentVersion: { hash: 'a' },
      latestVersion: { hash: 'b' },
    });
  }

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.useRealTimers();
  });

  it('activates and reloads a ready version when nothing is live', async () => {
    const { service } = create();

    versionReady();
    TestBed.tick();
    expect(service.updateReady()).toBe(true);
    await vi.advanceTimersByTimeAsync(5000);

    expect(activateUpdate).toHaveBeenCalled();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('waits while the station is on air and reloads once it is quiet again', async () => {
    const { service, live } = create();
    live.onAir.set(true);

    versionReady();
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(service.updateReady()).toBe(true);
    expect(reload).not.toHaveBeenCalled();

    live.onAir.set(false);
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(5000);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('never reloads during a screen share (it would need a new click)', async () => {
    const { live } = create();
    live.sharingScreen.set(true);

    versionReady();
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(reload).not.toHaveBeenCalled();
  });

  it('a short off-air moment is not enough', async () => {
    const { live } = create();
    live.onAir.set(true);
    versionReady();
    TestBed.tick();

    live.onAir.set(false);
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(2000);
    live.onAir.set(true);
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(reload).not.toHaveBeenCalled();
  });

  it('“Reload now” reloads at once', async () => {
    const { service, live } = create();
    live.onAir.set(true);
    versionReady();
    TestBed.tick();

    await service.reloadNow();

    expect(activateUpdate).toHaveBeenCalled();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('does nothing without a service worker (development)', async () => {
    const { service } = create(false);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(service.updateReady()).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
});
