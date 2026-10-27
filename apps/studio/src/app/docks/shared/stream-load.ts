import { t } from '@studioflow/i18n';
import { MISSING_VALUE, type SlotTelemetryDto } from '@studioflow/scene-model';

/**
 * What a stream costs the computers on its way (issue #12, “nothing goes unnoticed”): the sender's encoder (hardware or
 * software, and whether the sender had to lower the picture because its CPU is at the limit) and the decoder of the Regie.
 * Pure view models; the texts are looked up when a model is built, so build them inside a `computed`.
 */

/** Display names of the codecs the sender reports in lower case. */
const CODEC_NAMES: Readonly<Record<string, string>> = {
  h264: 'H.264',
  h265: 'H.265',
  vp8: 'VP8',
  vp9: 'VP9',
  av1: 'AV1',
};

/** "H.264", "VP9"; other names upper-case; null for none. */
export function codecName(codec: string | null | undefined): string | null {
  if (!codec) {
    return null;
  }
  return CODEC_NAMES[codec.toLowerCase()] ?? codec.toUpperCase();
}

/** The encoding of one slot as the Regie shows it. */
export interface EncodingView {
  /** "H.264 · hardware", "VP9 · software encoding", "H.264" while the encoder is not known, "–" without a codec. */
  readonly text: string;
  /** The encoder is in software (the sender's CPU does the work). */
  readonly software: boolean;
  /** The sender lowers the picture because its CPU is at the limit. */
  readonly cpuLimited: boolean;
}

/** Encoding of a slot from its telemetry (`SlotTelemetryDto`). */
export function encodingView(slot: SlotTelemetryDto | undefined): EncodingView {
  const codec = codecName(slot?.codec);
  const software = slot?.hardwareEncoder === false;
  const cpuLimited = slot?.qualityLimitation === 'cpu';
  if (codec === null) {
    return { text: MISSING_VALUE, software, cpuLimited };
  }
  const text =
    slot?.hardwareEncoder === true
      ? t('regie.load.encoding.hardware', { codec })
      : software
        ? t('regie.load.encoding.software', { codec })
        : codec;
  return { text, software, cpuLimited };
}

/** A stream the Regie decodes, as the media provider reports it (`SourceStats`). */
export interface DecodingInput {
  readonly codec?: string;
  readonly decoder?: 'hardware' | 'software';
}

/** "H.264 · hardware decoding", "VP9 · software decoding"; null where the browser does not tell. */
export function decodingText(stats: DecodingInput | null): string | null {
  if (stats?.decoder === undefined) {
    return null;
  }
  const codec = codecName(stats.codec);
  const word =
    stats.decoder === 'hardware'
      ? t('regie.load.decoding.hardware')
      : t('regie.load.decoding.software');
  return codec === null ? word : `${codec} · ${word}`;
}
