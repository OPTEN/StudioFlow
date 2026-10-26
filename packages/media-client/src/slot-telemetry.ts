/**
 * Telemetry of one publisher slot for the device report (`SlotTelemetryDto`).
 */
import type { SlotState, SlotTelemetryDto } from '@studioflow/scene-model';
import type { LocalAudioTrack, LocalVideoTrack, VideoSenderStats } from 'livekit-client';
import { summarizeEncoder, type EncoderCapability, type EncoderSnapshot } from './encoder-info';
import { errorContext, type MediaLogger } from './logger';
import { summarizeSenderStats, type DeltaRatio } from './media-stats';

const UNKNOWN_ENCODER: EncoderSnapshot = { encoder: null, hardware: null, limitation: null };

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
 * capture settings before it is published), bitrate over all simulcast layers, codec, the encoder (hardware or
 * software, from the statistics or else from what the browser says about encoding that codec at that size) and the
 * reason for a quality limit (`cpu`: the computer cannot keep up). Numbers are null where unknown.
 */
export async function slotTelemetry(
  input: SlotTelemetryInput,
  loss: DeltaRatio,
  logger: MediaLogger,
  encoders?: EncoderCapability,
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
    encoder: null,
    hardwareEncoder: null,
    qualityLimitation: null,
  };
  if (track === null) {
    return empty;
  }
  let stats: VideoSenderStats[] = [];
  let encoder = UNKNOWN_ENCODER;
  if (published) {
    try {
      stats = await track.getSenderStats();
    } catch (error) {
      logger.warn('sender stats unavailable', errorContext(error));
    }
    try {
      const report = await track.getRTCStatsReport();
      encoder = report === undefined ? UNKNOWN_ENCODER : summarizeEncoder(report);
    } catch (error) {
      logger.warn('encoder stats unavailable', errorContext(error));
    }
  }
  const summary = summarizeSenderStats(stats, loss, track);
  const capture = summary.width === null ? captureSize(track.mediaStreamTrack) : null;
  const width = summary.width ?? capture?.width ?? null;
  const height = summary.height ?? capture?.height ?? null;
  const codec = track.codec ?? null;
  // The statistics may hide the encoder from a page (Chromium does so without active capture): ask the capabilities.
  const hardware =
    encoder.hardware ??
    (published ? await encoders?.hardwareOf(codec, width ?? 0, height ?? 0) : null) ??
    null;
  return {
    ...empty,
    width,
    height,
    fps: summary.fps ?? capture?.fps ?? null,
    packetLossPct: summary.packetLossPct,
    bitrateKbps: published ? Math.round(track.currentBitrate / 1000) : null,
    codec,
    encoder: encoder.encoder,
    hardwareEncoder: hardware,
    qualityLimitation: encoder.limitation,
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

/** What the telemetry of a microphone slot is computed from. */
export interface AudioSlotTelemetryInput {
  readonly slot: string;
  readonly state: SlotState;
  readonly track: LocalAudioTrack | null;
  /** True while the track is published in the current room (only then sender stats and bitrate exist). */
  readonly published: boolean;
}

/** Telemetry of a microphone: no picture, bitrate and loss of the sound from the sender statistics, codec Opus. */
export async function audioSlotTelemetry(
  input: AudioSlotTelemetryInput,
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
  if (track === null || !published) {
    return empty;
  }
  let packetLossPct: number | null = null;
  try {
    const stats = await track.getSenderStats();
    const ratio =
      stats === undefined
        ? undefined
        : loss.ratio(track, stats.packetsLost ?? 0, stats.packetsSent ?? 0);
    packetLossPct = ratio === undefined ? null : Math.round(ratio * 1000) / 10;
  } catch (error) {
    logger.warn('microphone sender stats unavailable', errorContext(error));
  }
  return {
    ...empty,
    packetLossPct,
    bitrateKbps: Math.round(track.currentBitrate / 1000),
    codec: 'opus',
  };
}
