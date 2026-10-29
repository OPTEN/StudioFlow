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

/** Marks of the scale under the meter of the audio station (dBFS). */
const SCALE_MARKS = [-60, -40, -20, -10, -3, 0] as const;
/** The peak hold mark stays this long before it follows the level down. */
const PEAK_HOLD_MS = 1500;

/**
 * Level of the microphone before it is sent: a bar with the peak in dB, red close to clipping. After 10 seconds without
 * signal it says so (`silent`), because a cable that fell out of the mixing desk is the most common failure. The
 * browser keeps a new audio context suspended until the person has touched the page; the bar stays empty, a hint says
 * how to start it, and the silence is not judged until then. With `scale` (the audio station) the meter is taller and
 * has a dB scale and a peak hold mark.
 */
@Component({
  selector: 'sf-input-level',
  template: `
    <div class="c-level-row">
      <div
        class="c-level"
        [class.has-scale]="scale()"
        role="meter"
        aria-valuemin="-60"
        aria-valuemax="0"
        [attr.aria-valuenow]="valueNow()"
        [attr.aria-label]="t('sender.audio.level')"
        data-testid="input-level"
      >
        <div class="c-level__bar" [class.is-hot]="hot()" #bar></div>
        @if (scale()) {
          <div class="c-level__peak" [class.is-hot]="hot()" #peak></div>
        }
      </div>
      <span class="c-level__db u-mono" data-testid="input-level-db">{{ text() }}</span>
    </div>
    @if (scale()) {
      <div class="c-level__scale" aria-hidden="true">
        @for (mark of marks; track mark) {
          <span class="c-level__mark u-mono" [style.left.%]="markAt(mark)">{{ mark }}</span>
        }
      </div>
    }
    @if (suspended()) {
      <p class="c-level__hint" role="status">{{ t('sender.audio.level.suspended') }}</p>
    }
  `,
  styles: `
    :host {
      display: grid;
      gap: 6px;
    }

    .c-level-row {
      align-items: center;
      display: flex;
      gap: 12px;
    }

    .c-level {
      background: var(--fill);
      border-radius: var(--radius-pill);
      flex: 1 1 auto;
      height: 10px;
      overflow: hidden;
      position: relative;

      &.has-scale {
        border-radius: var(--radius-xs);
        height: 16px;
      }
    }

    .c-level__bar {
      background: var(--green);
      height: 100%;
      transform: scaleX(0);
      transform-origin: left center;
      transition: transform 50ms linear;
      width: 100%;

      &.is-hot {
        background: var(--red);
      }
    }

    .c-level__peak {
      background: var(--text);
      bottom: 0;
      left: 0;
      position: absolute;
      top: 0;
      width: 2px;

      &.is-hot {
        background: var(--red);
      }
    }

    .c-level__db {
      color: var(--text-2);
      flex: none;
      font-size: var(--fs-subhead);
      min-width: 8ch;
      text-align: right;
    }

    .c-level__scale {
      height: 18px;
      margin-right: calc(8ch + 12px);
      position: relative;
    }

    .c-level__mark {
      color: var(--muted);
      font-size: var(--fs-caption);
      position: absolute;
      top: 0;
      transform: translateX(-50%);

      &:first-child {
        transform: none;
      }

      &:last-child {
        transform: translateX(-100%);
      }
    }

    .c-level__hint {
      color: var(--amber);
      font-size: var(--fs-footnote);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InputLevelComponent {
  /** The stream to measure (null: nothing is measured and the bar is empty). */
  readonly stream = input<MediaStream | null>(null);
  /** A taller meter with a dB scale and a peak hold mark (the audio station). */
  readonly scale = input(false);
  /** True while the stream has been silent for 10 seconds, false when sound returns or nothing is measured. */
  readonly silent = output<boolean>();

  protected readonly t = t;
  private readonly factory = inject(INPUT_METER_FACTORY);
  private readonly bar = viewChild<ElementRef<HTMLElement>>('bar');
  private readonly peakMark = viewChild<ElementRef<HTMLElement>>('peak');
  protected readonly marks = SCALE_MARKS;
  /** The audio context waits for a touch of the page; the bar stays empty until then. */
  protected readonly suspended = signal(false);
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
  private holdDb = FLOOR_DB - 40;
  private holdAt = 0;

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
    this.suspended.set(false);
    this.holdDb = FLOOR_DB - 40;
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
    this.suspended.set(!running);
    const level = running ? meter.read() : FLOOR_DB - 40;
    const shown = Math.max(level, this.peak() - FALL_DB_PER_TICK);
    this.peak.set(shown);
    this.hot.set(shown >= HOT_DB);
    const now = Date.now();
    if (shown >= this.holdDb || now - this.holdAt > PEAK_HOLD_MS) {
      this.holdDb = shown;
      this.holdAt = now;
    }
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
    const mark = this.peakMark()?.nativeElement;
    if (mark !== undefined) {
      mark.style.left = `${(inputLevelFill(this.holdDb) * 100).toFixed(1)}%`;
    }
  }

  /** Position of a scale mark in percent of the meter. */
  protected markAt(db: number): number {
    return inputLevelFill(db) * 100;
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
