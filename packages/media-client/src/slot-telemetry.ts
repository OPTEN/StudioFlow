/**
 * Telemetry of one publisher slot for the device report (`SlotTelemetryDto`).
 */
import type { SlotState, SlotTelemetryDto } from '@flowstudio/scene-model';
import type { LocalVideoTrack, VideoSenderStats } from 'livekit-client';
import { errorContext, type MediaLogger } from './logger';
import { summarizeSenderStats, type DeltaRatio } from './media-stats';

/** What the telemetry of a slot is computed from. */
export interface SlotTelemetryInput {
  readonly slot: string;
  readonly state: SlotState;
  readonly track: LocalVideoTrack | null;
  /** True while the track is published in the current room (only then sender stats and bitrate exist). */
  readonly published: boolean;
}

/**
 * Builds the telemetry: resolution, fps and loss from the sender statistics of a published track (falling back to the
 * capture settings before it is published), bitrate over all simulcast layers, codec. Numbers are null where unknown.
 */
export async function slotTelemetry(
  input: SlotTelemetryInput,
  loss: DeltaRatio,
  logger: MediaLogger,
): Promise<SlotTelemetryDto> {
  const { slot, state, track, published } = input;
  const empty: SlotTelemetryDto = {
    slot,
    state,
    width: null,
    height: null,
    fps: null,
    bitrateKbps: null,
    packetLossPct: null,
    codec: null,
  };
  if (track === null) {
    return empty;
  }
  let stats: VideoSenderStats[] = [];
  if (published) {
    try {
      stats = await track.getSenderStats();
    } catch (error) {
      logger.warn('sender stats unavailable', errorContext(error));
    }
  }
  const summary = summarizeSenderStats(stats, loss, track);
  const capture = summary.width === null ? captureSize(track.mediaStreamTrack) : null;
  return {
    ...empty,
    width: summary.width ?? capture?.width ?? null,
    height: summary.height ?? capture?.height ?? null,
    fps: summary.fps ?? capture?.fps ?? null,
    packetLossPct: summary.packetLossPct,
    bitrateKbps: published ? Math.round(track.currentBitrate / 1000) : null,
    codec: track.codec ?? null,
  };
}

/** Capture size of a local track from its settings. */
function captureSize(track: MediaStreamTrack): {
  width: number | null;
  height: number | null;
  fps: number | null;
} {
  try {
    const { width, height, frameRate } = track.getSettings();
    return {
      width: width ?? null,
      height: height ?? null,
      fps: frameRate === undefined ? null : Math.round(frameRate * 10) / 10,
    };
  } catch {
    return { width: null, height: null, fps: null };
  }
}
