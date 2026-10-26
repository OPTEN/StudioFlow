/**
 * Gain ramps of the audio mix (spec 9.3, issue #7): a cut switches with a ramp of about 20 ms so the waveform does not
 * click, a fade crossfades with the duration of the fade. The ramps are scheduled on the `AudioParam` itself, so the
 * audio thread runs them sample-accurate whatever the main thread or its timers do (a background tab, a busy page).
 */

/** Shape of a ramp. */
export type RampCurve =
  /** Straight line from the current to the target value (small moves, 20 ms ramps). */
  | 'linear'
  /**
   * Constant power: a channel that comes in follows a quarter sine, one that goes out a quarter cosine, so two sources
   * that are crossfaded keep the same loudness in the middle (a linear fade of two unrelated signals dips by 3 dB).
   * Moves between two audible levels stay linear.
   */
  | 'equal-power';

/** Points of a value curve: dense enough to be smooth over the longest fade (2 s), cheap to build. */
const CURVE_POINTS = 64;

/** Below this duration a change is a plain step (the audio thread cannot ramp faster than one render quantum anyway). */
const MIN_RAMP_SECONDS = 0.002;

/** The value curve of a ramp from `from` to `to` with the shape of {@link RampCurve}. */
export function rampCurve(from: number, to: number, curve: RampCurve): Float32Array {
  const values = new Float32Array(CURVE_POINTS);
  const comingIn = from <= 0 && to > 0;
  const goingOut = from > 0 && to <= 0;
  for (let i = 0; i < CURVE_POINTS; i += 1) {
    const x = i / (CURVE_POINTS - 1);
    if (curve === 'equal-power' && comingIn) {
      values[i] = to * Math.sin((x * Math.PI) / 2);
    } else if (curve === 'equal-power' && goingOut) {
      values[i] = from * Math.cos((x * Math.PI) / 2);
    } else {
      values[i] = from + (to - from) * x;
    }
  }
  // Land exactly on the target, whatever rounding the trigonometry did.
  values[CURVE_POINTS - 1] = Math.max(0, to);
  return values;
}

/**
 * Moves `param` from its current value to `target` over `durationSeconds`, starting at `now` (the context's current
 * time). Whatever was scheduled before is replaced; the current value is the start of the new ramp, so a move that
 * interrupts another one (a fader dragged during a fade) continues without a jump.
 */
export function rampParam(
  param: AudioParam,
  target: number,
  now: number,
  durationSeconds: number,
  curve: RampCurve,
): void {
  const from = param.value;
  // Cancelling also cancels a ramp in progress and restores the value from before it; the step below (or the first
  // point of the curve) puts the value we read back at once, so an interrupted move continues without a jump.
  param.cancelScheduledValues(now);
  if (durationSeconds < MIN_RAMP_SECONDS || from === target) {
    param.setValueAtTime(target, now);
    return;
  }
  if (curve === 'linear') {
    param.setValueAtTime(from, now);
    param.linearRampToValueAtTime(target, now + durationSeconds);
    return;
  }
  // No step at the start time: a value curve may not overlap other events, and its first point is `from` anyway.
  param.setValueCurveAtTime(rampCurve(from, target, curve), now, durationSeconds);
}
