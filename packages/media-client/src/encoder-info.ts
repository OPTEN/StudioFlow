/**
 * Hardware or software encoding of a published stream (issue #12, spec section 7). The sender captures camera or screen,
 * so Chromium tells it the encoder (`encoderImplementation`, `powerEfficientEncoder`); where it does not (or the sender
 * browser hides it), `MediaCapabilities.encodingInfo` answers for the codec and size.
 */
import { kindFromStats } from './decoder-info';
import { WEBRTC_CONTENT_TYPES } from './webrtc-codecs';

/** Why the sender lowers the quality right now; `cpu` means the computer cannot keep up. */
export type QualityLimitation = 'cpu' | 'bandwidth' | 'other';

/** What the browser tells about the encoder of a track. */
export interface EncoderSnapshot {
  /** Implementation name (`libvpx`, `OpenH264`, `VideoToolbox` ...), null when not told. */
  readonly encoder: string | null;
  /** True for a hardware (power-efficient) encoder, false for software, null when not told. */
  readonly hardware: boolean | null;
  /** The reason for a quality limit right now; null when there is none. */
  readonly limitation: QualityLimitation | null;
}

type StatsRecord = Readonly<Record<string, unknown>>;

/** The part of an `RTCStatsReport` that can be iterated. */
interface StatsSource {
  forEach(callback: (value: unknown, key: string) => void): void;
}

const LIMITATION_RANK: Readonly<Record<QualityLimitation, number>> = {
  cpu: 3,
  bandwidth: 2,
  other: 1,
};

function isLimitation(value: unknown): value is QualityLimitation {
  return value === 'cpu' || value === 'bandwidth' || value === 'other';
}

/**
 * Summarizes the outbound video streams of a sender report (one per simulcast layer): the encoder of the largest layer,
 * and the worst quality limit over all layers (`cpu` before `bandwidth` before `other`).
 */
export function summarizeEncoder(report: StatsSource): EncoderSnapshot {
  const layers: StatsRecord[] = [];
  report.forEach((value) => {
    if (
      typeof value === 'object' &&
      value !== null &&
      (value as StatsRecord)['type'] === 'outbound-rtp' &&
      ((value as StatsRecord)['kind'] === 'video' ||
        (value as StatsRecord)['mediaType'] === 'video')
    ) {
      layers.push(value as StatsRecord);
    }
  });
  const size = (layer: StatsRecord): number =>
    (typeof layer['frameWidth'] === 'number' ? layer['frameWidth'] : 0) *
    (typeof layer['frameHeight'] === 'number' ? layer['frameHeight'] : 0);
  const largest = layers.reduce<StatsRecord | undefined>(
    (best, layer) => (best === undefined || size(layer) > size(best) ? layer : best),
    undefined,
  );
  const limitation = layers
    .map((layer) => layer['qualityLimitationReason'])
    .filter(isLimitation)
    .reduce<QualityLimitation | null>(
      (worst, reason) =>
        worst === null || LIMITATION_RANK[reason] > LIMITATION_RANK[worst] ? reason : worst,
      null,
    );
  const implementation =
    typeof largest?.['encoderImplementation'] === 'string' &&
    largest['encoderImplementation'] !== ''
      ? largest['encoderImplementation']
      : null;
  const kind = kindFromStats({
    implementation: implementation ?? undefined,
    powerEfficient:
      typeof largest?.['powerEfficientEncoder'] === 'boolean'
        ? largest['powerEfficientEncoder']
        : undefined,
  });
  return {
    encoder: implementation,
    hardware: kind === null ? null : kind === 'hardware',
    limitation,
  };
}

/** The part of `MediaCapabilities` the probe uses (injectable in tests). */
export interface EncoderCapabilities {
  encodingInfo(configuration: {
    type: 'webrtc';
    video: {
      contentType: string;
      width: number;
      height: number;
      bitrate: number;
      framerate: number;
    };
  }): Promise<{ supported: boolean; powerEfficient: boolean }>;
}

/** Asks the browser whether it encodes a codec at a size with hardware, once per codec and size. */
export class EncoderCapability {
  readonly #answers = new Map<string, Promise<'hardware' | 'software' | null>>();

  constructor(
    private readonly capabilities: EncoderCapabilities | undefined = typeof navigator ===
    'undefined'
      ? undefined
      : (navigator.mediaCapabilities as EncoderCapabilities | undefined),
  ) {}

  /** True for a hardware encoder, false for software, null when the browser cannot tell. */
  async hardwareOf(
    codec: string | null | undefined,
    width: number,
    height: number,
  ): Promise<boolean | null> {
    const contentType = codec ? WEBRTC_CONTENT_TYPES[codec] : undefined;
    if (
      contentType === undefined ||
      this.capabilities === undefined ||
      typeof this.capabilities.encodingInfo !== 'function' ||
      !(width > 0) ||
      !(height > 0)
    ) {
      return null;
    }
    const key = `${codec}:${Math.round(width)}x${Math.round(height)}`;
    let answer = this.#answers.get(key);
    if (answer === undefined) {
      answer = this.capabilities
        .encodingInfo({
          type: 'webrtc',
          video: { contentType, width, height, bitrate: 2_000_000, framerate: 30 },
        })
        .then((info): 'hardware' | 'software' | null =>
          info.supported ? (info.powerEfficient ? 'hardware' : 'software') : null,
        )
        .catch(() => null);
      this.#answers.set(key, answer);
    }
    const kind = await answer;
    return kind === null ? null : kind === 'hardware';
  }
}
