import { FakeMediaStreamTrack } from './testing/fake-livekit';
import {
  TECH_CHECK,
  measureNetwork,
  measureUpload,
  rateCamera,
  runTechCheck,
  worstLevel,
} from './tech-check';

function cameraTrack(
  settings: MediaTrackSettings,
  readyState: MediaStreamTrackState = 'live',
): MediaStreamTrack {
  const track = new FakeMediaStreamTrack();
  track.settings = settings;
  track.readyState = readyState;
  return track.asTrack;
}

function pings(...values: (number | Error)[]): () => Promise<number> {
  let index = 0;
  return () => {
    const value = values[index++ % values.length];
    return value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
  };
}

/** Upload fake that lets `elapsedMs` pass on the injected clock. */
function upload(
  elapsedMs: number,
  clock: { now: number },
): (bytes: Uint8Array) => Promise<{ serverMs: number }> {
  return async () => {
    clock.now += elapsedMs;
    return { serverMs: elapsedMs - 5 };
  };
}

describe('rateCamera', () => {
  it.each([
    ['no track', null, 'unknown', null],
    ['720p at 30 fps', cameraTrack({ width: 1280, height: 720, frameRate: 30 }), 'ok', null],
    ['portrait 1080p', cameraTrack({ width: 1080, height: 1920, frameRate: 30 }), 'ok', null],
    ['720p without frame rate', cameraTrack({ width: 1280, height: 720 }), 'ok', null],
    [
      '720p at 15 fps',
      cameraTrack({ width: 1280, height: 720, frameRate: 15 }),
      'warn',
      'Kamera: nur 1280 × 720 bei 15 fps.',
    ],
    [
      '360p',
      cameraTrack({ width: 640, height: 360, frameRate: 30 }),
      'warn',
      'Kamera: nur 640 × 360 bei 30 fps.',
    ],
    [
      '240p',
      cameraTrack({ width: 320, height: 240, frameRate: 29.97 }),
      'bad',
      'Kamera: nur 320 × 240 bei 30 fps.',
    ],
    [
      'ended track',
      cameraTrack({ width: 1280, height: 720 }, 'ended'),
      'bad',
      'Kamera: liefert kein Bild.',
    ],
    ['no size', cameraTrack({ frameRate: 30 }), 'unknown', null],
    ['zero size', cameraTrack({ width: 0, height: 0 }), 'unknown', null],
  ])('%s → %s', (_name, track, level, problem) => {
    expect(rateCamera(track)).toMatchObject({ level, problem });
  });

  it('is unknown when the settings cannot be read', () => {
    const track = new FakeMediaStreamTrack();
    track.getSettings = () => {
      throw new Error('gone');
    };
    expect(rateCamera(track.asTrack).level).toBe('unknown');
  });
});

describe('measureNetwork', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    [[10, 20, 30, 40, 1000], 'ok', 30, null],
    [[50, 50, 50, 50, 50], 'ok', 50, null],
    [[51, 60, 100, 120, 150], 'warn', 100, 'Netzwerk: hohe Latenz (100 ms).'],
    [[150, 200, 220, 300, 400], 'bad', 220, 'Netzwerk: hohe Latenz (220 ms).'],
  ])('rates the median of %j as %s', async (values, level, rtt, problem) => {
    await expect(measureNetwork(pings(...values))).resolves.toEqual({ level, value: rtt, problem });
  });

  it('pings sequentially five times', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const ping = vi.fn(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight--;
      return 10;
    });
    await measureNetwork(ping);
    expect(ping).toHaveBeenCalledTimes(TECH_CHECK.pingCount);
    expect(maxInFlight).toBe(1);
  });

  it('counts failed and invalid answers as lost (at least warn)', async () => {
    await expect(
      measureNetwork(pings(10, new Error('offline'), 20, Number.NaN, 30)),
    ).resolves.toEqual({
      level: 'warn',
      value: 20,
      problem: 'Netzwerk: 2 von 5 Messungen ohne Antwort.',
    });
    await expect(measureNetwork(pings(10, 20, 30, 200, -1))).resolves.toEqual({
      level: 'warn',
      value: 25,
      problem: 'Netzwerk: 1 von 5 Messungen ohne Antwort.',
    });
  });

  it('is bad with fewer than three answers', async () => {
    await expect(
      measureNetwork(pings(10, new Error('x'), new Error('y'), new Error('z'), 10)),
    ).resolves.toEqual({
      level: 'bad',
      value: null,
      problem: 'Netzwerk: Server nicht zuverlässig erreichbar.',
    });
  });

  it('times out each ping after 2 s', async () => {
    const result = measureNetwork(() => new Promise<number>(() => undefined));
    await vi.advanceTimersByTimeAsync(TECH_CHECK.pingCount * TECH_CHECK.pingTimeoutMs);
    await expect(result).resolves.toMatchObject({ level: 'bad', value: null });
  });

  it('survives a ping that throws synchronously', async () => {
    const ping = (): Promise<number> => {
      throw new Error('sync');
    };
    await expect(measureNetwork(ping)).resolves.toMatchObject({ level: 'bad' });
  });
});

describe('measureUpload', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    [1000, 'ok', 8000, null],
    [1333, 'ok', 6002, null],
    [2000, 'warn', 4000, 'Upload: nur 4,0 Mbit/s (empfohlen ab 6 Mbit/s).'],
    [4000, 'bad', 2000, 'Upload: nur 2,0 Mbit/s (empfohlen ab 6 Mbit/s).'],
  ])('rates 1 MB in %i ms as %s', async (elapsedMs, level, kbps, problem) => {
    const clock = { now: 0 };
    await expect(measureUpload(upload(elapsedMs, clock), () => clock.now)).resolves.toEqual({
      level,
      value: kbps,
      problem,
    });
  });

  it('uploads 1 MB of random bytes', async () => {
    const uploadTest = vi.fn(async (_bytes: Uint8Array) => ({ serverMs: 1 }));
    await measureUpload(uploadTest);
    const bytes = uploadTest.mock.calls[0][0];
    expect(bytes).toHaveLength(TECH_CHECK.uploadBytes);
    expect(new Set(bytes.subarray(0, 4096)).size).toBeGreaterThan(200);
    expect(bytes.subarray(TECH_CHECK.uploadBytes - 1024).some((byte) => byte !== 0)).toBe(true);
  });

  it('never divides by zero', async () => {
    await expect(
      measureUpload(
        async () => ({ serverMs: 0 }),
        () => 5,
      ),
    ).resolves.toMatchObject({ level: 'ok' });
  });

  it('is bad on failure and on timeout', async () => {
    await expect(measureUpload(async () => Promise.reject(new Error('413')))).resolves.toEqual({
      level: 'bad',
      value: null,
      problem: 'Upload: Test fehlgeschlagen.',
    });
    const hanging = measureUpload(() => new Promise(() => undefined));
    await vi.advanceTimersByTimeAsync(TECH_CHECK.uploadTimeoutMs);
    await expect(hanging).resolves.toEqual({
      level: 'bad',
      value: null,
      problem: 'Upload: Zeitüberschreitung (über 15 s).',
    });
  });

  it('is bad when no random source is available', async () => {
    const randomBytes = (): Uint8Array => {
      throw new Error('no crypto');
    };
    await expect(
      measureUpload(async () => ({ serverMs: 1 }), undefined, undefined, randomBytes),
    ).resolves.toMatchObject({
      level: 'bad',
    });
  });
});

describe('runTechCheck', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date('2026-10-22T10:00:00Z') });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reports all ok without a note', async () => {
    const clock = { now: 0 };
    const result = await runTechCheck({
      getUserMediaTrack: cameraTrack({ width: 1280, height: 720, frameRate: 30 }),
      ping: pings(12),
      uploadTest: upload(500, clock),
      now: () => clock.now,
    });
    expect(result).toEqual({
      overall: 'ok',
      camera: 'ok',
      network: 'ok',
      bandwidth: 'ok',
      uploadKbps: 16000,
      rttMs: 12,
      at: '2026-10-22T10:00:00.000Z',
      note: null,
    });
  });

  it('rates the worst step and summarizes every problem in German', async () => {
    const clock = { now: 0 };
    const result = await runTechCheck({
      getUserMediaTrack: cameraTrack({ width: 640, height: 360, frameRate: 30 }),
      ping: pings(200),
      uploadTest: upload(2000, clock),
      now: () => clock.now,
    });
    expect(result).toMatchObject({
      overall: 'bad',
      camera: 'warn',
      network: 'bad',
      bandwidth: 'warn',
    });
    expect(result.note).toBe(
      'Kamera: nur 640 × 360 bei 30 fps. Netzwerk: hohe Latenz (200 ms). Upload: nur 4,0 Mbit/s (empfohlen ab 6 Mbit/s).',
    );
  });

  it('ignores an unknown camera on laptops and never rejects', async () => {
    const result = runTechCheck({
      ping: () => Promise.reject(new Error('offline')),
      uploadTest: () => Promise.reject(new Error('offline')),
    });
    await expect(result).resolves.toMatchObject({
      overall: 'bad',
      camera: 'unknown',
      network: 'bad',
      bandwidth: 'bad',
      uploadKbps: null,
      rttMs: null,
    });
  });
});

describe('worstLevel', () => {
  it.each([
    [[], 'unknown'],
    [['unknown', 'unknown'], 'unknown'],
    [['unknown', 'ok'], 'ok'],
    [['ok', 'warn', 'ok'], 'warn'],
    [['warn', 'bad', 'unknown'], 'bad'],
  ] as const)('%j → %s', (levels, expected) => {
    expect(worstLevel(levels)).toBe(expected);
  });
});
