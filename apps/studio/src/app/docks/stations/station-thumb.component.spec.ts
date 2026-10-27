import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { StudioMediaService } from '../../core/media/studio-media.service';
import { StationThumbComponent } from './station-thumb.component';

/** IntersectionObserver whose reports a test drives. */
class FakeObserver {
  static instances: FakeObserver[] = [];
  disconnected = false;

  constructor(private readonly callback: IntersectionObserverCallback) {
    FakeObserver.instances.push(this);
  }

  observe(): void {}

  disconnect(): void {
    this.disconnected = true;
  }

  report(isIntersecting: boolean): void {
    this.callback(
      [{ isIntersecting } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
}

function setPageVisibility(state: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

function fakeProvider() {
  return {
    attach: vi.fn(),
    detach: vi.fn(),
    setDesiredSize: vi.fn(),
  };
}

@Component({
  imports: [StationThumbComponent],
  template: `<sf-station-thumb [sourceId]="sourceId()" [dimmed]="dimmed()" />`,
})
class HostComponent {
  readonly sourceId = signal<string | null>('dev_aaaaaaaaaaaaaaaa/camera');
  readonly dimmed = signal(false);
}

describe('StationThumbComponent', () => {
  let provider: ReturnType<typeof fakeProvider>;
  let providerSignal: ReturnType<typeof signal<ReturnType<typeof fakeProvider> | null>>;
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  async function render(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
  }

  function video(): HTMLVideoElement {
    return fixture.nativeElement.querySelector('video') as HTMLVideoElement;
  }

  async function setup(withProvider = true): Promise<void> {
    provider = fakeProvider();
    providerSignal = signal(withProvider ? provider : null);
    TestBed.configureTestingModule({
      providers: [{ provide: StudioMediaService, useValue: { provider: providerSignal } }],
    });
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    await render();
  }

  beforeEach(() => {
    FakeObserver.instances = [];
    vi.stubGlobal('IntersectionObserver', FakeObserver);
    vi.stubGlobal('devicePixelRatio', 2);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    setPageVisibility('visible');
    vi.unstubAllGlobals();
  });

  it('shows the source in a muted video and asks for a tiny layer at most at pixel ratio 1.5', async () => {
    await setup();

    expect(provider.attach).toHaveBeenCalledWith('dev_aaaaaaaaaaaaaaaa/camera', video());
    expect(video().muted).toBe(true);
    // 56 × 31.5 CSS px at 1.5 (a ratio of 2 is capped), in steps of 16.
    expect(provider.setDesiredSize).toHaveBeenCalledWith(
      'dev_aaaaaaaaaaaaaaaa/camera',
      expect.stringMatching(/^station-thumb-/),
      { width: 96, height: 48 },
    );
  });

  it('asks for nothing while the thumbnail cannot be seen, and again when it can', async () => {
    await setup();
    const consumer = provider.setDesiredSize.mock.calls[0][1] as string;
    provider.setDesiredSize.mockClear();

    FakeObserver.instances[0].report(false);
    await render();

    expect(provider.setDesiredSize).toHaveBeenCalledWith(
      'dev_aaaaaaaaaaaaaaaa/camera',
      consumer,
      null,
    );
    // The video stays attached: its last frame is kept, the source is only no longer requested.
    expect(provider.detach).not.toHaveBeenCalled();
    provider.setDesiredSize.mockClear();

    FakeObserver.instances[0].report(true);
    await render();

    expect(provider.setDesiredSize).toHaveBeenCalledWith('dev_aaaaaaaaaaaaaaaa/camera', consumer, {
      width: 96,
      height: 48,
    });
  });

  it('asks for nothing while the browser tab is in the background', async () => {
    await setup();
    provider.setDesiredSize.mockClear();

    setPageVisibility('hidden');
    await render();

    expect(provider.setDesiredSize).toHaveBeenLastCalledWith(
      'dev_aaaaaaaaaaaaaaaa/camera',
      expect.any(String),
      null,
    );
    setPageVisibility('visible');
    await render();
    expect(provider.setDesiredSize).toHaveBeenLastCalledWith(
      'dev_aaaaaaaaaaaaaaaa/camera',
      expect.any(String),
      { width: 96, height: 48 },
    );
  });

  it('starts hidden when the tab is in the background already', async () => {
    setPageVisibility('hidden');
    await setup();

    expect(provider.attach).toHaveBeenCalled();
    expect(provider.setDesiredSize).not.toHaveBeenCalled();
  });

  it('follows the source and gives it up when the thumbnail goes away', async () => {
    await setup();
    host.sourceId.set('dev_bbbbbbbbbbbbbbbb/screen-1');
    await render();

    expect(provider.detach).toHaveBeenCalledWith('dev_aaaaaaaaaaaaaaaa/camera', video());
    expect(provider.attach).toHaveBeenLastCalledWith('dev_bbbbbbbbbbbbbbbb/screen-1', video());

    fixture.destroy();

    expect(provider.detach).toHaveBeenLastCalledWith('dev_bbbbbbbbbbbbbbbb/screen-1', video());
    expect(provider.setDesiredSize).toHaveBeenLastCalledWith(
      'dev_bbbbbbbbbbbbbbbb/screen-1',
      expect.any(String),
      null,
    );
    expect(FakeObserver.instances[0].disconnected).toBe(true);
  });

  it('stays an empty well without media connection, and dims a source that is down', async () => {
    await setup(false);
    expect(provider.attach).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('.c-station-thumb__dim')).toBeNull();

    host.dimmed.set(true);
    await render();
    expect(fixture.nativeElement.querySelector('.c-station-thumb__dim')).not.toBeNull();

    providerSignal.set(provider);
    await render();
    expect(provider.attach).toHaveBeenCalledWith('dev_aaaaaaaaaaaaaaaa/camera', video());
  });
});
