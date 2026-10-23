import type { OutputPage, LatencySample } from '../ui/output';
import { OutputProbe, type VideoFrameEntry } from './probe';
import { summarize, type Summary } from './stats';

/**
 * Glass-to-glass latency over a longer time with the stamp codec (`?latency=1`, docs/testing.md E2E-OUT-13): the output
 * page keeps at most 1000 samples (33 s at 30 fps), so the array is drained every few seconds and de-duplicated by the
 * frame's display time.
 */

/**
 * VP9 screen content: the stamp blocks of the high-order bits only change every 2^k ms, and the encoder refreshes a changed
 * block of static-looking content a frame or two late, so for 1-3 frames after such a change the decoder reads the OLD
 * bit: the decoded stamp is older by exactly 2^k ms (1.0 s, 4.1 s ... while the neighbouring frames, 33 ms apart, read about
 * 60 ms; the stream itself decodes at a steady 30 fps with a 31 ms jitter buffer and no freeze). The error is one-sided - it
 * only ever makes a frame look older - so the true latency is the smallest value of the neighbouring frames. This replaces
 * each sample by the minimum of the samples within `radius` frames; a real latency change moves all neighbours and passes.
 * Camera streams (every block is coded every frame) show no such lag and are not filtered.
 */
export function lagFilter(samples: readonly LatencySample[], radius = 6): { filtered: LatencySample[]; lagging: number } {
  const ordered = [...samples].sort((a, b) => a.at - b.at);
  let lagging = 0;
  const filtered = ordered.map((sample, index) => {
    let minimum = sample.latencyMs;
    for (let other = Math.max(0, index - radius); other <= Math.min(ordered.length - 1, index + radius); other++) minimum = Math.min(minimum, ordered[other]!.latencyMs);
    if (sample.latencyMs - minimum > 100) lagging += 1;
    return { ...sample, latencyMs: minimum };
  });
  return { filtered, lagging };
}

export interface LatencyRun {
  /** Decoded samples (with `lagFilter`: after the one-sided lag correction of {@link lagFilter}). */
  samples: LatencySample[];
  /** Statistics of {@link samples}. */
  stats: Summary;
  /** Statistics of what the page decoded, uncorrected. */
  rawStats: Summary;
  /** Frames whose decoded stamp lagged by more than 100 ms behind their neighbours (only with `lagFilter`). */
  dropped: number;
  /** Frames the video presented in the window (requestVideoFrameCallback) and how many of them could not be decoded. */
  presented: number;
  undecoded: number;
  /** Stamps (frame time minus latency) that go backwards: out-of-order or wrongly decoded frames. */
  backwardsStamps: number;
  widths: number[];
  windowMs: number;
}

/** Collects for `durationMs` after `warmupMs`; `onPoll` runs between the drains (e.g. a scene switch). */
export async function collectLatencyRun(
  output: OutputPage,
  options: { durationMs: number; warmupMs?: number; sourceId?: string; lagFilter?: boolean; onPoll?: (elapsedMs: number) => Promise<void> | void; pollMs?: number },
): Promise<LatencyRun> {
  const probe = new OutputProbe(output);
  const poll = options.pollMs ?? 3000;
  const origin = await probe.timeOrigin();
  const seen = new Set<string>();
  const samples: LatencySample[] = [];
  const started = Date.now();
  const warmup = options.warmupMs ?? 5000;
  let windowStart = 0;
  let logging = false;
  const drain = async () => {
    for (const sample of await output.latencySamples()) {
      const key = `${sample.sourceId}:${sample.at}`;
      if (seen.has(key)) continue;
      seen.add(key);
      // The sample's own time (not the time of the drain) decides whether it belongs to the window.
      if (windowStart > 0 && origin + sample.at >= windowStart && (!options.sourceId || sample.sourceId === options.sourceId)) samples.push(sample);
    }
  };
  while (Date.now() - started < warmup + options.durationMs) {
    if (!logging && Date.now() - started >= warmup) {
      logging = true;
      windowStart = Date.now();
      await probe.startFrameLog();
    }
    await drain();
    await options.onPoll?.(Date.now() - started);
    await new Promise((resolve) => setTimeout(resolve, poll));
  }
  await drain();
  const log: VideoFrameEntry[] = await probe.stopFrameLog();
  const windowMs = Date.now() - windowStart;
  const finite = samples.filter((sample) => Number.isFinite(sample.latencyMs));
  const corrected = options.lagFilter ? lagFilter(finite) : { filtered: finite, lagging: 0 };
  const kept = corrected.filtered;
  const dropped = { length: corrected.lagging };
  const ordered = [...kept].sort((a, b) => a.at - b.at);
  let backwards = 0;
  for (let index = 1; index < ordered.length; index++) {
    const previous = ordered[index - 1]!.at - ordered[index - 1]!.latencyMs;
    const current = ordered[index]!.at - ordered[index]!.latencyMs;
    if (current < previous - 1) backwards += 1;
  }
  return {
    samples: kept,
    stats: summarize(kept.map((sample) => sample.latencyMs)),
    rawStats: summarize(finite.map((sample) => sample.latencyMs)),
    dropped: dropped.length,
    presented: log.length,
    undecoded: Math.max(0, log.length - finite.length),
    backwardsStamps: backwards,
    widths: [...new Set(finite.map((sample) => sample.width))].sort((a, b) => a - b),
    windowMs,
  };
}
