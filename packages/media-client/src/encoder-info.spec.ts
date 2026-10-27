import { EncoderCapability, summarizeEncoder } from './encoder-info';
import { DecoderCapability, kindFromStats } from './decoder-info';

function report(entries: Record<string, unknown>[]): Map<string, unknown> {
  return new Map(entries.map((entry, index) => [`id${index}`, entry]));
}

const layer = (extra: Record<string, unknown>) => ({
  type: 'outbound-rtp',
  kind: 'video',
  frameWidth: 1280,
  frameHeight: 720,
  ...extra,
});

describe('summarizeEncoder', () => {
  it('takes the encoder of the largest layer and the worst limit of all layers', () => {
    const snapshot = summarizeEncoder(
      report([
        layer({
          frameWidth: 320,
          frameHeight: 180,
          encoderImplementation: 'small',
          qualityLimitationReason: 'bandwidth',
        }),
        layer({
          encoderImplementation: 'libvpx',
          powerEfficientEncoder: false,
          qualityLimitationReason: 'cpu',
        }),
        layer({ frameWidth: 640, frameHeight: 360, qualityLimitationReason: 'none' }),
      ]),
    );
    expect(snapshot).toEqual({ encoder: 'libvpx', hardware: false, limitation: 'cpu' });
  });

  it.each([
    [['none', 'none'], null],
    [['other', 'none'], 'other'],
    [['other', 'bandwidth'], 'bandwidth'],
    [['bandwidth', 'cpu'], 'cpu'],
    [['nonsense', undefined], null],
  ])('reports the limitation of layers %j as %s', (reasons, expected) => {
    const snapshot = summarizeEncoder(
      report(reasons.map((reason) => layer({ qualityLimitationReason: reason }))),
    );
    expect(snapshot.limitation).toBe(expected);
  });

  it('knows hardware from a name when the flag is missing, and nothing from an unknown name', () => {
    expect(
      summarizeEncoder(report([layer({ encoderImplementation: 'VideoToolbox' })])).hardware,
    ).toBe(true);
    expect(summarizeEncoder(report([layer({ encoderImplementation: 'OpenH264' })])).hardware).toBe(
      false,
    );
    expect(
      summarizeEncoder(report([layer({ encoderImplementation: 'SomethingNew' })])),
    ).toMatchObject({ encoder: 'SomethingNew', hardware: null });
  });

  it('is empty for a report without video streams and ignores other entries', () => {
    expect(
      summarizeEncoder(
        report([
          { type: 'outbound-rtp', kind: 'audio', qualityLimitationReason: 'cpu' },
          { type: 'codec' },
        ]),
      ),
    ).toEqual({ encoder: null, hardware: null, limitation: null });
    expect(summarizeEncoder(new Map())).toEqual({
      encoder: null,
      hardware: null,
      limitation: null,
    });
  });
});

describe('kindFromStats', () => {
  it('prefers the flag over the name', () => {
    expect(kindFromStats({ implementation: 'libvpx', powerEfficient: true })).toBe('hardware');
    expect(kindFromStats({ implementation: 'VideoToolbox', powerEfficient: false })).toBe(
      'software',
    );
  });

  it.each([
    ['libvpx', 'software'],
    ['libaom', 'software'],
    ['dav1d', 'software'],
    ['OpenH264', 'software'],
    ['FFmpeg', 'software'],
    ['MediaFoundationVideoEncodeAccelerator', 'hardware'],
    ['D3D11VideoDecoder', 'hardware'],
    ['VaapiVideoDecoder', 'hardware'],
    ['VideoToolbox', 'hardware'],
    ['ExternalDecoder', 'hardware'],
    ['MysteryCodec', null],
    ['', null],
    [undefined, null],
  ])('reads the name %s as %s', (implementation, expected) => {
    expect(kindFromStats({ implementation })).toBe(expected);
  });
});

describe('EncoderCapability', () => {
  it('answers hardware, software or nothing and remembers the answer per codec and size', async () => {
    const encodingInfo = vi.fn(async () => ({ supported: true, powerEfficient: true }));
    const capability = new EncoderCapability({ encodingInfo });
    expect(await capability.hardwareOf('h264', 1920, 1080)).toBe(true);
    expect(await capability.hardwareOf('h264', 1920, 1080)).toBe(true);
    expect(await capability.hardwareOf('h264', 1280, 720)).toBe(true);
    expect(encodingInfo).toHaveBeenCalledTimes(2);

    expect(await capability.hardwareOf('unknown', 1280, 720)).toBeNull();
    expect(await capability.hardwareOf(null, 1280, 720)).toBeNull();
    expect(await capability.hardwareOf('vp9', 0, 720)).toBeNull();
    expect(await new EncoderCapability(undefined).hardwareOf('vp9', 1280, 720)).toBeNull();
    expect(await new EncoderCapability({} as never).hardwareOf('vp9', 1280, 720)).toBeNull();
  });

  it('answers software for a software encoder and nothing for an unsupported codec or a failing question', async () => {
    expect(
      await new EncoderCapability({
        encodingInfo: async () => ({ supported: true, powerEfficient: false }),
      }).hardwareOf('vp9', 1280, 720),
    ).toBe(false);
    expect(
      await new EncoderCapability({
        encodingInfo: async () => ({ supported: false, powerEfficient: false }),
      }).hardwareOf('vp9', 1280, 720),
    ).toBeNull();
    expect(
      await new EncoderCapability({
        encodingInfo: () => Promise.reject(new TypeError('bad configuration')),
      }).hardwareOf('vp9', 1280, 720),
    ).toBeNull();
  });
});

describe('DecoderCapability', () => {
  it('answers for the decoders the same way', async () => {
    const decodingInfo = vi.fn(async () => ({ supported: true, powerEfficient: false }));
    const capability = new DecoderCapability({ decodingInfo });
    expect(await capability.kindOf('vp9', 2560, 1440)).toBe('software');
    expect(await capability.kindOf('vp9', 2560, 1440)).toBe('software');
    expect(decodingInfo).toHaveBeenCalledTimes(1);
    expect(await capability.kindOf(undefined, 2560, 1440)).toBeNull();
    expect(await capability.kindOf('vp9', Number.NaN, 1440)).toBeNull();
    expect(
      await new DecoderCapability({
        decodingInfo: async () => ({ supported: true, powerEfficient: true }),
      }).kindOf('h264', 1280, 720),
    ).toBe('hardware');
    expect(
      await new DecoderCapability({ decodingInfo: () => Promise.reject(new Error('x')) }).kindOf(
        'h264',
        1,
        1,
      ),
    ).toBeNull();
  });
});
