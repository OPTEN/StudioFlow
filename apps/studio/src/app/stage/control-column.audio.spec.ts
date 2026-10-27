import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type { GraphLevels, AudioGraphState } from '@studioflow/media-client/device';
import { FakeStudioHub, flushMicrotasks } from '../../testing/fake-studio-hub';
import { audioChannelFixture, snapshotFixture, sourceFixture } from '../../testing/fixtures';
import { startStore, studioTestProviders, type StoreHarness } from '../../testing/store-harness';
import {
  METER_INTERVAL_MS,
  STUDIO_MIX_FACTORY,
  type StudioMix,
} from '../core/audio/studio-audio.service';
import { StudioMediaService } from '../core/media/studio-media.service';
import { ControlColumnComponent } from './control-column.component';

const DESK = 'dev_cccccccccccccccc/mic';

class FakeMix implements StudioMix {
  state: AudioGraphState = 'running';
  program = -100;
  readonly resume = vi.fn(async (): Promise<AudioGraphState> => this.state);
  onStateChange(): () => void {
    return () => undefined;
  }
  setInput(): void {}
  hasInput(): boolean {
    return false;
  }
  apply(): void {}
  levels(): GraphLevels {
    return { channels: new Map(), program: this.program };
  }
  setMonitor(): void {}
  setSinkId(): Promise<boolean> {
    return Promise.resolve(false);
  }
  canChooseOutputDevice = false;
  dispose(): void {}
}

describe('ControlColumnComponent: level of the program sound', () => {
  let harness: StoreHarness;
  let fixture: ComponentFixture<ControlColumnComponent>;
  let element: HTMLElement;
  let mix: FakeMix;

  async function setup(withChannels: boolean): Promise<void> {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    const hub = new FakeStudioHub();
    mix = new FakeMix();
    TestBed.configureTestingModule({
      providers: [
        ...studioTestProviders(hub),
        { provide: STUDIO_MIX_FACTORY, useValue: () => mix },
        { provide: StudioMediaService, useValue: { provider: signal(null) } },
      ],
    });
    harness = await startStore(
      hub,
      snapshotFixture({
        sources: [sourceFixture('dev_cccccccccccccccc', 'mic', 'A1')],
        audioChannels: withChannels ? [audioChannelFixture(DESK, { mode: 'always' })] : [],
      }),
    );
    fixture = TestBed.createComponent(ControlColumnComponent);
    element = fixture.nativeElement as HTMLElement;
    await render();
  }

  async function render(): Promise<void> {
    await flushMicrotasks();
    fixture.detectChanges();
    await fixture.whenStable();
  }

  async function tick(ms = METER_INTERVAL_MS): Promise<void> {
    await vi.advanceTimersByTimeAsync(ms);
    await render();
  }

  function meter(): HTMLElement {
    return element.querySelector<HTMLElement>('[data-testid="program-meter"]') as HTMLElement;
  }

  afterEach(() => {
    harness.http.verify();
    TestBed.resetTestingModule();
    vi.useRealTimers();
  });

  it('shows no level for a production without audio channels', async () => {
    await setup(false);
    expect(element.querySelector('[data-testid="program-level"]')).toBeNull();
  });

  it('shows the peak of the program mix as a bar and in dB', async () => {
    await setup(true);
    expect(element.querySelector('.c-program-level .c-control-column__label')?.textContent).toBe(
      'Audio',
    );
    expect(element.querySelector('[data-testid="program-db"]')?.textContent).toBe('−∞ dB');

    mix.program = -30;
    await tick();
    expect(meter().style.transform).toBe('scaleX(0.5)');
    expect(element.querySelector('[data-testid="program-db"]')?.textContent).toBe('−30.0 dB');
    expect(meter().classList.contains('is-hot')).toBe(false);

    mix.program = -3;
    await tick();
    expect(meter().classList.contains('is-hot')).toBe(true);
  });

  it('lets the bar fall back after a peak', async () => {
    await setup(true);
    mix.program = -6;
    await tick();
    mix.program = -100;
    await tick(METER_INTERVAL_MS * 4);
    expect(element.querySelector('[data-testid="program-db"]')?.textContent).toBe('−12.0 dB');
  });
});
