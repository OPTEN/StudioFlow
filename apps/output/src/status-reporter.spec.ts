import type { OutputReport } from '@studioflow/scene-model';
import { REPORT_INTERVAL_MS, REST_REPORT_INTERVAL_MS, StatusReporter } from './status-reporter';

const REPORT: OutputReport = { rendering: true, latencyMs: 60, fps: 60, programSceneId: 'scn_a' };

describe('StatusReporter', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup(overrides: { connected?: boolean; enabled?: boolean } = {}) {
    const flags = { connected: overrides.connected ?? true, enabled: overrides.enabled ?? true };
    const viaHub = vi.fn((_report: OutputReport) => Promise.resolve());
    const viaRest = vi.fn((_report: OutputReport) => Promise.resolve());
    const onTick = vi.fn();
    const reporter = new StatusReporter({
      collect: () => Promise.resolve(REPORT),
      transport: { hubConnected: () => flags.connected, sendViaHub: viaHub, sendViaRest: viaRest },
      enabled: () => flags.enabled,
      onTick,
    });
    reporter.start();
    return { reporter, flags, viaHub, viaRest, onTick };
  }

  it('reports over the hub every 2 s', async () => {
    const { reporter, viaHub, viaRest } = setup();
    await vi.advanceTimersByTimeAsync(REPORT_INTERVAL_MS - 1);
    expect(viaHub).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(viaHub).toHaveBeenCalledWith(REPORT);
    await vi.advanceTimersByTimeAsync(REPORT_INTERVAL_MS * 4);
    expect(viaHub).toHaveBeenCalledTimes(5);
    expect(viaRest).not.toHaveBeenCalled();
    reporter.stop();
  });

  it('falls back to REST at most every 10 s while the hub is not connected', async () => {
    const { reporter, viaHub, viaRest, flags } = setup({ connected: false });
    await vi.advanceTimersByTimeAsync(REPORT_INTERVAL_MS);
    expect(viaRest).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(REST_REPORT_INTERVAL_MS - REPORT_INTERVAL_MS);
    expect(viaRest).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(REPORT_INTERVAL_MS);
    expect(viaRest).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(viaRest).toHaveBeenCalledTimes(8);
    expect(viaHub).not.toHaveBeenCalled();

    flags.connected = true;
    await vi.advanceTimersByTimeAsync(REPORT_INTERVAL_MS);
    expect(viaHub).toHaveBeenCalledTimes(1);
    expect(viaRest).toHaveBeenCalledTimes(8);
    reporter.stop();
  });

  it('uses REST when the hub send fails', async () => {
    const { reporter, viaHub, viaRest } = setup();
    viaHub.mockRejectedValue(new Error('connection closed'));
    await vi.advanceTimersByTimeAsync(REPORT_INTERVAL_MS * 3);
    expect(viaHub).toHaveBeenCalledTimes(3);
    expect(viaRest).toHaveBeenCalledTimes(1);
    reporter.stop();
  });

  it('sends nothing while disabled (“No access”) but keeps the housekeeping tick', async () => {
    const { reporter, viaHub, viaRest, onTick, flags } = setup({ enabled: false });
    await vi.advanceTimersByTimeAsync(REPORT_INTERVAL_MS * 10);
    expect(viaHub).not.toHaveBeenCalled();
    expect(viaRest).not.toHaveBeenCalled();
    expect(onTick).toHaveBeenCalledTimes(10);
    flags.enabled = true;
    await vi.advanceTimersByTimeAsync(REPORT_INTERVAL_MS);
    expect(viaHub).toHaveBeenCalledTimes(1);
    reporter.stop();
  });

  it('never overlaps rounds and survives failing collectors', async () => {
    let calls = 0;
    let release: () => void = () => undefined;
    const viaHub = vi.fn(() => Promise.resolve());
    const reporter = new StatusReporter({
      collect: () => {
        calls += 1;
        if (calls === 1) {
          return new Promise<OutputReport>((resolve) => {
            release = () => resolve(REPORT);
          });
        }
        return calls === 2 ? Promise.reject(new Error('stats')) : Promise.resolve(REPORT);
      },
      transport: { hubConnected: () => true, sendViaHub: viaHub, sendViaRest: vi.fn() },
    });
    reporter.start();
    await vi.advanceTimersByTimeAsync(REPORT_INTERVAL_MS * 3);
    expect(calls).toBe(1);
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(viaHub).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(REPORT_INTERVAL_MS * 2);
    expect(calls).toBe(3);
    expect(viaHub).toHaveBeenCalledTimes(2);
    reporter.stop();
  });

  it('stops', async () => {
    const { reporter, viaHub } = setup();
    reporter.stop();
    await vi.advanceTimersByTimeAsync(REPORT_INTERVAL_MS * 5);
    expect(viaHub).not.toHaveBeenCalled();
  });
});
