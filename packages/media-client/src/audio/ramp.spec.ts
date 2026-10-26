import { FakeAudioParam } from '../testing/fake-audio';
import { rampCurve, rampParam } from './ramp';

function paramAt(clock: { now: number }, value = 0): FakeAudioParam {
  const param = new FakeAudioParam(() => clock.now);
  param.value = value;
  return param;
}

/** The fake implements the members the ramp uses; the cast gives it the DOM type. */
function asParam(param: FakeAudioParam): AudioParam {
  return param as unknown as AudioParam;
}

describe('rampCurve', () => {
  it('rises along a quarter sine for a channel that comes in', () => {
    const curve = rampCurve(0, 1, 'equal-power');
    expect(curve[0]).toBe(0);
    expect(curve[curve.length - 1]).toBe(1);
    expect(curve[Math.floor((curve.length - 1) / 2)]).toBeCloseTo(Math.SQRT1_2, 1);
  });

  it('falls along a quarter cosine for a channel that goes out', () => {
    const curve = rampCurve(1, 0, 'equal-power');
    expect(curve[0]).toBe(1);
    expect(curve[curve.length - 1]).toBe(0);
    expect(curve[Math.floor((curve.length - 1) / 2)]).toBeCloseTo(Math.SQRT1_2, 1);
  });

  it('scales with the level of the channel', () => {
    const curve = rampCurve(0, 0.5, 'equal-power');
    expect(curve[curve.length - 1]).toBe(0.5);
    expect(Math.max(...curve)).toBe(0.5);
  });

  it('is straight between two audible levels and for the linear shape', () => {
    const between = rampCurve(0.2, 1, 'equal-power');
    expect(between[0]).toBeCloseTo(0.2, 6);
    expect(between[Math.floor((between.length - 1) / 2)]).toBeCloseTo(0.6, 1);
    const linear = rampCurve(0, 1, 'linear');
    expect(linear[Math.floor((linear.length - 1) / 2)]).toBeCloseTo(0.5, 1);
  });

  it('never ends below zero', () => {
    expect(rampCurve(1, -0.5, 'linear')[63]).toBe(0);
  });
});

describe('rampParam', () => {
  it('steps at once for a zero duration or an unchanged value', () => {
    const clock = { now: 1 };
    const param = paramAt(clock, 0.25);
    rampParam(asParam(param), 1, clock.now, 0, 'linear');
    expect(param.value).toBe(1);
    rampParam(asParam(param), 1, clock.now, 0.5, 'linear');
    expect(param.value).toBe(1);
    expect(param.events.some((event) => event.kind === 'linear' || event.kind === 'curve')).toBe(
      false,
    );
  });

  it('ramps linearly from the current value', () => {
    const clock = { now: 0 };
    const param = paramAt(clock, 0);
    rampParam(asParam(param), 1, 0, 0.02, 'linear');
    clock.now = 0.01;
    expect(param.value).toBeCloseTo(0.5, 6);
    clock.now = 0.02;
    expect(param.value).toBe(1);
  });

  it('follows a value curve for the equal-power shape', () => {
    const clock = { now: 0 };
    const param = paramAt(clock, 0);
    rampParam(asParam(param), 1, 0, 1, 'equal-power');
    clock.now = 0.5;
    expect(param.value).toBeCloseTo(Math.SQRT1_2, 1);
    clock.now = 1;
    expect(param.value).toBe(1);
  });

  it('continues an interrupted ramp from its current value', () => {
    const clock = { now: 0 };
    const param = paramAt(clock, 0);
    rampParam(asParam(param), 1, 0, 1, 'linear');
    clock.now = 0.4;
    rampParam(asParam(param), 0, 0.4, 0.4, 'linear');
    expect(param.value).toBeCloseTo(0.4, 6);
    clock.now = 0.6;
    expect(param.value).toBeCloseTo(0.2, 6);
    clock.now = 0.8;
    expect(param.value).toBe(0);
  });

  it('continues an interrupted value curve without a jump', () => {
    const clock = { now: 0 };
    const param = paramAt(clock, 0);
    rampParam(asParam(param), 1, 0, 1, 'equal-power');
    clock.now = 0.5;
    const halfway = param.value;
    rampParam(asParam(param), 0, 0.5, 0.5, 'equal-power');
    expect(param.value).toBeCloseTo(halfway, 2);
    clock.now = 1;
    expect(param.value).toBe(0);
  });
});
