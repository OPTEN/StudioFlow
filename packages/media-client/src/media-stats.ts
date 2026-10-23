/**
 * Pure helpers that turn WebRTC statistics into the numbers StudioFlow shows (output debug overlay, monitoring,
 * device reports). Statistics objects are read defensively: every field is optional and browser-specific.
 */
import type { VideoSenderStats } from 'livekit-client';

type StatsRecord = Readonly<Record<string, unknown>>;

/** Anything that can enumerate RTC stats entries (`RTCStatsReport` or a plain `Map` in tests). */
export interface StatsSource {
  forEach(callback: (value: unknown, key: string) => void): void;
}

/** What the receiver side of one track reports. */
export interface ReceiverSnapshot {
  readonly width?: number;
  readonly height?: number;
  readonly fps?: number;
  readonly packetLossPct?: number;
  readonly jitterBufferDelayMs?: number;
  readonly codec?: string;
  readonly rttMs?: number;
}

/** What the sender side of one (simulcast) track reports. */
export interface SenderSnapshot {
  readonly width: number | null;
  readonly height: number | null;
  readonly fps: number | null;
  readonly packetLossPct: number | null;
}

function isRecord(value: unknown): value is StatsRecord {
  return typeof value === 'object' && value !== null;
}

function numberField(record: StatsRecord | undefined, key: string): number | undefined {
  const value = record?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function stringField(record: StatsRecord | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** Copies a stats report into a map of records (non-object entries are skipped). */
export function indexStats(source: StatsSource): ReadonlyMap<string, StatsRecord> {
  const index = new Map<string, StatsRecord>();
  source.forEach((value, key) => {
    if (isRecord(value)) {
      index.set(key, value);
    }
  });
  return index;
}

function findAll(index: ReadonlyMap<string, StatsRecord>, type: string): StatsRecord[] {
  return [...index.values()].filter((record) => record['type'] === type);
}

/** The inbound video RTP stream of a receiver report (the one with the most received bytes if several exist). */
export function inboundVideo(index: ReadonlyMap<string, StatsRecord>): StatsRecord | undefined {
  return findAll(index, 'inbound-rtp')
    .filter((record) => record['kind'] === 'video' || record['mediaType'] === 'video')
    .reduce<StatsRecord | undefined>(
      (best, record) =>
        best === undefined ||
        (numberField(record, 'bytesReceived') ?? 0) > (numberField(best, 'bytesReceived') ?? 0)
          ? record
          : best,
      undefined,
    );
}

/** Lower-case codec name (`h264`, `vp9` …) of an RTP stream, from its codec entry's MIME type. */
export function codecOf(
  index: ReadonlyMap<string, StatsRecord>,
  rtp: StatsRecord,
): string | undefined {
  const codecId = stringField(rtp, 'codecId');
  const mimeType = stringField(codecId === undefined ? undefined : index.get(codecId), 'mimeType');
  const subtype = mimeType?.split('/')[1];
  return subtype === undefined || subtype === '' ? undefined : subtype.toLowerCase();
}

/**
 * Current round-trip time in ms of the transport: the selected ICE candidate pair (via the transport entry, or the pair
 * flagged `selected` / nominated and succeeded), falling back to the RTCP-based `remote-outbound-rtp` value.
 */
export function roundTripTimeMs(index: ReadonlyMap<string, StatsRecord>): number | undefined {
  const selectedIds = findAll(index, 'transport')
    .map((transport) => stringField(transport, 'selectedCandidatePairId'))
    .filter((id): id is string => id !== undefined);
  const pairs = findAll(index, 'candidate-pair');
  const selected =
    selectedIds.map((id) => index.get(id)).find(isRecord) ??
    pairs.find((pair) => pair['selected'] === true) ??
    pairs.find((pair) => pair['nominated'] === true && pair['state'] === 'succeeded');
  const seconds =
    numberField(selected, 'currentRoundTripTime') ??
    findAll(index, 'remote-outbound-rtp')
      .map((record) => numberField(record, 'roundTripTime'))
      .find((value) => value !== undefined);
  return seconds === undefined ? undefined : seconds * 1000;
}

/**
 * Ratio of two cumulative counters over the interval since the previous call for the same key (e.g. lost / sent
 * packets). The first call (and a counter reset) uses the cumulative values; an interval without new denominator
 * counts repeats the previous ratio. Keys are held weakly, so finished tracks do not leak.
 */
export class DeltaRatio {
  readonly #previous = new WeakMap<
    object,
    { numerator: number; denominator: number; ratio: number | undefined }
  >();

  /** Returns the ratio (≥ 0) or undefined when nothing was counted yet. */
  ratio(key: object, numerator: number, denominator: number): number | undefined {
    const previous = this.#previous.get(key);
    let ratio: number | undefined;
    if (
      previous !== undefined &&
      denominator > previous.denominator &&
      numerator >= previous.numerator
    ) {
      ratio = (numerator - previous.numerator) / (denominator - previous.denominator);
    } else if (previous !== undefined && denominator === previous.denominator) {
      ratio = previous.ratio;
    } else {
      ratio = denominator > 0 ? numerator / denominator : undefined;
    }
    const clamped = ratio === undefined ? undefined : Math.max(0, ratio);
    this.#previous.set(key, { numerator, denominator, ratio: clamped });
    return clamped;
  }
}

/** Reads receiver reports of remote video tracks; keeps per-track counters for interval-based loss and buffer delay. */
export class ReceiverStatsReader {
  readonly #loss = new DeltaRatio();
  readonly #jitterBuffer = new DeltaRatio();

  /** Summarizes one report of the track identified by `key`. */
  read(key: object, report: StatsSource): ReceiverSnapshot {
    const index = indexStats(report);
    const inbound = inboundVideo(index);
    const rttMs = roundTripTimeMs(index);
    if (inbound === undefined) {
      return rttMs === undefined ? {} : { rttMs: Math.round(rttMs) };
    }
    const lost = Math.max(0, numberField(inbound, 'packetsLost') ?? 0);
    const received = numberField(inbound, 'packetsReceived') ?? 0;
    const lossRatio = this.#loss.ratio(key, lost, lost + received);
    const delaySeconds = numberField(inbound, 'jitterBufferDelay');
    const emitted = numberField(inbound, 'jitterBufferEmittedCount');
    const bufferSeconds =
      delaySeconds === undefined || emitted === undefined
        ? undefined
        : this.#jitterBuffer.ratio(key, delaySeconds, emitted);
    const fps = numberField(inbound, 'framesPerSecond');
    return {
      width: numberField(inbound, 'frameWidth'),
      height: numberField(inbound, 'frameHeight'),
      fps: fps === undefined ? undefined : roundTo(fps, 1),
      packetLossPct: lossRatio === undefined ? undefined : roundTo(lossRatio * 100, 1),
      jitterBufferDelayMs:
        bufferSeconds === undefined ? undefined : Math.round(bufferSeconds * 1000),
      codec: codecOf(index, inbound),
      rttMs: rttMs === undefined ? undefined : Math.round(rttMs),
    };
  }
}

/**
 * Summarizes the per-layer sender statistics of one track: resolution and frame rate of the largest active layer,
 * packet loss over all layers (from the remote-inbound reports, interval-based via `loss`).
 */
export function summarizeSenderStats(
  stats: readonly VideoSenderStats[],
  loss: DeltaRatio,
  key: object,
): SenderSnapshot {
  const active = stats.filter((layer) => layer.frameWidth > 0 && layer.frameHeight > 0);
  const top = active.reduce<VideoSenderStats | undefined>(
    (best, layer) =>
      best === undefined ||
      layer.frameWidth * layer.frameHeight > best.frameWidth * best.frameHeight
        ? layer
        : best,
    undefined,
  );
  const lost = stats.reduce((sum, layer) => sum + Math.max(0, finiteOrZero(layer.packetsLost)), 0);
  const sent = stats.reduce((sum, layer) => sum + finiteOrZero(layer.packetsSent), 0);
  const ratio = loss.ratio(key, lost, sent);
  return {
    width: top?.frameWidth ?? null,
    height: top?.frameHeight ?? null,
    fps:
      top === undefined || !Number.isFinite(top.framesPerSecond)
        ? null
        : roundTo(top.framesPerSecond, 1),
    packetLossPct: ratio === undefined ? null : roundTo(ratio * 100, 1),
  };
}

function finiteOrZero(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) ? value : 0;
}
