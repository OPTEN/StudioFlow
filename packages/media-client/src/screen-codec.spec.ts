import {
  chooseScreenCodec,
  probeScreenCodecs,
  type EncodingCapabilities,
  type ScreenCodecProbe,
} from './screen-codec';

const FORMAT = { width: 2560, height: 1440, framerate: 15, bitrate: 3_000_000 };
const HARDWARE = { supported: true, powerEfficient: true };
const SOFTWARE = { supported: true, powerEfficient: false };

describe('chooseScreenCodec', () => {
  it.each<[string, ScreenCodecProbe, string]>([
    ['hardware VP9 encoder', { vp9: HARDWARE, h264: HARDWARE }, 'vp9'],
    ['hardware VP9 encoder, H.264 unknown', { vp9: HARDWARE, h264: null }, 'vp9'],
    ['software VP9 encoder', { vp9: SOFTWARE, h264: HARDWARE }, 'h264'],
    ['software encoders only', { vp9: SOFTWARE, h264: SOFTWARE }, 'h264'],
    [
      'VP9 not supported',
      { vp9: { supported: false, powerEfficient: false }, h264: HARDWARE },
      'h264',
    ],
    [
      'VP9 reported efficient but not supported',
      { vp9: { supported: false, powerEfficient: true }, h264: HARDWARE },
      'h264',
    ],
    ['the browser cannot tell', { vp9: null, h264: null }, 'h264'],
  ])('%s → %s', (_name, probe, expected) => {
    expect(chooseScreenCodec(probe)).toBe(expected);
  });
});

describe('probeScreenCodecs', () => {
  it('asks for both encoders with the capture ceiling and the default frame rate', async () => {
    const encodingInfo = vi.fn((configuration: { video: { contentType: string } }) =>
      Promise.resolve(
        configuration.video.contentType.startsWith('video/VP9') ? HARDWARE : SOFTWARE,
      ),
    );
    const probe = await probeScreenCodecs({ encodingInfo } as EncodingCapabilities, FORMAT);
    expect(probe).toEqual({ vp9: HARDWARE, h264: SOFTWARE });
    expect(encodingInfo).toHaveBeenCalledTimes(2);
    expect(encodingInfo).toHaveBeenCalledWith({
      type: 'webrtc',
      video: { contentType: 'video/VP9', ...FORMAT },
    });
    expect(encodingInfo).toHaveBeenCalledWith({
      type: 'webrtc',
      video: expect.objectContaining({ contentType: expect.stringContaining('video/H264') }),
    });
  });

  it('answers null for a codec whose question fails and keeps the other answer', async () => {
    const encodingInfo = vi.fn((configuration: { video: { contentType: string } }) =>
      configuration.video.contentType.startsWith('video/VP9')
        ? Promise.reject(new TypeError('unsupported configuration'))
        : Promise.resolve(HARDWARE),
    );
    expect(await probeScreenCodecs({ encodingInfo } as EncodingCapabilities, FORMAT)).toEqual({
      vp9: null,
      h264: HARDWARE,
    });
  });

  it('answers null for both without MediaCapabilities or without encodingInfo (Firefox, old browsers)', async () => {
    expect(await probeScreenCodecs(undefined, FORMAT)).toEqual({ vp9: null, h264: null });
    expect(await probeScreenCodecs({} as EncodingCapabilities, FORMAT)).toEqual({
      vp9: null,
      h264: null,
    });
  });

  it('turns an odd answer into "not power efficient"', async () => {
    const encodingInfo = vi.fn(() => Promise.resolve({ supported: true } as never));
    expect(await probeScreenCodecs({ encodingInfo } as EncodingCapabilities, FORMAT)).toEqual({
      vp9: SOFTWARE,
      h264: SOFTWARE,
    });
  });
});
