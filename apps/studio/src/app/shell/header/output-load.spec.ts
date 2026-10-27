import type { OutputLinkStatusDto, OutputStatusDto } from '@studioflow/scene-model';
import { DROPPED_WARN_PCT, outputLoad } from './output-load';

function link(
  state: 'connected' | 'stale' | 'none',
  droppedFramesPct: number | null,
): OutputLinkStatusDto {
  return {
    linkId: `olk_${state}_${String(droppedFramesPct)}`,
    name: 'Proxy',
    state,
    consumers: state === 'none' ? 0 : 1,
    addresses: [],
    latencyMs: null,
    fps: null,
    lastReportAt: null,
    droppedFramesPct,
  };
}

function status(
  links: OutputLinkStatusDto[],
  overrides: Partial<OutputStatusDto> = {},
): OutputStatusDto {
  return {
    state: 'connected',
    consumers: links.length,
    addresses: [],
    latencyMs: null,
    fps: null,
    lastReportAt: null,
    links,
    ...overrides,
  };
}

describe('outputLoad', () => {
  it('knows nothing without a status', () => {
    const none = { dropping: false, droppedPct: null, decodedStreams: null, softwareStreams: null };
    expect(outputLoad(null)).toEqual(none);
    expect(outputLoad(undefined)).toEqual(none);
    expect(outputLoad(status([]))).toEqual(none);
  });

  it('warns from the dropped share on, not before', () => {
    expect(outputLoad(status([link('connected', DROPPED_WARN_PCT - 0.1)])).dropping).toBe(false);
    expect(outputLoad(status([link('connected', DROPPED_WARN_PCT)])).dropping).toBe(true);
    expect(outputLoad(status([link('connected', 0)]))).toMatchObject({
      dropping: false,
      droppedPct: 0,
    });
  });

  it('takes the worst of the connected links and ignores stale ones and missing values', () => {
    const load = outputLoad(
      status([link('connected', 1.5), link('connected', 9), link('stale', 40), link('none', null)]),
    );
    expect(load).toMatchObject({ dropping: true, droppedPct: 9 });
    expect(outputLoad(status([link('stale', 40), link('connected', null)]))).toMatchObject({
      dropping: false,
      droppedPct: null,
    });
  });

  it('passes the decoder counts of the page that reported last', () => {
    expect(
      outputLoad(status([link('connected', 0)], { decodedStreams: 3, softwareDecodedStreams: 1 })),
    ).toMatchObject({ decodedStreams: 3, softwareStreams: 1 });
    expect(outputLoad(status([], { decodedStreams: null }))).toMatchObject({
      decodedStreams: null,
      softwareStreams: null,
    });
  });
});
