/** Window over which frames are counted. */
const WINDOW_MS = 1000;
/** The measuring loop stops when nobody asked for the value for this long (it restarts on the next request). */
const IDLE_STOP_MS = 10_000;

/**
 * Measures the page's animation frame rate with `requestAnimationFrame`, but only while someone reads it (the output
 * reports it every 2 s); an unread meter costs nothing.
 */
export class FpsMeter {
  private frames: number[] = [];
  private handle: number | null = null;
  private lastReadAt = 0;
  private disposed = false;

  /** Current frames per second (0 until a full window was measured or when frames do not run, e.g. hidden tab). */
  read(): number {
    if (this.disposed || typeof requestAnimationFrame !== 'function') {
      return 0;
    }
    this.lastReadAt = performance.now();
    if (this.handle === null) {
      this.frames = [];
      this.handle = requestAnimationFrame(this.onFrame);
      return 0;
    }
    this.dropOldFrames(this.lastReadAt);
    return this.frames.length;
  }

  /** Stops measuring for good. */
  dispose(): void {
    this.disposed = true;
    this.stop();
  }

  private readonly onFrame = (): void => {
    this.handle = null;
    if (this.disposed) {
      return;
    }
    // performance.now() rather than the callback timestamp: one time base with `read()`, also under fake timers.
    const at = performance.now();
    if (at - this.lastReadAt > IDLE_STOP_MS) {
      this.frames = [];
      return;
    }
    this.frames.push(at);
    this.dropOldFrames(at);
    this.handle = requestAnimationFrame(this.onFrame);
  };

  private dropOldFrames(at: number): void {
    const oldest = at - WINDOW_MS;
    let index = 0;
    while (index < this.frames.length && this.frames[index] <= oldest) {
      index += 1;
    }
    if (index > 0) {
      this.frames.splice(0, index);
    }
  }

  private stop(): void {
    if (this.handle !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(this.handle);
    }
    this.handle = null;
  }
}
