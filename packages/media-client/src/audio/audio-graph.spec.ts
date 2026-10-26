import type { ChannelTarget } from '@studioflow/scene-model';
import { silentLogger } from '../logger';
import {
  FakeAudioContext,
  FakeAudioContextWithSink,
  type FakeAnalyserNode,
  type FakeDelayNode,
  type FakeGainNode,
} from '../testing/fake-audio';
import { FakeMediaStream, FakeMediaStreamTrack } from '../testing/fake-livekit';
import { AudioGraph, type AudioGraphOptions, type AudioGraphState } from './audio-graph';
import { SILENCE_DB } from './level';

const MIC = 'dev_aaaaaaaaaaaaaaaa/mic';
const SCREEN = 'dev_aaaaaaaaaaaaaaaa/screen-1';
const VIDEO = 'ast_aaaaaaaaaaaaaaaa';

function target(gain: number, delayMs = 0): ChannelTarget {
  return { gain, delayMs, audible: gain > 0 };
}

function targets(entries: Record<string, ChannelTarget>): Map<string, ChannelTarget> {
  return new Map(Object.entries(entries));
}

function audioStream(): MediaStream {
  return new FakeMediaStream(new FakeMediaStreamTrack('audio').asTrack) as unknown as MediaStream;
}

function silentStream(): MediaStream {
  return new FakeMediaStream(new FakeMediaStreamTrack('video').asTrack) as unknown as MediaStream;
}

/** The nodes of the n-th strip in creation order (the master and the monitor bus come first). */
function strip(context: FakeAudioContext, index: number) {
  return {
    input: context.gains[2 + 2 * index] as FakeGainNode,
    fader: context.gains[3 + 2 * index] as FakeGainNode,
    meter: context.analysers[1 + index] as FakeAnalyserNode,
    delay: context.delays[index] as FakeDelayNode,
  };
}

function setup(
  options: {
    context?: FakeAudioContext;
    output?: AudioGraphOptions['output'];
  } = {},
) {
  const context = options.context ?? new FakeAudioContext();
  const kept: MediaStream[] = [];
  const released: MediaStream[] = [];
  const graph = new AudioGraph({
    output: options.output ?? 'program',
    createContext: () => context.asContext,
    keepAlive: (stream) => {
      kept.push(stream);
      return () => released.push(stream);
    },
    logger: silentLogger,
  });
  const states: AudioGraphState[] = [];
  graph.onStateChange((state) => states.push(state));
  return {
    context,
    graph,
    kept,
    released,
    states,
    master: context.gains[0],
    meter: context.analysers[0],
    bus: context.gains[1],
  };
}

describe('AudioGraph', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('state', () => {
    it('runs when the context runs and plays the master (program)', () => {
      const { graph, context, master } = setup();
      expect(graph.state).toBe('running');
      expect(master.connectsTo(context.destination)).toBe(true);
    });

    it('is blocked while the browser keeps the context suspended, and starts on resume()', async () => {
      const context = new FakeAudioContext({ blocked: true });
      const { graph, states } = setup({ context });
      expect(graph.state).toBe('blocked');

      await expect(graph.resume()).resolves.toBe('blocked');
      expect(states).toEqual([]);

      context.allowSound();
      await expect(graph.resume()).resolves.toBe('running');
      expect(states).toEqual(['running']);
      expect(context.resume).toHaveBeenCalledTimes(2);
    });

    it('follows the context when the browser suspends or resumes it on its own', () => {
      const { graph, context, states } = setup();
      context.setState('suspended');
      expect(graph.state).toBe('blocked');
      context.setState('running');
      expect(graph.state).toBe('running');
      expect(states).toEqual(['blocked', 'running']);
    });

    it('stays blocked when resume() rejects', async () => {
      const context = new FakeAudioContext({ blocked: true });
      context.resumeError = new Error('NotAllowedError');
      const { graph } = setup({ context });
      await expect(graph.resume()).resolves.toBe('blocked');
    });

    it('is unavailable without Web Audio and every call is a no-op', async () => {
      const graph = new AudioGraph({
        output: 'program',
        createContext: () => {
          throw new Error('no Web Audio');
        },
        logger: silentLogger,
      });
      expect(graph.state).toBe('unavailable');
      graph.setInput(MIC, audioStream());
      graph.apply(targets({ [MIC]: target(1) }), { rampMs: 20 });
      graph.setMonitor({ kind: 'program' });
      expect(graph.channels).toEqual([]);
      expect(graph.levels().program).toBe(SILENCE_DB);
      await expect(graph.resume()).resolves.toBe('unavailable');
      await expect(graph.setSinkId('x')).resolves.toBe(false);
      expect(graph.canChooseOutputDevice).toBe(false);
      expect(graph.currentTime).toBe(0);
      expect(() => graph.dispose()).not.toThrow();
    });

    it('is closed after dispose, which also closes the context and stops notifying', () => {
      const { graph, context, states } = setup();
      graph.dispose();
      graph.dispose();
      expect(graph.state).toBe('closed');
      expect(context.close).toHaveBeenCalledTimes(1);
      context.setState('suspended');
      expect(states).toEqual([]);
    });
  });

  describe('inputs', () => {
    it('connects the sound of a channel to its strip and keeps the stream pulling', () => {
      const { graph, context, kept } = setup();
      const stream = audioStream();
      graph.setInput(MIC, stream);

      const { input, meter, delay, fader } = strip(context, 0);
      expect(context.sources[0].stream).toBe(stream);
      expect(context.sources[0].connectsTo(input)).toBe(true);
      expect(input.connectsTo(meter)).toBe(true);
      expect(input.connectsTo(delay)).toBe(true);
      expect(delay.connectsTo(fader)).toBe(true);
      expect(fader.connectsTo(context.gains[0])).toBe(true);
      expect(kept).toEqual([stream]);
      expect(graph.hasInput(MIC)).toBe(true);
      expect(graph.channels).toEqual([MIC]);
    });

    it('starts silent: the fader is at zero until the first target', () => {
      const { graph, context } = setup();
      graph.setInput(MIC, audioStream());
      expect(strip(context, 0).fader.gain.value).toBe(0);
    });

    it('ignores streams without an audio track', () => {
      const { graph } = setup();
      graph.setInput(MIC, silentStream());
      expect(graph.hasInput(MIC)).toBe(false);
      expect(graph.channels).toEqual([]);
    });

    it('does nothing for the same stream twice and swaps a replaced stream', () => {
      const { graph, context, kept, released } = setup();
      const first = audioStream();
      graph.setInput(MIC, first);
      graph.setInput(MIC, first);
      expect(context.sources).toHaveLength(1);

      const second = audioStream();
      graph.setInput(MIC, second);
      expect(context.sources).toHaveLength(2);
      expect(context.sources[0].disconnected).toBe(true);
      expect(released).toEqual([first]);
      expect(kept).toEqual([first, second]);
      expect(context.sources[1].connectsTo(strip(context, 0).input)).toBe(true);
    });

    it('removes the feed of a lost sound but keeps the strip while a target exists', () => {
      const { graph, context, released } = setup();
      const stream = audioStream();
      graph.setInput(MIC, stream);
      graph.apply(targets({ [MIC]: target(1) }), { rampMs: 20 });

      graph.setInput(MIC, null);

      expect(graph.hasInput(MIC)).toBe(false);
      expect(graph.channels).toEqual([MIC]);
      expect(released).toEqual([stream]);
      expect(context.sources[0].disconnected).toBe(true);
    });

    it('removes a strip that has neither a sound nor a target', () => {
      const { graph } = setup();
      graph.setInput(MIC, audioStream());
      graph.setInput(MIC, null);
      expect(graph.channels).toEqual([]);
    });

    it('does not create a strip for a missing sound', () => {
      const { graph, context } = setup();
      graph.setInput(MIC, null);
      expect(context.gains).toHaveLength(2);
    });

    it('survives a stream the browser cannot connect', () => {
      const { graph, context } = setup();
      vi.spyOn(context, 'createMediaStreamSource').mockImplementation(() => {
        throw new Error('InvalidStateError');
      });
      expect(() => graph.setInput(MIC, audioStream())).not.toThrow();
      expect(graph.hasInput(MIC)).toBe(false);
    });
  });

  describe('gains', () => {
    it('sets the first target at once, without a ramp', () => {
      const { graph, context } = setup();
      graph.setInput(MIC, audioStream());
      graph.apply(targets({ [MIC]: target(0.5, 120) }), { rampMs: 20 });

      const { fader, delay } = strip(context, 0);
      expect(fader.gain.value).toBe(0.5);
      expect(delay.delayTime.value).toBeCloseTo(0.12, 6);
      expect(fader.gain.events.some((event) => event.kind === 'linear')).toBe(false);
    });

    it('cuts with a 20 ms ramp that is sample-accurate on the audio clock', () => {
      const { graph, context } = setup();
      graph.setInput(MIC, audioStream());
      graph.apply(targets({ [MIC]: target(0) }), { rampMs: 20 });
      graph.apply(targets({ [MIC]: target(1) }), { rampMs: 20 });
      const { fader } = strip(context, 0);

      expect(fader.gain.value).toBe(0);
      context.advance(0.01);
      expect(fader.gain.value).toBeCloseTo(0.5, 6);
      context.advance(0.01);
      expect(fader.gain.value).toBe(1);
    });

    it('mutes with the same ramp', () => {
      const { graph, context } = setup();
      graph.setInput(MIC, audioStream());
      graph.apply(targets({ [MIC]: target(1) }), { rampMs: 20 });
      graph.apply(targets({ [MIC]: target(0) }), { rampMs: 20 });
      const { fader } = strip(context, 0);

      context.advance(0.005);
      expect(fader.gain.value).toBeCloseTo(0.75, 6);
      context.advance(0.015);
      expect(fader.gain.value).toBe(0);
    });

    it('crossfades with constant power over the fade duration', () => {
      const { graph, context } = setup();
      graph.setInput(MIC, audioStream());
      graph.setInput(SCREEN, audioStream());
      graph.apply(targets({ [MIC]: target(1), [SCREEN]: target(0) }), { rampMs: 20 });

      graph.apply(targets({ [MIC]: target(0), [SCREEN]: target(1) }), { rampMs: 1000 });
      const out = strip(context, 0).fader.gain;
      const incoming = strip(context, 1).fader.gain;

      context.advance(0.5);
      expect(out.value).toBeCloseTo(Math.SQRT1_2, 2);
      expect(incoming.value).toBeCloseTo(Math.SQRT1_2, 2);
      expect(out.value ** 2 + incoming.value ** 2).toBeCloseTo(1, 1);
      context.advance(0.5);
      expect(out.value).toBe(0);
      expect(incoming.value).toBe(1);
    });

    it('uses a straight ramp for a move between two audible levels', () => {
      const { graph, context } = setup();
      graph.setInput(MIC, audioStream());
      graph.apply(targets({ [MIC]: target(1) }), { rampMs: 20 });
      graph.apply(targets({ [MIC]: target(0.5) }), { rampMs: 1000 });
      context.advance(0.5);
      expect(strip(context, 0).fader.gain.value).toBeCloseTo(0.75, 2);
    });

    it('can be told the curve explicitly', () => {
      const { graph, context } = setup();
      graph.setInput(MIC, audioStream());
      graph.apply(targets({ [MIC]: target(0) }), { rampMs: 20 });
      graph.apply(targets({ [MIC]: target(1) }), { rampMs: 1000, curve: 'linear' });
      context.advance(0.5);
      expect(strip(context, 0).fader.gain.value).toBeCloseTo(0.5, 2);
    });

    it('continues an interrupted ramp from where it is, without a jump', () => {
      const { graph, context } = setup();
      graph.setInput(MIC, audioStream());
      graph.apply(targets({ [MIC]: target(0) }), { rampMs: 20 });
      graph.apply(targets({ [MIC]: target(1) }), { rampMs: 1000, curve: 'linear' });
      context.advance(0.5);
      const halfway = strip(context, 0).fader.gain.value;

      graph.apply(targets({ [MIC]: target(0) }), { rampMs: 20 });
      expect(strip(context, 0).fader.gain.value).toBeCloseTo(halfway, 6);
      context.advance(0.02);
      expect(strip(context, 0).fader.gain.value).toBe(0);
    });

    it('leaves a channel alone when its target did not change (a scene switch under an always-on mic)', () => {
      const { graph, context } = setup();
      graph.setInput(MIC, audioStream());
      graph.apply(targets({ [MIC]: target(1) }), { rampMs: 20 });
      const { fader, delay } = strip(context, 0);
      const gainEvents = fader.gain.scheduled;
      const delayEvents = delay.delayTime.scheduled;

      graph.apply(targets({ [MIC]: target(1) }), { rampMs: 1000 });

      expect(fader.gain.scheduled).toBe(gainEvents);
      expect(delay.delayTime.scheduled).toBe(delayEvents);
    });

    it('moves the delay smoothly', () => {
      const { graph, context } = setup();
      graph.setInput(MIC, audioStream());
      graph.apply(targets({ [MIC]: target(1, 0) }), { rampMs: 20 });
      graph.apply(targets({ [MIC]: target(1, 200) }), { rampMs: 20 });
      const { delay } = strip(context, 0);

      expect(delay.delayTime.value).toBeLessThan(0.001);
      context.advance(0.3);
      expect(delay.delayTime.value).toBeGreaterThan(0.199);
      context.advance(1);
      expect(delay.delayTime.value).toBeCloseTo(0.2, 4);
    });

    it('allows a sync offset up to the 500 ms limit', () => {
      const { graph, context } = setup();
      graph.setInput(MIC, audioStream());
      expect(strip(context, 0).delay.maxDelayTime).toBeGreaterThanOrEqual(0.5);
      expect(graph.channels).toEqual([MIC]);
    });
  });

  describe('channels that leave the targets', () => {
    it('fades a channel with a sound to silence and keeps its strip for the next target', () => {
      const { graph, context } = setup();
      graph.setInput(MIC, audioStream());
      graph.apply(targets({ [MIC]: target(1) }), { rampMs: 20 });

      graph.apply(targets({}), { rampMs: 20 });
      context.advance(0.02);

      expect(strip(context, 0).fader.gain.value).toBe(0);
      expect(graph.channels).toEqual([MIC]);

      // A target returns: it is applied with a ramp again (the strip kept its history).
      graph.apply(targets({ [MIC]: target(1) }), { rampMs: 20 });
      context.advance(0.01);
      expect(strip(context, 0).fader.gain.value).toBeCloseTo(0.5, 6);
    });

    it('removes the strip of a channel without a sound once the ramp is over', () => {
      const { graph, context } = setup();
      graph.apply(targets({ [VIDEO]: target(1) }), { rampMs: 20 });
      const { input, fader, delay } = strip(context, 0);
      expect(graph.channels).toEqual([VIDEO]);

      graph.apply(targets({}), { rampMs: 20 });
      expect(graph.channels).toEqual([]);
      expect(fader.disconnected).toBe(false);

      vi.advanceTimersByTime(300);
      expect(input.disconnected).toBe(true);
      expect(delay.disconnected).toBe(true);
      expect(fader.disconnected).toBe(true);
    });
  });

  describe('levels', () => {
    it('reads the peak of every channel before its fader, and of the program', () => {
      const { graph, context, meter } = setup();
      graph.setInput(MIC, audioStream());
      graph.setInput(SCREEN, audioStream());
      graph.apply(targets({ [MIC]: target(0), [SCREEN]: target(1) }), { rampMs: 20 });
      strip(context, 0).meter.setPeak(0.5);
      strip(context, 1).meter.setPeak(0.1);
      meter.setPeak(0.1);

      const levels = graph.levels();

      expect(levels.channels.get(MIC)).toBeCloseTo(-6.02, 1);
      expect(levels.channels.get(SCREEN)).toBeCloseTo(-20, 1);
      expect(levels.program).toBeCloseTo(-20, 1);
    });

    it('reads silence for a channel without a sound and for an idle program', () => {
      const { graph } = setup();
      graph.apply(targets({ [VIDEO]: target(1) }), { rampMs: 20 });
      const levels = graph.levels();
      expect(levels.channels.get(VIDEO)).toBe(SILENCE_DB);
      expect(levels.program).toBe(SILENCE_DB);
    });
  });

  describe('monitoring (Regie)', () => {
    it('does not play the master and listens to nothing by default', () => {
      const { graph, context, master, bus } = setup({ output: 'monitor' });
      expect(master.connectsTo(context.destination)).toBe(false);
      expect(bus.connectsTo(context.destination)).toBe(true);
      expect(master.connectsTo(bus)).toBe(false);
      expect(graph.monitor).toEqual({ kind: 'off' });
    });

    it('listens to one channel before its fader and mute (PFL), then to the program, then to nothing', () => {
      const { graph, context, master, bus } = setup({ output: 'monitor' });
      graph.setInput(MIC, audioStream());
      graph.setInput(SCREEN, audioStream());

      graph.setMonitor({ kind: 'channel', sourceId: MIC });
      expect(strip(context, 0).input.connectsTo(bus)).toBe(true);
      expect(strip(context, 1).input.connectsTo(bus)).toBe(false);

      graph.setMonitor({ kind: 'channel', sourceId: SCREEN });
      expect(strip(context, 0).input.connectsTo(bus)).toBe(false);
      expect(strip(context, 1).input.connectsTo(bus)).toBe(true);

      graph.setMonitor({ kind: 'program' });
      expect(strip(context, 1).input.connectsTo(bus)).toBe(false);
      expect(master.connectsTo(bus)).toBe(true);

      graph.setMonitor({ kind: 'off' });
      expect(master.connectsTo(bus)).toBe(false);
      expect(graph.monitor).toEqual({ kind: 'off' });
    });

    it('stops monitoring a channel that goes away', () => {
      const { graph, context, bus } = setup({ output: 'monitor' });
      graph.setInput(MIC, audioStream());
      graph.setMonitor({ kind: 'channel', sourceId: MIC });
      graph.setInput(MIC, null);
      expect(graph.monitor).toEqual({ kind: 'off' });
      expect(strip(context, 0).input.connectsTo(bus)).toBe(false);
    });

    it('has no monitor on the output page', () => {
      const { graph, bus, master } = setup({ output: 'program' });
      graph.setMonitor({ kind: 'program' });
      expect(graph.monitor).toEqual({ kind: 'off' });
      expect(master.connectsTo(bus)).toBe(false);
    });

    it('sends the sound to another output device where the browser can, and says so where it cannot', async () => {
      const context = new FakeAudioContextWithSink();
      const { graph } = setup({ context, output: 'monitor' });
      expect(graph.canChooseOutputDevice).toBe(true);
      await expect(graph.setSinkId('headphones')).resolves.toBe(true);
      expect(context.sinkId).toBe('headphones');

      context.sinkError = new Error('NotFoundError');
      await expect(graph.setSinkId('gone')).resolves.toBe(false);

      const plain = setup({ output: 'monitor' });
      expect(plain.graph.canChooseOutputDevice).toBe(false);
      await expect(plain.graph.setSinkId('x')).resolves.toBe(false);
    });
  });

  describe('many channels', () => {
    it('mixes 16 channels, applies all of them and releases them on dispose', () => {
      const { graph, context, released } = setup();
      const ids = Array.from({ length: 16 }, (_, index) => `dev_aaaaaaaaaaaaaaa${index}/mic`);
      for (const id of ids) {
        graph.setInput(id, audioStream());
      }
      graph.apply(new Map(ids.map((id, index) => [id, target(index % 2)])), { rampMs: 20 });
      expect(graph.channels).toHaveLength(16);
      expect(strip(context, 1).fader.gain.value).toBe(1);
      expect(strip(context, 2).fader.gain.value).toBe(0);

      graph.dispose();
      expect(released).toHaveLength(16);
    });
  });
});
