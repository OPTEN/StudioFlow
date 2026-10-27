import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  INPUT_LEVEL_INTERVAL_MS,
  INPUT_METER_FACTORY,
  InputLevelComponent,
  inputLevelFill,
  type InputMeter,
} from './input-level.component';

/** State a new meter starts in: the browser keeps a context created without a gesture suspended. */
let startState: AudioContextState = 'running';

class FakeMeter implements InputMeter {
  level = -100;
  disposed = false;
  state: AudioContextState = startState;
  readonly resume = vi.fn(() => Promise.resolve());
  get context(): Pick<AudioContext, 'state' | 'resume'> {
    return { state: this.state, resume: () => this.resume() } as Pick<
      AudioContext,
      'state' | 'resume'
    >;
  }
  read(): number {
    return this.level;
  }
  dispose(): void {
    this.disposed = true;
  }
}

@Component({
  selector: 'sf-host',
  imports: [InputLevelComponent],
  template: `<sf-input-level [stream]="stream()" (silent)="silent.set($event)" />`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class HostComponent {
  readonly stream = signal<MediaStream | null>(null);
  readonly silent = signal(false);
}

describe('inputLevelFill', () => {
  it('maps −60 dBFS to empty and 0 dBFS to full, and clamps', () => {
    expect(inputLevelFill(-60)).toBe(0);
    expect(inputLevelFill(-30)).toBe(0.5);
    expect(inputLevelFill(0)).toBe(1);
    expect(inputLevelFill(-100)).toBe(0);
    expect(inputLevelFill(6)).toBe(1);
  });
});

describe('InputLevelComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let element: HTMLElement;
  const stream = {} as MediaStream;
  const created: FakeMeter[] = [];

  function setup(factory?: (stream: MediaStream) => InputMeter | null): void {
    vi.useFakeTimers();
    created.length = 0;
    TestBed.configureTestingModule({
      providers: [
        {
          provide: INPUT_METER_FACTORY,
          useValue:
            factory ??
            (() => {
              const meter = new FakeMeter();
              created.push(meter);
              return meter;
            }),
        },
      ],
    });
    fixture = TestBed.createComponent(HostComponent);
    element = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  }

  async function show(): Promise<void> {
    fixture.componentInstance.stream.set(stream);
    fixture.detectChanges();
    await fixture.whenStable();
  }

  async function tick(ms = INPUT_LEVEL_INTERVAL_MS): Promise<void> {
    await vi.advanceTimersByTimeAsync(ms);
    fixture.detectChanges();
  }

  function bar(): HTMLElement {
    return element.querySelector('.c-level__bar') as HTMLElement;
  }

  function text(): string {
    return element.querySelector('[data-testid="input-level-db"]')?.textContent?.trim() ?? '';
  }

  afterEach(() => {
    startState = 'running';
    TestBed.resetTestingModule();
    vi.useRealTimers();
  });

  it('is empty and silent without a stream', () => {
    setup();

    expect(text()).toBe('−∞ dB');
    expect(['', 'scaleX(0)']).toContain(bar().style.transform);
    expect(created).toEqual([]);
  });

  it('draws the peak of the stream as a bar and in dB', async () => {
    setup();
    await show();
    created[0].level = -30;

    await tick();

    expect(bar().style.transform).toBe('scaleX(0.5)');
    expect(text()).toBe('-30 dB');
    expect(bar().classList.contains('is-hot')).toBe(false);
    expect(element.querySelector('[role="meter"]')?.getAttribute('aria-valuenow')).toBe('-30');
  });

  it('draws a peak close to clipping in red and lets the bar fall back afterwards', async () => {
    setup();
    await show();
    created[0].level = -1;
    await tick();
    expect(bar().classList.contains('is-hot')).toBe(true);

    created[0].level = -100;
    await tick(INPUT_LEVEL_INTERVAL_MS * 4);

    expect(bar().classList.contains('is-hot')).toBe(false);
    expect(text()).toBe('-7 dB');
  });

  it('says nothing about silence before 10 seconds, then reports it once, and clears it with the sound', async () => {
    setup();
    await show();

    await tick(9_000);
    expect(fixture.componentInstance.silent()).toBe(false);

    await tick(1_100);
    expect(fixture.componentInstance.silent()).toBe(true);

    created[0].level = -20;
    await tick();
    expect(fixture.componentInstance.silent()).toBe(false);
  });

  it('does not judge the silence while the audio context is suspended', async () => {
    startState = 'suspended';
    setup();
    await show();

    await tick(12_000);

    expect(fixture.componentInstance.silent()).toBe(false);
    expect(text()).toBe('−∞ dB');
  });

  it('asks the suspended context to start at once and again with the first touch of the page', async () => {
    startState = 'suspended';
    setup();
    await show();
    const meter = created[0];
    expect(meter.resume).toHaveBeenCalledTimes(1);

    document.dispatchEvent(new Event('pointerdown'));
    expect(meter.resume).toHaveBeenCalledTimes(2);

    fixture.componentInstance.stream.set(null);
    fixture.detectChanges();
    await fixture.whenStable();
    document.dispatchEvent(new Event('keydown'));
    expect(meter.resume).toHaveBeenCalledTimes(2);
  });

  it('gives the meter back when the stream goes away and measures a new stream with a new meter', async () => {
    setup();
    await show();
    created[0].level = -20;
    await tick();

    fixture.componentInstance.stream.set(null);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(created[0].disposed).toBe(true);
    expect(text()).toBe('−∞ dB');

    await show();
    expect(created).toHaveLength(2);
  });

  it('renders nothing measurable where the browser has no Web Audio', async () => {
    setup(() => null);

    await show();
    await tick(1000);

    expect(text()).toBe('−∞ dB');
  });
});
