import type { DecoderSummary } from '@studioflow/media-client';
import type { OutputReport } from '@studioflow/scene-model';
import type { RendererStats } from '@studioflow/scene-renderer';

/** An interval with fewer frames says nothing about dropping (a still picture, the first seconds). */
const MIN_FRAMES = 15;

/** The load fields of an {@link OutputReport}. */
export type PlaybackLoadReport = Pick<
  OutputReport,
  'droppedFramesPct' | 'decodedStreams' | 'softwareDecodedStreams'
>;

/**
 * How well this machine keeps up with the pictures (issue #12, “nothing goes unnoticed”): the share of frames it dropped
 * since the previous report, from two sides – frames a video element could not present in time (its playback quality) and
 * frames the receiver dropped before or while decoding (WebRTC statistics) – and how many streams it decodes, how many
 * of them in software. The larger share counts: either one means the computer is too slow for what it shows.
 */
export class PlaybackLoad {
  #presented = 0;
  #dropped = 0;

  /**
   * One reading. `stats` carry cumulative counts (this keeps the previous ones and uses the difference), `decoders` the
   * counts of one interval, or null while the media side is not there.
   */
  measure(
    stats: Pick<RendererStats, 'presentedFrames' | 'droppedFrames'>,
    decoders: DecoderSummary | null,
  ): PlaybackLoadReport {
    const presented = Math.max(0, stats.presentedFrames - this.#presented);
    const dropped = Math.max(0, stats.droppedFrames - this.#dropped);
    this.#presented = stats.presentedFrames;
    this.#dropped = stats.droppedFrames;
    const shares: number[] = [];
    if (presented + dropped >= MIN_FRAMES) {
      shares.push(dropped / (presented + dropped));
    }
    if (decoders !== null && decoders.framesReceived >= MIN_FRAMES) {
      shares.push(decoders.framesDropped / decoders.framesReceived);
    }
    return {
      droppedFramesPct:
        shares.length === 0 ? null : Math.round(Math.min(1, Math.max(...shares)) * 1000) / 10,
      decodedStreams: decoders?.decoding ?? null,
      softwareDecodedStreams: decoders?.software ?? null,
    };
  }
}
