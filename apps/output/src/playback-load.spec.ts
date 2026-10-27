import { PlaybackLoad } from './playback-load';

const DECODERS = { decoding: 3, software: 1, framesDropped: 0, framesReceived: 180 };

describe('PlaybackLoad', () => {
  it('reports the dropped share of the interval from the video elements', () => {
    const load = new PlaybackLoad();
    expect(load.measure({ presentedFrames: 0, droppedFrames: 0 }, null)).toEqual({
      droppedFramesPct: null,
      decodedStreams: null,
      softwareDecodedStreams: null,
    });
    // 90 presented and 10 dropped since the last report: 10 %.
    expect(load.measure({ presentedFrames: 90, droppedFrames: 10 }, null).droppedFramesPct).toBe(
      10,
    );
    // The next interval is measured on its own: 1 of 61.
    expect(load.measure({ presentedFrames: 150, droppedFrames: 11 }, null).droppedFramesPct).toBe(
      1.6,
    );
    expect(load.measure({ presentedFrames: 210, droppedFrames: 11 }, null).droppedFramesPct).toBe(
      0,
    );
  });

  it('reports the share of the receivers when it is the larger one', () => {
    const load = new PlaybackLoad();
    load.measure({ presentedFrames: 0, droppedFrames: 0 }, null);
    const report = load.measure(
      { presentedFrames: 100, droppedFrames: 1 },
      { decoding: 4, software: 4, framesDropped: 18, framesReceived: 200 },
    );
    expect(report).toEqual({ droppedFramesPct: 9, decodedStreams: 4, softwareDecodedStreams: 4 });
  });

  it('says nothing about dropping from too few frames, but still counts the streams', () => {
    const load = new PlaybackLoad();
    load.measure({ presentedFrames: 0, droppedFrames: 0 }, null);
    expect(
      load.measure(
        { presentedFrames: 5, droppedFrames: 5 },
        { decoding: 1, software: 0, framesDropped: 5, framesReceived: 10 },
      ),
    ).toEqual({ droppedFramesPct: null, decodedStreams: 1, softwareDecodedStreams: 0 });
  });

  it('reports the decoders alone while the page shows no video (a slate)', () => {
    const load = new PlaybackLoad();
    expect(load.measure({ presentedFrames: 0, droppedFrames: 0 }, DECODERS)).toEqual({
      droppedFramesPct: 0,
      decodedStreams: 3,
      softwareDecodedStreams: 1,
    });
  });

  it('never goes negative or above 100 % (the counters of a replaced video start over)', () => {
    const load = new PlaybackLoad();
    load.measure({ presentedFrames: 500, droppedFrames: 50 }, null);
    expect(
      load.measure({ presentedFrames: 10, droppedFrames: 1 }, null).droppedFramesPct,
    ).toBeNull();
    expect(
      load.measure(
        { presentedFrames: 10, droppedFrames: 1 },
        { decoding: 1, software: 0, framesDropped: 500, framesReceived: 100 },
      ).droppedFramesPct,
    ).toBe(100);
  });
});
