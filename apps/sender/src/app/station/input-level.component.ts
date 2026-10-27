import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  InjectionToken,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { t } from '@studioflow/i18n';
import { StreamLevelMeter } from '@studioflow/media-client/device';
import { SilenceTracker } from '@studioflow/scene-model';

/** How often the meter reads the level. */
export const INPUT_LEVEL_INTERVAL_MS = 50;
/** The bar falls back this far per reading (30 dB a second). */
const FALL_DB_PER_TICK = 1.5;
/** The meter shows −60 dBFS (empty) to 0 dBFS (full). */
const FLOOR_DB = -60;
/** Peaks above this are drawn red: the input is close to clipping. */
const HOT_DB = -3;
/** Key of the one input in the {@link SilenceTracker}. */
const INPUT = 'input';

/** What the meter needs of a level reader (`StreamLevelMeter` in the browser). */
export interface InputMeter {
  readonly context: Pick<AudioContext, 'state' | 'resume'>;
  /** Peak level of the last ~85 ms in dBFS. */
  read(): number;
  dispose(): void;
}

/** Creates the level reader of a stream, or null where the browser has no Web Audio. Replaced in tests. */
export const INPUT_METER_FACTORY = new InjectionToken<(stream: MediaStream) => InputMeter | null>(
  'INPUT_METER_FACTORY',
  {
    providedIn: 'root',
    factory: () => (stream) => {
      if (typeof AudioContext === 'undefined') {
        return null;
      }
      try {
        return new StreamLevelMeter(stream);
      } catch {
        return null;
      }
    },
  },
);

/** The fill of the bar (0 to 1) for a peak level in dBFS. */
export function inputLevelFill(levelDb: number): number {
  return Math.min(1, Math.max(0, (levelDb - FLOOR_DB) / -FLOOR_DB));
}

/**
 * Level of the microphone before it is sent: a bar with the peak in dB, red close to clipping. After 10 seconds without
 * signal it says so (`silent`), because a cable that fell out of the mixing desk is the most common failure. The
 * browser keeps a new audio context suspended until the person has touched the page; the bar stays empty and the
 * silence is not judged until then.
 */
@Component({
  selector: 'sf-input-level',
  template: `
    <div
      class="c-level"
      role="meter"
      aria-valuemin="-60"
      aria-valuemax="0"
      [attr.aria-valuenow]="valueNow()"
      [attr.aria-label]="t('sender.audio.level')"
      data-testid="input-level"
    >
      <div class="c-level__bar" [class.is-hot]="hot()" #bar></div>
    </div>
    <span class="c-level__db u-mono" data-testid="input-level-db">{{ text() }}</span>
  `,
  styles: `
    :host {
      align-items: center;
      display: flex;
      gap: 12px;
    }

    .c-level {
      background: var(--raised-2);
      border-radius: 3px;
      flex: 1 1 auto;
      height: 10px;
      overflow: hidden;
    }

    .c-level__bar {
      background: var(--text-2);
      height: 100%;
      transform: scaleX(0);
      transform-origin: left center;
      transition: transform 50ms linear;
      width: 100%;

      &.is-hot {
        background: var(--red);
      }

      @media (prefers-reduced-motion: reduce) {
        transition: none;
      }
    }

    .c-level__db {
      color: var(--text-2);
      flex: none;
      font-size: 14px;
      min-width: 6ch;
      text-align: right;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InputLevelComponent {
  /** The stream to measure (null: nothing is measured and the bar is empty). */
  readonly stream = input<MediaStream | null>(null);
  /** True while the stream has been silent for 10 seconds, false when sound returns or nothing is measured. */
  readonly silent = output<boolean>();

  protected readonly t = t;
  private readonly factory = inject(INPUT_METER_FACTORY);
  private readonly bar = viewChild<ElementRef<HTMLElement>>('bar');
  private readonly peak = signal(FLOOR_DB - 40);
  protected readonly hot = signal(false);
  protected readonly valueNow = computed(() => Math.round(Math.max(FLOOR_DB, this.peak())));
  protected readonly text = computed(() => {
    const level = this.peak();
    return level <= FLOOR_DB
      ? t('sender.audio.level.silent')
      : t('sender.audio.level.value', { db: Math.round(level) });
  });

  private meter: InputMeter | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private stopGesture: (() => void) | null = null;
  private tracker = new SilenceTracker();
  private reportedSilent = false;

  constructor() {
    effect(() => {
      const stream = this.stream();
      untracked(() => {
        this.detach();
        if (stream !== null) {
          this.attach(stream);
        }
      });
    });
    inject(DestroyRef).onDestroy(() => this.release());
  }

  private attach(stream: MediaStream): void {
    const meter = this.factory(stream);
    if (meter === null) {
      return;
    }
    this.meter = meter;
    this.tracker = new SilenceTracker();
    // A new measurement starts without a silence warning, whatever the parent still shows from the one before.
    this.reportedSilent = false;
    this.silent.emit(false);
    this.resumeOnGesture(meter);
    this.timer = setInterval(() => this.tick(), INPUT_LEVEL_INTERVAL_MS);
  }

  /** Stops the measurement and tells that the silence is over (the stream changed). */
  private detach(): void {
    this.release();
    this.peak.set(FLOOR_DB - 40);
    this.hot.set(false);
    this.setBar(0);
    this.setSilent(false);
  }

  /** Gives the timer, the listeners and the audio context back (also when the component is destroyed). */
  private release(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.stopGesture?.();
    this.stopGesture = null;
    this.meter?.dispose();
    this.meter = null;
  }

  private tick(): void {
    const meter = this.meter;
    if (meter === null) {
      return;
    }
    const running = meter.context.state === 'running';
    const level = running ? meter.read() : FLOOR_DB - 40;
    const shown = Math.max(level, this.peak() - FALL_DB_PER_TICK);
    this.peak.set(shown);
    this.hot.set(shown >= HOT_DB);
    this.setBar(inputLevelFill(shown));
    const silent = this.tracker.update(Date.now(), [
      { sourceId: INPUT, audible: running, hasSound: true, levelDb: level },
    ]);
    this.setSilent(silent.has(INPUT));
  }

  private setSilent(silent: boolean): void {
    if (silent !== this.reportedSilent) {
      this.reportedSilent = silent;
      this.silent.emit(silent);
    }
  }

  private setBar(fill: number): void {
    const element = this.bar()?.nativeElement;
    if (element !== undefined) {
      element.style.transform = `scaleX(${fill})`;
    }
  }

  /** A new audio context starts suspended until the person touched the page; the first touch starts it. */
  private resumeOnGesture(meter: InputMeter): void {
    if (meter.context.state === 'running') {
      return;
    }
    void Promise.resolve(meter.context.resume()).catch(() => undefined);
    const resume = (): void => {
      if (meter.context.state !== 'running') {
        void Promise.resolve(meter.context.resume()).catch(() => undefined);
      }
    };
    const events = ['pointerdown', 'keydown'] as const;
    for (const name of events) {
      document.addEventListener(name, resume, { passive: true });
    }
    this.stopGesture = () => {
      for (const name of events) {
        document.removeEventListener(name, resume);
      }
    };
  }
}
