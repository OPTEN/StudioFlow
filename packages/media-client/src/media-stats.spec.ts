import type { VideoSenderStats } from 'livekit-client';
import {
  DeltaRatio,
  ReceiverStatsReader,
  codecOf,
  inboundVideo,
  indexStats,
  roundTripTimeMs,
  summarizeSenderStats,
} from './media-stats';

function report(entries: Record<string, Record<string, unknown>>): Map<string, unknown> {
  return new Map(Object.entries(entries).map(([id, value]) => [id, { id, ...value }]));
}

const CHROME_RECEIVER = report({
  IT01V: {
    type: 'inbound-rtp',
    kind: 'video',
    codecId: 'CIT01_96',
    frameWidth: 1280,
    frameHeight: 720,
    framesPerSecond: 29.97,
    packetsLost: 2,
    packetsReceived: 98,
    jitterBufferDelay: 4,
    jitterBufferEmittedCount: 100,
    bytesReceived: 100_000,
    transportId: 'T01',
  },
  CIT01_96: { type: 'codec', mimeType: 'video/VP9' },
  T01: { type: 'transport', selectedCandidatePairId: 'CP1' },
  CP1: { type: 'candidate-pair', currentRoundTripTime: 0.024, state: 'succeeded' },
  CP2: { type: 'candidate-pair', currentRoundTripTime: 0.5, nominated: true, state: 'succeeded' },
});

describe('stats parsing', () => {
  it('indexes only object entries', () => {
    const index = indexStats(
      new Map<string, unknown>([
        ['a', { type: 'codec' }],
        ['b', 5],
        ['c', null],
      ]),
    );
    expect([...index.keys()]).toEqual(['a']);
  });

  it('finds the inbound video stream with the most bytes and its codec', () => {
    const index = indexStats(
      report({
        A: { type: 'inbound-rtp', kind: 'audio', bytesReceived: 1e9 },
        B: { type: 'inbound-rtp', kind: 'video', bytesReceived: 10 },
        C: { type: 'inbound-rtp', mediaType: 'video', bytesReceived: 20, codecId: 'X' },
        X: { type: 'codec', mimeType: 'video/H264' },
      }),
    );
    const inbound = inboundVideo(index);
    expect(inbound?.['id']).toBe('C');
    expect(inbound === undefined ? undefined : codecOf(index, inbound)).toBe('h264');
  });

  it('returns no codec for missing or malformed entries', () => {
    const index = indexStats(report({ C: { type: 'codec', mimeType: 'garbage' } }));
    expect(codecOf(index, { codecId: 'C' })).toBeUndefined();
    expect(codecOf(index, { codecId: 'missing' })).toBeUndefined();
    expect(codecOf(index, {})).toBeUndefined();
  });

  it('reads the RTT of the selected candidate pair via the transport', () => {
    expect(roundTripTimeMs(indexStats(CHROME_RECEIVER))).toBe(24);
  });

  it('falls back to the selected flag, the nominated pair and remote-outbound-rtp', () => {
    expect(
      roundTripTimeMs(
        indexStats(
          report({ P: { type: 'candidate-pair', selected: true, currentRoundTripTime: 0.01 } }),
        ),
      ),
    ).toBe(10);
    expect(
      roundTripTimeMs(
        indexStats(
          report({
            P: {
              type: 'candidate-pair',
              nominated: true,
              state: 'succeeded',
              currentRoundTripTime: 0.03,
            },
          }),
        ),
      ),
    ).toBe(30);
    expect(
      roundTripTimeMs(
        indexStats(report({ R: { type: 'remote-outbound-rtp', roundTripTime: 0.04 } })),
      ),
    ).toBe(40);
    expect(roundTripTimeMs(indexStats(report({})))).toBeUndefined();
  });
});

describe('DeltaRatio', () => {
  it('uses cumulative values first, then interval deltas', () => {
    const ratio = new DeltaRatio();
    const key = {};
    expect(ratio.ratio(key, 5, 100)).toBe(0.05);
    expect(ratio.ratio(key, 15, 200)).toBe(0.1);
    expect(ratio.ratio(key, 15, 200)).toBe(0.1);
  });

  it('starts over after a counter reset and handles empty counters', () => {
    const ratio = new DeltaRatio();
    const key = {};
    expect(ratio.ratio(key, 0, 0)).toBeUndefined();
    ratio.ratio(key, 10, 100);
    expect(ratio.ratio(key, 1, 50)).toBe(0.02);
    expect(ratio.ratio({}, -5, 10)).toBe(0);
  });
});

describe('ReceiverStatsReader', () => {
  it('summarizes a Chrome receiver report', () => {
    const reader = new ReceiverStatsReader();
    expect(reader.read({}, CHROME_RECEIVER)).toEqual({
      width: 1280,
      height: 720,
      fps: 30,
      packetLossPct: 2,
      jitterBufferDelayMs: 40,
      codec: 'vp9',
      rttMs: 24,
    });
  });

  it('computes loss and buffer delay over the last interval', () => {
    const reader = new ReceiverStatsReader();
    const key = {};
    reader.read(key, CHROME_RECEIVER);
    const later = report({
      IT01V: {
        type: 'inbound-rtp',
        kind: 'video',
        packetsLost: 12,
        packetsReceived: 188,
        jitterBufferDelay: 5,
        jitterBufferEmittedCount: 200,
      },
    });
    expect(reader.read(key, later)).toMatchObject({ packetLossPct: 10, jitterBufferDelayMs: 10 });
  });

  it('returns only what is present', () => {
    const reader = new ReceiverStatsReader();
    expect(reader.read({}, new Map())).toEqual({});
    expect(
      reader.read({}, report({ R: { type: 'remote-outbound-rtp', roundTripTime: 0.1 } })),
    ).toEqual({ rttMs: 100 });
    expect(
      reader.read({}, report({ I: { type: 'inbound-rtp', kind: 'video', frameWidth: 'wide' } })),
    ).toEqual({
      width: undefined,
      height: undefined,
      fps: undefined,
      packetLossPct: undefined,
      jitterBufferDelayMs: undefined,
      codec: undefined,
      rttMs: undefined,
    });
  });
});

function layer(overrides: Partial<VideoSenderStats>): VideoSenderStats {
  return {
    type: 'video',
    rid: 'f',
    frameWidth: 0,
    frameHeight: 0,
    framesPerSecond: 0,
    framesSent: 0,
    firCount: 0,
    pliCount: 0,
    nackCount: 0,
    targetBitrate: 0,
    timestamp: 0,
    ...overrides,
  };
}

describe('summarizeSenderStats', () => {
  it('reports the largest layer and the loss over all layers', () => {
    const stats = [
      layer({
        rid: 'q',
        frameWidth: 320,
        frameHeight: 180,
        framesPerSecond: 15,
        packetsSent: 100,
        packetsLost: 1,
      }),
      layer({
        rid: 'f',
        frameWidth: 1280,
        frameHeight: 720,
        framesPerSecond: 29.6,
        packetsSent: 300,
        packetsLost: 3,
      }),
      layer({ rid: 'h', frameWidth: 640, frameHeight: 360, framesPerSecond: 30, packetsSent: 200 }),
    ];
    expect(summarizeSenderStats(stats, new DeltaRatio(), {})).toEqual({
      width: 1280,
      height: 720,
      fps: 29.6,
      packetLossPct: 0.7,
    });
  });

  it('returns nulls without active layers', () => {
    expect(summarizeSenderStats([], new DeltaRatio(), {})).toEqual({
      width: null,
      height: null,
      fps: null,
      packetLossPct: null,
    });
    expect(
      summarizeSenderStats([layer({ packetsSent: 10, packetsLost: -2 })], new DeltaRatio(), {}),
    ).toMatchObject({
      width: null,
      packetLossPct: 0,
    });
  });
});
