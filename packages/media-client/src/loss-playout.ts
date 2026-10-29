/**
 * The playout buffer of a receiver that sees packet loss. A frame with a missing packet waits for its retransmission, and the
 * decoder waits for that frame: a buffer of 50 ms is gone before the second try, so on a lossy link the picture stalls where
 * a buffer of a few hundred milliseconds would have bridged the gap. The buffer therefore grows with the loss and shrinks
 * again once the link is clean for a while, so that a clean link keeps its small delay.
 */

/** One step of the buffer: from this loss on (share of the packets, 0..1) the receiver buffers this long. */
interface LossLevel {
  readonly lossFrom: number;
  readonly jitterBufferTargetMs: number;
}

/** The steps, ascending; the first one is the clean link (the base target of the role). */
const LEVELS: readonly LossLevel[] = [
  { lossFrom: 0, jitterBufferTargetMs: 0 },
  { lossFrom: 0.02, jitterBufferTargetMs: 200 },
  { lossFrom: 0.1, jitterBufferTargetMs: 400 },
];

/** A level is left only when the loss is below half of what entered it, this many intervals in a row. */
const CALM_INTERVALS_TO_LEAVE = 5;

/**
 * Chooses the jitter buffer target of one receiver from the loss of every interval: up at once, down only after a calm
 * period (no flapping at a loss that hovers around a threshold). The clean level answers with the `base` the role wants.
 */
export class LossPlayout {
  #level = 0;
  #calm = 0;

  constructor(private readonly baseTargetMs: number) {}

  /** The target for the loss of the last interval (share of the packets, 0..1; undefined: nothing measured). */
  update(loss: number | undefined): number {
    if (loss !== undefined && Number.isFinite(loss)) {
      const wanted = LEVELS.reduce(
        (level, step, index) => (loss >= step.lossFrom ? index : level),
        0,
      );
      if (wanted > this.#level) {
        this.#level = wanted;
        this.#calm = 0;
      } else if (this.#level > 0 && loss < LEVELS[this.#level]!.lossFrom / 2) {
        this.#calm += 1;
        if (this.#calm >= CALM_INTERVALS_TO_LEAVE) {
          this.#level = wanted;
          this.#calm = 0;
        }
      } else {
        this.#calm = 0;
      }
    }
    return this.target;
  }

  /** The target now. */
  get target(): number {
    return Math.max(this.baseTargetMs, LEVELS[this.#level]!.jitterBufferTargetMs);
  }
}
