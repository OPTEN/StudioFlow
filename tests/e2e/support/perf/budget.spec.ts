import { BUDGET, TOLERANCE, budgetScale, checkBudget, checkBudgetParts, flatten, isLoadDependent, type BudgetLine, type PerfSummary, type WindowSummary } from './budget';

function role(overrides: Partial<WindowSummary['output']> = {}): WindowSummary['output'] {
  return {
    cores: 0.3,
    coresByType: {},
    mainThreadBusy: 0.05,
    decodedStreams: 3,
    subscribedStreams: 3,
    softwareStreams: 3,
    decodeLoad: 0.1,
    megapixelsPerSecond: 30,
    framePixels: 6,
    droppedFrames: 0,
    droppedShare: 0.005,
    ...overrides,
  };
}

function window(overrides: { output?: Partial<WindowSummary['output']>; regie?: Partial<WindowSummary['output']> } = {}): WindowSummary {
  return {
    seconds: 45,
    machineBusy: 1,
    dom: { output: { videos: 2, paintedVideos: 2, canvases: 0 }, regie: { videos: 16, paintedVideos: 16, canvases: 4 } },
    output: role(overrides.output),
    regie: role({ decodedStreams: 6, softwareStreams: 6, cores: 0.6, mainThreadBusy: 0.15, ...overrides.regie }),
    senders: {
      cores: 1.8,
      phoneEncodeLoad: 1.4,
      screenEncodeLoad: 1.2,
      screenCodec: 'h264',
      screenEncoder: null,
      screenEncoderPowerEfficient: null,
      screenFps: 6,
      phoneCodec: 'h264',
      phoneEncoder: null,
      cpuLimited: false,
    },
  };
}

function summary(overrides: { output?: Partial<WindowSummary['output']>; regie?: Partial<WindowSummary['output']> } = {}): PerfSummary {
  return {
    idle: window(overrides),
    dragging: { ...window(overrides), regieRafFps: 20 },
    switching: { previewSceneMs: 300, coldSceneMs: 600, coldVideoWidths: [320] },
    decodedSources: { output: [], regie: [] },
    profiles: { regie: [], output: [] },
  };
}

describe('performance budget', () => {
  it('accepts a summary within the budget', () => {
    expect(checkBudget(summary())).toEqual([]);
  });

  it('fails when the output decodes one more stream, whatever the machine', () => {
    const problems = checkBudget(summary({ output: { decodedStreams: 4 } }), BUDGET, 10);
    expect(problems).toHaveLength(2);
    expect(problems[0]).toContain('idle.output.decodedStreams is 4, budget exactly 3');
    expect(problems[1]).toContain('dragging.output.decodedStreams');
  });

  it('fails when the Regie gets more videos, canvases or decoded streams', () => {
    const more = summary({ regie: { decodedStreams: 7 } });
    more.idle.dom.regie.videos = 26;
    more.idle.dom.regie.canvases = 20;
    const problems = checkBudget(more);
    expect(problems.some((problem) => problem.startsWith('idle.regie.canvases is 20'))).toBe(true);
    expect(problems.some((problem) => problem.startsWith('idle.regie.videos is 26'))).toBe(true);
    expect(problems.some((problem) => problem.startsWith('idle.regie.decodedStreams is 7'))).toBe(true);
  });

  it('lets a load exceed its budget by 20 %, not more', () => {
    const line: BudgetLine[] = [{ key: 'idle.output.cores', kind: 'load', max: 0.5, why: 'test' }];
    expect(TOLERANCE).toBe(0.2);
    expect(checkBudget(summary({ output: { cores: 0.6 } }), line, 1)).toEqual([]);
    const problems = checkBudget(summary({ output: { cores: 0.61 } }), line, 1);
    expect(problems).toEqual(['idle.output.cores is 0.61, budget with 20 % tolerance 0.6 (test)']);
  });

  it('scales the loads, not the counts, for a slower machine', () => {
    const slow = summary({ output: { cores: 0.9, decodedStreams: 4 } });
    const problems = checkBudget(slow, BUDGET, 2);
    expect(problems.some((problem) => problem.startsWith('idle.output.cores'))).toBe(false);
    expect(problems.some((problem) => problem.startsWith('idle.output.decodedStreams'))).toBe(true);
  });

  it('fails when the GPU process of the Regie works much harder, and tolerates a load of 20 % more', () => {
    const busy = summary({ regie: { coresByType: { GPU: 0.5 } } });
    expect(checkBudget(busy).some((problem) => problem.startsWith('idle.regie.gpuCores is 0.5'))).toBe(true);
    const fine = summary({ regie: { coresByType: { GPU: 0.42 } } });
    expect(checkBudget(fine)).toEqual([]);
  });

  it('checks the screen codec and the frame rate cap of the senders', () => {
    const wrong = summary();
    wrong.idle.senders.screenCodec = 'vp9';
    wrong.idle.senders.screenFps = 30;
    const problems = checkBudget(wrong);
    expect(problems).toHaveLength(2);
    expect(problems[0]).toContain('idle.senders.screenCodec is vp9, expected h264');
    expect(problems[1]).toContain('idle.senders.screenFps is 30');
  });

  it('calls a run on a machine that starves the senders invalid instead of passing or blaming the product', () => {
    const starved = summary();
    starved.dragging.senders.cpuLimited = true;
    const problems = checkBudget(starved);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('dragging.senders.cpuLimited is true, expected false');
    expect(problems[0]).toContain('too busy for a valid measurement');
  });

  it('keeps the counts apart from the loads, so that a starved machine only excuses the loads', () => {
    const starved = summary();
    starved.dragging.senders.cpuLimited = true;
    starved.dragging.regie.cores = 5;
    starved.idle.output.decodedStreams = 4;
    const parts = checkBudgetParts(starved);
    expect(parts.counts).toHaveLength(1);
    expect(parts.counts[0]).toContain('idle.output.decodedStreams is 4');
    expect(parts.loads.join('\n')).toContain('dragging.senders.cpuLimited is true');
    expect(parts.loads.join('\n')).toContain('dragging.regie.cores is 5');
    expect(BUDGET.filter((line) => !isLoadDependent(line)).some((line) => line.key.endsWith('decodedStreams'))).toBe(true);
    expect(checkBudgetParts(summary())).toEqual({ counts: [], loads: [] });
  });

  it('reports a value that was not measured instead of passing it', () => {
    const missing = summary();
    missing.switching.previewSceneMs = Number.NaN;
    expect(checkBudget(missing)).toEqual([expect.stringContaining('switching.previewSceneMs was not measured')]);
  });

  it('only budgets keys the summary flattens to', () => {
    const keys = new Set(flatten(summary()).map(([key]) => key));
    for (const line of BUDGET) {
      expect(keys.has(line.key), line.key).toBe(true);
    }
  });

  it('reads PERF_BUDGET_SCALE, ignoring nonsense', () => {
    expect(budgetScale({})).toBe(1);
    expect(budgetScale({ PERF_BUDGET_SCALE: '2.5' })).toBe(2.5);
    expect(budgetScale({ PERF_BUDGET_SCALE: '0' })).toBe(1);
    expect(budgetScale({ PERF_BUDGET_SCALE: 'fast' })).toBe(1);
  });
});
