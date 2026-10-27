import type { OutputStatusDto } from '@studioflow/scene-model';

/**
 * Share of dropped frames from which the Regie says that the output page cannot keep up. A few lost frames are normal
 * (a keyframe that arrives late); five in a hundred are seen as stutter by the audience.
 */
export const DROPPED_WARN_PCT = 5;

/** What the output page reports about the computer it runs on. */
export interface OutputLoad {
  /** A connected page drops at least {@link DROPPED_WARN_PCT} % of its frames: the computer cannot keep up. */
  readonly dropping: boolean;
  /** The worst dropped share of the connected pages in percent, null while none reports it. */
  readonly droppedPct: number | null;
  /** Video streams the page that reported last decodes, null while unknown. */
  readonly decodedStreams: number | null;
  /** Of those, the streams decoded in software. */
  readonly softwareStreams: number | null;
}

const NO_LOAD: OutputLoad = {
  dropping: false,
  droppedPct: null,
  decodedStreams: null,
  softwareStreams: null,
};

/**
 * The load of the output from its status: dropped frames of every connected link (a page that is stale or gone says
 * nothing about the machine any more) and the decoder counts of the page that reported last.
 */
export function outputLoad(status: OutputStatusDto | null | undefined): OutputLoad {
  if (!status) {
    return NO_LOAD;
  }
  const dropped = status.links
    .filter((link) => link.state === 'connected')
    .map((link) => link.droppedFramesPct)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const droppedPct = dropped.length > 0 ? Math.max(...dropped) : null;
  return {
    dropping: droppedPct !== null && droppedPct >= DROPPED_WARN_PCT,
    droppedPct,
    decodedStreams: status.decodedStreams ?? null,
    softwareStreams: status.softwareDecodedStreams ?? null,
  };
}
