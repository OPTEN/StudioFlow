import {
  AUDIO_LIMITS,
  allowedAudioModes,
  canCarrySound,
  clampGainDb,
  clampSyncOffsetMs,
  dbToGain,
  defaultAudioChannel,
  faderPosition,
  faderValue,
  followsPicture,
  gainToDb,
  isChannelAudible,
  sameChannel,
} from './audio';
import {
  audibleChannelIds,
  audioChannelRows,
  audioExpected,
  audioTargets,
  isAudibleInProgram,
} from './audio-selectors';
import type { AudioChannelDto, AudioChannelsChangedEvent, BroadcastState } from './contracts';
import { applyEvent, stateFromSnapshot, type ProductionState } from './production-state';
import {
  assetFixture,
  assetSourceFixture,
  audioChannelFixture,
  deviceFixture,
  deviceSourceFixture,
  itemFixture,
  productionFixture,
  sceneFixture,
  snapshotFixture,
} from './testing/fixtures';

const STATION_MIC = 'dev_station/mic';
const PHONE_MIC = 'dev_phone/mic';
const PHONE_CAMERA = 'dev_phone/camera';
const OTHER_CAMERA = 'dev_other/camera';
const SCREEN = 'dev_laptop/screen-1';
const SCREEN_2 = 'dev_laptop/screen-2';
const VIDEO = 'ast_video0001';

function channelsChanged(revision: number, channels: AudioChannelDto[]): AudioChannelsChangedEvent {
  return { type: 'audioChannelsChanged', revision, channels };
}

/** A live production: the program scene shows the phone camera and the first screen; the preview shows another camera. */
function mixState(
  channels: readonly AudioChannelDto[],
  options: {
    broadcast?: BroadcastState;
    previewSceneId?: string | null;
    programItems?: ReturnType<typeof itemFixture>[];
  } = {},
): ProductionState {
  return stateFromSnapshot(
    snapshotFixture({
      production: productionFixture({
        programSceneId: 'scn_pgm',
        previewSceneId: options.previewSceneId === undefined ? 'scn_pvw' : options.previewSceneId,
        broadcast: options.broadcast ?? 'live',
      }),
      scenes: [
        sceneFixture(
          'scn_pgm',
          0,
          options.programItems ?? [
            itemFixture('itm_1', PHONE_CAMERA),
            itemFixture('itm_2', SCREEN),
            itemFixture('itm_3', OTHER_CAMERA, { hidden: true }),
          ],
        ),
        sceneFixture('scn_pvw', 1, [
          itemFixture('itm_4', OTHER_CAMERA),
          itemFixture('itm_5', VIDEO),
        ]),
      ],
      sources: [
        deviceSourceFixture('dev_station', 'mic', 'A1'),
        deviceSourceFixture('dev_phone', 'mic', 'A2'),
        deviceSourceFixture('dev_phone', 'camera', 'K1'),
        deviceSourceFixture('dev_other', 'camera', 'K2'),
        deviceSourceFixture('dev_laptop', 'screen-1', 'S1'),
        deviceSourceFixture('dev_laptop', 'screen-2', 'S2'),
        assetSourceFixture(VIDEO, 'M1', 'video'),
      ],
      devices: [
        deviceFixture('dev_station', 'Mixing desk', { kind: 'audioStation' }),
        deviceFixture('dev_phone', 'Phone'),
        deviceFixture('dev_laptop', 'Laptop', { kind: 'laptop' }),
      ],
      assets: [assetFixture(VIDEO, 'M1', { kind: 'video', hasAudio: true })],
      audioChannels: [...channels],
    }),
  );
}

describe('the gain scale', () => {
  it('turns dB into a linear factor and back', () => {
    expect(dbToGain(0)).toBe(1);
    expect(dbToGain(-6)).toBeCloseTo(0.501, 3);
    expect(dbToGain(10)).toBeCloseTo(3.162, 3);
    expect(gainToDb(1)).toBe(0);
    expect(gainToDb(dbToGain(-12.5))).toBeCloseTo(-12.5, 6);
  });

  it('treats the floor and everything below it as exactly silent', () => {
    expect(dbToGain(AUDIO_LIMITS.minGainDb)).toBe(0);
    expect(dbToGain(-250)).toBe(0);
    expect(dbToGain(Number.NEGATIVE_INFINITY)).toBe(0);
    expect(dbToGain(Number.NaN)).toBe(0);
    expect(gainToDb(0)).toBe(AUDIO_LIMITS.minGainDb);
    expect(gainToDb(1e-12)).toBe(AUDIO_LIMITS.minGainDb);
  });

  it('clamps the fader and the sync offset to the limits of the API', () => {
    expect(clampGainDb(11)).toBe(10);
    expect(clampGainDb(-101)).toBe(-100);
    expect(clampGainDb(Number.NaN)).toBe(0);
    expect(clampGainDb(-6.5)).toBe(-6.5);
    expect(clampSyncOffsetMs(501)).toBe(500);
    expect(clampSyncOffsetMs(-3)).toBe(0);
    expect(clampSyncOffsetMs(12.6)).toBe(13);
    expect(clampSyncOffsetMs(Number.NaN)).toBe(0);
  });

  it('maps the fader travel to dB and back, silence at the bottom and +10 dB at the top', () => {
    expect(faderPosition(AUDIO_LIMITS.minGainDb)).toBe(0);
    expect(faderPosition(AUDIO_LIMITS.maxGainDb)).toBe(1);
    expect(faderValue(0)).toBe(AUDIO_LIMITS.minGainDb);
    expect(faderValue(1)).toBe(AUDIO_LIMITS.maxGainDb);
    for (const db of [-60, -40, -20, -6, 0, 3.5, 10]) {
      expect(faderValue(faderPosition(db))).toBeCloseTo(db, 1);
    }
    expect(faderPosition(-30)).toBeLessThan(faderPosition(0));
    expect(faderValue(-1)).toBe(AUDIO_LIMITS.minGainDb);
    expect(faderValue(2)).toBe(AUDIO_LIMITS.maxGainDb);
  });
});

describe('defaultAudioChannel', () => {
  it('starts an audio station always audible and a device microphone muted', () => {
    expect(defaultAudioChannel(STATION_MIC, 'audio', 'audioStation')).toEqual({
      sourceId: STATION_MIC,
      gainDb: 0,
      muted: false,
      mode: 'always',
      syncOffsetMs: 0,
    });
    expect(defaultAudioChannel(PHONE_MIC, 'audio', 'phone')).toMatchObject({
      muted: true,
      mode: 'follow',
    });
    expect(defaultAudioChannel(PHONE_MIC, 'audio')).toMatchObject({ muted: true, mode: 'follow' });
  });

  it('lets the sound of screens and videos follow their picture', () => {
    expect(defaultAudioChannel(SCREEN, 'screen')).toMatchObject({ muted: false, mode: 'follow' });
    expect(defaultAudioChannel(VIDEO, 'video')).toMatchObject({ muted: false, mode: 'follow' });
  });
});

describe('what can carry sound', () => {
  it('knows the kinds', () => {
    expect(['audio', 'screen', 'video'].every((kind) => canCarrySound(kind as 'audio'))).toBe(true);
    expect(['camera', 'image', 'text'].some((kind) => canCarrySound(kind as 'camera'))).toBe(false);
  });

  it('keeps the sound of a video attached to its picture', () => {
    expect(allowedAudioModes('video')).toEqual(['follow', 'off']);
    expect(allowedAudioModes('audio')).toEqual(['always', 'follow', 'off']);
    expect(allowedAudioModes('screen')).toEqual(['always', 'follow', 'off']);
  });
});

describe('followsPicture', () => {
  it('follows every source of the device for a microphone', () => {
    expect(followsPicture(PHONE_MIC, new Set([PHONE_CAMERA]))).toBe(true);
    expect(followsPicture('dev_laptop/mic', new Set([SCREEN_2, OTHER_CAMERA]))).toBe(true);
    expect(followsPicture(PHONE_MIC, new Set([OTHER_CAMERA, VIDEO]))).toBe(false);
    expect(followsPicture(PHONE_MIC, new Set())).toBe(false);
  });

  it('needs its own item for a screen or a video', () => {
    expect(followsPicture(SCREEN, new Set([SCREEN]))).toBe(true);
    expect(followsPicture(SCREEN, new Set([SCREEN_2, 'dev_laptop/camera']))).toBe(false);
    expect(followsPicture(VIDEO, new Set([VIDEO]))).toBe(true);
    expect(followsPicture(VIDEO, new Set(['ast_video0002']))).toBe(false);
  });
});

describe('isChannelAudible', () => {
  const on = (overrides: Partial<AudioChannelDto> = {}): AudioChannelDto =>
    audioChannelFixture(STATION_MIC, { mode: 'always', ...overrides });

  it.each<[string, Partial<AudioChannelDto>, BroadcastState, boolean]>([
    ['always, live', {}, 'live', true],
    ['always, +10 dB', { gainDb: 10 }, 'live', true],
    ['always, the lowest audible position', { gainDb: -99.9 }, 'live', true],
    ['always, fader at the floor', { gainDb: -100 }, 'live', false],
    ['always, muted', { muted: true }, 'live', false],
    ['off', { mode: 'off' }, 'live', false],
    ['always, standby', {}, 'standby', false],
    ['always, ended', {}, 'ended', false],
  ])('%s', (_name, overrides, broadcast, expected) => {
    expect(isChannelAudible(on(overrides), broadcast, new Set())).toBe(expected);
  });

  it('lets a follow channel through only with its picture in the program', () => {
    const follow = audioChannelFixture(SCREEN, { mode: 'follow' });
    expect(isChannelAudible(follow, 'live', new Set([SCREEN]))).toBe(true);
    expect(isChannelAudible(follow, 'live', new Set([SCREEN_2]))).toBe(false);
    expect(isChannelAudible(follow, 'standby', new Set([SCREEN]))).toBe(false);
  });
});

describe('sameChannel', () => {
  it('compares every field and refuses a missing channel', () => {
    const channel = audioChannelFixture(SCREEN);
    expect(sameChannel(channel, { ...channel })).toBe(true);
    expect(sameChannel(channel, { ...channel, gainDb: -1 })).toBe(false);
    expect(sameChannel(channel, { ...channel, muted: true })).toBe(false);
    expect(sameChannel(channel, { ...channel, mode: 'off' })).toBe(false);
    expect(sameChannel(channel, { ...channel, syncOffsetMs: 1 })).toBe(false);
    expect(sameChannel(channel, undefined)).toBe(false);
    expect(sameChannel(undefined, undefined)).toBe(false);
  });
});

describe('audible in the program', () => {
  const channels = [
    audioChannelFixture(STATION_MIC, { mode: 'always' }),
    audioChannelFixture(PHONE_MIC, { mode: 'follow' }),
    audioChannelFixture(SCREEN, { mode: 'follow' }),
    audioChannelFixture(SCREEN_2, { mode: 'follow' }),
    audioChannelFixture(VIDEO, { mode: 'follow' }),
  ];

  it('is the always channels plus the follow channels whose picture is in the program', () => {
    expect([...audibleChannelIds(mixState(channels))].sort()).toEqual(
      [PHONE_MIC, SCREEN, STATION_MIC].sort(),
    );
  });

  it('ignores the preview of Studio Mode: only the program scene counts', () => {
    // The video is only in the preview scene, the hidden camera of the program does not count either.
    const state = mixState(channels);
    expect(isAudibleInProgram(state, VIDEO)).toBe(false);
    expect(isAudibleInProgram(state, SCREEN_2)).toBe(false);
    const withoutPreview = mixState(channels, { previewSceneId: null });
    expect([...audibleChannelIds(withoutPreview)]).toEqual([...audibleChannelIds(state)]);
  });

  it('follows the program after a switch', () => {
    const state = mixState(channels);
    const switched = applyEvent(state, {
      type: 'programSwitched',
      revision: state.revision + 1,
      programSceneId: 'scn_pvw',
      previewSceneId: 'scn_pgm',
      previousProgramSceneId: 'scn_pgm',
      transition: { kind: 'fade', durationMs: 500 },
      at: '2026-10-22T10:00:01.000Z',
    }).state;
    expect([...audibleChannelIds(switched)].sort()).toEqual([STATION_MIC, VIDEO].sort());
  });

  it('does not count hidden items', () => {
    const state = mixState(channels, {
      programItems: [itemFixture('itm_1', PHONE_CAMERA, { hidden: true })],
    });
    expect([...audibleChannelIds(state)]).toEqual([STATION_MIC]);
  });

  it.each<BroadcastState>(['standby', 'ended'])('is silent in %s for every mode', (broadcast) => {
    expect(audibleChannelIds(mixState(channels, { broadcast })).size).toBe(0);
    const targets = audioTargets(mixState(channels, { broadcast }));
    expect([...targets.values()].every((target) => target.gain === 0 && !target.audible)).toBe(
      true,
    );
  });

  it('reacts to mute, off and the fader floor', () => {
    const muted = mixState([audioChannelFixture(STATION_MIC, { mode: 'always', muted: true })]);
    const off = mixState([audioChannelFixture(STATION_MIC, { mode: 'off' })]);
    const floor = mixState([audioChannelFixture(STATION_MIC, { mode: 'always', gainDb: -100 })]);
    expect([muted, off, floor].map((state) => isAudibleInProgram(state, STATION_MIC))).toEqual([
      false,
      false,
      false,
    ]);
  });

  it('knows nothing about a source without a channel', () => {
    expect(isAudibleInProgram(mixState([]), STATION_MIC)).toBe(false);
  });
});

describe('audioTargets', () => {
  it('gives every channel its gain and delay, zero while it is not audible', () => {
    const state = mixState([
      audioChannelFixture(STATION_MIC, { mode: 'always', gainDb: -6, syncOffsetMs: 120 }),
      audioChannelFixture(SCREEN_2, { gainDb: 3 }),
    ]);
    const targets = audioTargets(state);
    expect(targets.get(STATION_MIC)).toEqual({ gain: dbToGain(-6), delayMs: 120, audible: true });
    expect(targets.get(SCREEN_2)).toEqual({ gain: 0, delayMs: 0, audible: false });
  });

  it('copes with many channels', () => {
    const many = Array.from({ length: 40 }, (_, index) =>
      audioChannelFixture(`dev_d${index}/mic`, { mode: 'always', gainDb: -index }),
    );
    const targets = audioTargets(mixState(many));
    expect(targets.size).toBe(40);
    expect([...targets.values()].every((target) => target.audible)).toBe(true);
  });
});

describe('audioExpected', () => {
  it('is true when some channel could be heard once the broadcast is live', () => {
    expect(audioExpected(mixState([audioChannelFixture(PHONE_MIC, { muted: false })]))).toBe(true);
    expect(audioExpected(mixState([], { broadcast: 'standby' }))).toBe(false);
    expect(
      audioExpected(
        mixState([
          audioChannelFixture(PHONE_MIC, { muted: true }),
          audioChannelFixture(STATION_MIC, { mode: 'off' }),
          audioChannelFixture(SCREEN, { gainDb: -100 }),
        ]),
      ),
    ).toBe(false);
  });
});

describe('audioChannelRows', () => {
  it('lists stations first, then microphones, screens and videos by code, and skips channels of unknown sources', () => {
    const rows = audioChannelRows(
      mixState([
        audioChannelFixture(VIDEO),
        audioChannelFixture(SCREEN_2),
        audioChannelFixture(PHONE_MIC),
        audioChannelFixture(SCREEN),
        audioChannelFixture(STATION_MIC),
        audioChannelFixture('dev_gone/mic'),
      ]),
    );
    expect(rows.map((row) => [row.source.code, row.role])).toEqual([
      ['A1', 'station'],
      ['A2', 'microphone'],
      ['S1', 'screen'],
      ['S2', 'screen'],
      ['M1', 'video'],
    ]);
  });
});

describe('the audio mixer in the production state', () => {
  it('is built from the snapshot and changed by revisioned events', () => {
    const state = mixState([audioChannelFixture(STATION_MIC, { mode: 'always' })]);
    expect(state.audioChannels.get(STATION_MIC)?.gainDb).toBe(0);

    const changed = applyEvent(
      state,
      channelsChanged(state.revision + 1, [
        audioChannelFixture(STATION_MIC, { mode: 'always', gainDb: -9 }),
      ]),
    );

    expect(changed.result).toBe('applied');
    expect(changed.state.audioChannels.get(STATION_MIC)?.gainDb).toBe(-9);
    expect(state.audioChannels.get(STATION_MIC)?.gainDb).toBe(0);
  });

  it('adds a channel that is new and leaves the others alone', () => {
    const state = mixState([audioChannelFixture(STATION_MIC, { mode: 'always' })]);
    const next = applyEvent(
      state,
      channelsChanged(state.revision + 1, [audioChannelFixture(SCREEN, { gainDb: -3 })]),
    ).state;
    expect([...next.audioChannels.keys()].sort()).toEqual([SCREEN, STATION_MIC].sort());
    expect(next.audioChannels.get(STATION_MIC)).toBe(state.audioChannels.get(STATION_MIC));
  });

  it('keeps the map when an event repeats what is already there', () => {
    const state = mixState([audioChannelFixture(STATION_MIC, { mode: 'always' })]);
    const next = applyEvent(
      state,
      channelsChanged(state.revision + 1, [audioChannelFixture(STATION_MIC, { mode: 'always' })]),
    ).state;
    expect(next.audioChannels).toBe(state.audioChannels);
  });

  it('drops the channel together with its source', () => {
    const state = mixState([audioChannelFixture(PHONE_MIC), audioChannelFixture(STATION_MIC)]);
    const next = applyEvent(state, {
      type: 'sourceRemoved',
      revision: state.revision + 1,
      sourceId: PHONE_MIC,
    }).state;
    expect([...next.audioChannels.keys()]).toEqual([STATION_MIC]);
  });

  it('reports a gap and ignores an event that is already covered', () => {
    const state = mixState([audioChannelFixture(STATION_MIC)]);
    const event = (revision: number) =>
      channelsChanged(revision, [audioChannelFixture(STATION_MIC, { gainDb: -1 })]);
    expect(applyEvent(state, event(state.revision + 2)).result).toBe('gap');
    expect(applyEvent(state, event(state.revision)).result).toBe('ignored');
  });

  it('two Regie sessions that apply the same events end in the same mixer', () => {
    const base = mixState([
      audioChannelFixture(STATION_MIC, { mode: 'always' }),
      audioChannelFixture(SCREEN),
    ]);
    const events = [
      channelsChanged(base.revision + 1, [
        audioChannelFixture(STATION_MIC, { mode: 'always', gainDb: -4 }),
      ]),
      channelsChanged(base.revision + 2, [audioChannelFixture(SCREEN, { muted: true })]),
      channelsChanged(base.revision + 3, [
        audioChannelFixture(STATION_MIC, { mode: 'off', gainDb: -4 }),
      ]),
    ];
    const first = events.reduce((state, event) => applyEvent(state, event).state, base);
    const second = events.reduce((state, event) => applyEvent(state, event).state, base);
    expect([...first.audioChannels]).toEqual([...second.audioChannels]);
    expect(first.audioChannels.get(STATION_MIC)).toMatchObject({ mode: 'off', gainDb: -4 });
    expect(first.audioChannels.get(SCREEN)?.muted).toBe(true);
  });
});
