/**
 * Technical check of a sender (spec 8.4): camera picture, network round trip to the API and upload bandwidth, each
 * rated as a traffic light and summarized in a {@link TechCheckDto}. Every step has a timeout and the check never
 * throws: a failing step is rated `bad` and explained by a problem message. The problems are kept as messages, so the
 * sender shows them in the language of the reader; the wire `note` is an English summary of the same problems.
 */
import { msg, tFor, tm, type Locale, type MessageKey, type Msg } from '@studioflow/i18n';
import { formatRate, type TechCheckDto, type TechCheckLevel } from '@studioflow/scene-model';
import { systemClock, TimeoutError, withTimeout, type Clock } from './clock';

/** Inputs of {@link runTechCheck}. */
export interface TechCheckOptions {
  /** The running camera track (its settings tell the achieved resolution and frame rate); omit on laptops. */
  readonly getUserMediaTrack?: MediaStreamTrack | null;
  /** One round trip to the API; resolves with the measured RTT in ms. */
  readonly ping: () => Promise<number>;
  /** Uploads the bytes to `/api/device/bandwidth-test`; `serverMs` is the server's receive time (diagnostics only). */
  readonly uploadTest: (bytes: Uint8Array) => Promise<{ readonly serverMs: number }>;
  /** Monotonic time in ms for the upload measurement (default performance.now). */
  readonly now?: () => number;
  /** Timers for the step timeouts (tests). */
  readonly clock?: Clock;
  /** Source of the incompressible upload payload (tests). */
  readonly randomBytes?: (size: number) => Uint8Array;
}

/** Thresholds and limits of the check. */
export const TECH_CHECK = {
  pingCount: 5,
  minPingAnswers: 3,
  pingTimeoutMs: 2000,
  rttOkMs: 50,
  rttWarnMs: 150,
  uploadBytes: 1_000_000,
  uploadTimeoutMs: 15_000,
  uploadOkKbps: 6000,
  uploadWarnKbps: 3000,
  cameraOkHeight: 720,
  cameraWarnHeight: 360,
  cameraOkFps: 24,
} as const;

/**
 * What a step found wrong, as a message of the `media.techcheck.*` catalogue with the raw numbers as parameters
 * (`rate` is formatted when the message is shown, see {@link techProblemText}).
 */
export type TechProblem = Msg;

/** The result of {@link runTechCheck}: the wire DTO plus the problems as messages (the sender strips them again). */
export interface TechCheckResult extends TechCheckDto {
  readonly problems: readonly TechProblem[];
}

interface StepResult {
  readonly level: TechCheckLevel;
  readonly value: number | null;
  readonly problem: TechProblem | null;
}

type UntypedTranslate = (key: MessageKey, params?: TechProblem['params']) => string;

/**
 * The text of a problem. Without `locale` it is in the active language, with decimals in its format ("2,8 Mbit/s");
 * `'en'` gives the English text of the wire `note`, which never depends on the language of the page.
 */
export function techProblemText(problem: TechProblem, locale?: Locale): string {
  const { key, params } = problem;
  if (locale !== undefined) {
    return (tFor(locale) as unknown as UntypedTranslate)(key, params);
  }
  const rate = params?.['rate'];
  return tm(
    typeof rate === 'number' ? { key, params: { ...params, rate: formatRate(rate) } } : problem,
  );
}

const RANK: Readonly<Record<TechCheckLevel, number>> = { unknown: 0, ok: 1, warn: 2, bad: 3 };

/** Worst level; `unknown` only wins when nothing was measured. */
export function worstLevel(levels: readonly TechCheckLevel[]): TechCheckLevel {
  return levels.reduce<TechCheckLevel>(
    (worst, level) => (RANK[level] > RANK[worst] ? level : worst),
    'unknown',
  );
}

/** Rates the camera from its track settings: ≥ 720p and ≥ 24 fps ok, ≥ 360p warn, below bad, no track unknown. */
export function rateCamera(track: MediaStreamTrack | null | undefined): StepResult {
  if (track === null || track === undefined) {
    return { level: 'unknown', value: null, problem: null };
  }
  if (track.readyState === 'ended') {
    return { level: 'bad', value: null, problem: msg('media.techcheck.camera.noPicture') };
  }
  let settings: MediaTrackSettings;
  try {
    settings = track.getSettings();
  } catch {
    return { level: 'unknown', value: null, problem: null };
  }
  const { width, height, frameRate } = settings;
  if (width === undefined || height === undefined || width <= 0 || height <= 0) {
    return { level: 'unknown', value: null, problem: null };
  }
  const shortSide = Math.min(width, height);
  const fpsKnown = frameRate !== undefined && Number.isFinite(frameRate) && frameRate > 0;
  const fpsOk = !fpsKnown || frameRate >= TECH_CHECK.cameraOkFps;
  if (shortSide >= TECH_CHECK.cameraOkHeight && fpsOk) {
    return { level: 'ok', value: shortSide, problem: null };
  }
  return {
    level: shortSide >= TECH_CHECK.cameraWarnHeight ? 'warn' : 'bad',
    value: shortSide,
    problem: fpsKnown
      ? msg('media.techcheck.camera.lowResFps', { width, height, fps: Math.round(frameRate) })
      : msg('media.techcheck.camera.lowRes', { width, height }),
  };
}

/** Median RTT of five sequential pings (2 s timeout each); fewer than three answers is `bad`, any loss at least `warn`. */
export async function measureNetwork(
  ping: () => Promise<number>,
  clock: Clock = systemClock,
): Promise<StepResult> {
  const samples: number[] = [];
  for (let index = 0; index < TECH_CHECK.pingCount; index++) {
    try {
      const rtt = await withTimeout(Promise.resolve().then(ping), TECH_CHECK.pingTimeoutMs, clock);
      if (typeof rtt === 'number' && Number.isFinite(rtt) && rtt >= 0) {
        samples.push(rtt);
      }
    } catch {
      // A missing answer counts as lost.
    }
  }
  const lost = TECH_CHECK.pingCount - samples.length;
  if (samples.length < TECH_CHECK.minPingAnswers) {
    return { level: 'bad', value: null, problem: msg('media.techcheck.network.unreachable') };
  }
  const rtt = Math.round(median(samples));
  const latencyLevel: TechCheckLevel =
    rtt <= TECH_CHECK.rttOkMs ? 'ok' : rtt <= TECH_CHECK.rttWarnMs ? 'warn' : 'bad';
  const level = lost > 0 ? worstLevel([latencyLevel, 'warn']) : latencyLevel;
  const total = TECH_CHECK.pingCount;
  return { level, value: rtt, problem: networkProblem(latencyLevel !== 'ok', rtt, lost, total) };
}

function networkProblem(
  slow: boolean,
  rtt: number,
  lost: number,
  total: number,
): TechProblem | null {
  if (slow && lost > 0) {
    return msg('media.techcheck.network.latencyAndLoss', { rtt, lost, total });
  }
  if (slow) {
    return msg('media.techcheck.network.latency', { rtt });
  }
  return lost > 0 ? msg('media.techcheck.network.loss', { lost, total }) : null;
}

/**
 * Uploads 1 MB of random (incompressible) bytes and rates bits / client-side elapsed time: ≥ 6 Mbit/s ok, ≥ 3 warn.
 * The client-side time includes request overhead, so the value is conservative.
 */
export async function measureUpload(
  uploadTest: (bytes: Uint8Array) => Promise<{ readonly serverMs: number }>,
  now: () => number = () => globalThis.performance.now(),
  clock: Clock = systemClock,
  randomBytes: (size: number) => Uint8Array = cryptoRandomBytes,
): Promise<StepResult> {
  try {
    const bytes = randomBytes(TECH_CHECK.uploadBytes);
    const started = now();
    await withTimeout(
      Promise.resolve().then(() => uploadTest(bytes)),
      TECH_CHECK.uploadTimeoutMs,
      clock,
    );
    const elapsedMs = Math.max(1, now() - started);
    const kbps = Math.round((bytes.length * 8) / elapsedMs);
    if (kbps >= TECH_CHECK.uploadOkKbps) {
      return { level: 'ok', value: kbps, problem: null };
    }
    return {
      level: kbps >= TECH_CHECK.uploadWarnKbps ? 'warn' : 'bad',
      value: kbps,
      problem: msg('media.techcheck.upload.slow', {
        rate: Math.round(kbps / 100) / 10,
        recommended: TECH_CHECK.uploadOkKbps / 1000,
      }),
    };
  } catch (error) {
    const problem =
      error instanceof TimeoutError
        ? msg('media.techcheck.upload.timeout', { seconds: TECH_CHECK.uploadTimeoutMs / 1000 })
        : msg('media.techcheck.upload.failed');
    return { level: 'bad', value: null, problem };
  }
}

/** Runs camera, network and bandwidth checks one after another and never rejects. */
export async function runTechCheck(options: TechCheckOptions): Promise<TechCheckResult> {
  const clock = options.clock ?? systemClock;
  const camera = rateCamera(options.getUserMediaTrack);
  const network = await measureNetwork(options.ping, clock);
  const bandwidth = await measureUpload(
    options.uploadTest,
    options.now,
    clock,
    options.randomBytes,
  );
  const problems = [camera, network, bandwidth]
    .map((step) => step.problem)
    .filter((problem): problem is TechProblem => problem !== null);
  return {
    overall: worstLevel([camera.level, network.level, bandwidth.level]),
    camera: camera.level,
    network: network.level,
    bandwidth: bandwidth.level,
    uploadKbps: bandwidth.value,
    rttMs: network.value,
    at: new Date().toISOString(),
    note: problems.length === 0 ? null : problems.map((p) => techProblemText(p, 'en')).join(' '),
    problems,
  };
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** `crypto.getRandomValues` accepts at most 64 KiB per call. */
function cryptoRandomBytes(size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  const chunk = 65_536;
  for (let offset = 0; offset < size; offset += chunk) {
    globalThis.crypto.getRandomValues(bytes.subarray(offset, Math.min(size, offset + chunk)));
  }
  return bytes;
}
