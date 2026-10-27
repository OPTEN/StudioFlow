import { stateFromSnapshot, type AssetDto } from '@studioflow/scene-model';
import {
  audioChannelFixture,
  deviceFixture,
  itemFixture,
  productionFixture,
  sceneFixture,
  snapshotFixture,
  sourceFixture,
} from '../../../testing/fixtures';
import { audioRowViews, meterFill, rowStateWord, showsRow, type AudioRowView } from './audio-rows';

const DESK = 'dev_cccccccccccccccc/mic';
const PHONE_MIC = 'dev_aaaaaaaaaaaaaaaa/mic';
const SCREEN = 'dev_bbbbbbbbbbbbbbbb/screen-1';
const CLIP = 'ast_aaaaaaaaaaaaaaaa';
const SILENT_CLIP = 'ast_bbbbbbbbbbbbbbbb';

function asset(id: string, hasAudio: boolean): AssetDto {
  return {
    id,
    code: id === CLIP ? 'M1' : 'M2',
    kind: 'video',
    name: id,
    contentType: 'video/webm',
    sizeBytes: 100,
    width: 640,
    height: 360,
    hasAudio,
    createdAt: '2026-10-22T09:00:00.000Z',
    contentUrl: `/api/assets/${id}`,
  };
}

function state(broadcast: 'live' | 'standby' = 'live') {
  return stateFromSnapshot(
    snapshotFixture({
      production: productionFixture({ broadcast, programSceneId: 'scn_a' }),
      scenes: [
        sceneFixture('scn_a', 'Welcome', 0, [
          itemFixture('itm_a1', SCREEN),
          itemFixture('itm_a2', CLIP),
        ]),
      ],
      devices: [
        deviceFixture('dev_aaaaaaaaaaaaaaaa', 'Phone'),
        deviceFixture('dev_bbbbbbbbbbbbbbbb', 'Laptop', { kind: 'laptop' }),
        deviceFixture('dev_cccccccccccccccc', 'Mixing desk', { kind: 'audioStation' }),
      ],
      sources: [
        sourceFixture('dev_aaaaaaaaaaaaaaaa', 'mic', 'A2', { label: 'Phone · Microphone' }),
        sourceFixture('dev_bbbbbbbbbbbbbbbb', 'screen-1', 'S1'),
        sourceFixture('dev_cccccccccccccccc', 'mic', 'A1', { label: 'Mixing desk' }),
        {
          id: CLIP,
          code: 'M1',
          kind: 'video',
          label: 'Intro film',
          deviceId: null,
          slot: null,
          assetId: CLIP,
          status: 'ok',
          statusSince: null,
          text: null,
        },
        {
          id: SILENT_CLIP,
          code: 'M2',
          kind: 'video',
          label: 'Silent film',
          deviceId: null,
          slot: null,
          assetId: SILENT_CLIP,
          status: 'ok',
          statusSince: null,
          text: null,
        },
      ],
      audioChannels: [
        audioChannelFixture(DESK, { mode: 'always' }),
        audioChannelFixture(PHONE_MIC, { muted: true }),
        audioChannelFixture(SCREEN),
        audioChannelFixture(CLIP),
        audioChannelFixture(SILENT_CLIP),
      ],
      assets: [asset(CLIP, true), asset(SILENT_CLIP, false)],
    }),
  );
}

describe('audioRowViews', () => {
  it('lists the audio station first, then microphones, screens and videos', () => {
    const rows = audioRowViews(state(), state().audioChannels, new Set([SCREEN]));
    expect(rows.map((row) => row.code)).toEqual(['A1', 'A2', 'S1', 'M1']);
    expect(rows.map((row) => row.role)).toEqual(['station', 'microphone', 'screen', 'video']);
    expect(rows[0]).toMatchObject({
      name: 'Mixing desk',
      roleText: 'Audio station',
      icon: 'mic',
      dbText: '0.0',
      position: expect.closeTo(0.04 + 0.96 * (60 / 70), 5),
    });
  });

  it('shows a screen only while it has a sound, and a video only when the file has one', () => {
    expect(audioRowViews(state(), state().audioChannels, new Set()).map((row) => row.code)).toEqual(
      ['A1', 'A2', 'M1'],
    );
    const codes = audioRowViews(state(), state().audioChannels, new Set([SCREEN])).map(
      (row) => row.code,
    );
    expect(codes).toContain('S1');
    expect(codes).not.toContain('M2');
  });

  it('marks the channels that are audible in the program', () => {
    const rows = audioRowViews(state(), state().audioChannels, new Set([SCREEN]));
    const onAir = Object.fromEntries(rows.map((row) => [row.code, row.onAir]));
    expect(onAir).toEqual({ A1: true, A2: false, S1: true, M1: true });
    const standby = audioRowViews(state('standby'), state().audioChannels, new Set([SCREEN]));
    expect(standby.every((row) => !row.onAir)).toBe(true);
  });

  it('shows the pending changes of the controls over the stored channels', () => {
    const channels = new Map(state().audioChannels);
    channels.set(DESK, audioChannelFixture(DESK, { mode: 'always', gainDb: -6, muted: true }));
    const [desk] = audioRowViews(state(), channels, new Set());
    expect(desk.channel).toMatchObject({ gainDb: -6, muted: true });
    expect(desk.dbText).toBe('−6.0');
  });

  it('gives a video only the modes that make sense', () => {
    const rows = audioRowViews(state(), state().audioChannels, new Set([SCREEN]));
    expect(rows.find((row) => row.role === 'video')?.modes).toEqual(['follow', 'off']);
    expect(rows.find((row) => row.role === 'station')?.modes).toEqual(['always', 'follow', 'off']);
  });

  it('knows whether a channel has a sound', () => {
    const rows = audioRowViews(state(), state().audioChannels, new Set([DESK]));
    expect(rows.find((row) => row.code === 'A1')?.hasSound).toBe(true);
    expect(rows.find((row) => row.code === 'A2')?.hasSound).toBe(false);
  });

  it('has no rows without channels', () => {
    const empty = stateFromSnapshot(snapshotFixture());
    expect(audioRowViews(empty, empty.audioChannels, new Set())).toEqual([]);
  });
});

describe('showsRow', () => {
  it('always shows microphones', () => {
    const source = sourceFixture('dev_aaaaaaaaaaaaaaaa', 'mic', 'A2');
    expect(showsRow('microphone', source, state(), new Set())).toBe(true);
    expect(showsRow('station', source, state(), new Set())).toBe(true);
  });
});

describe('rowStateWord', () => {
  function row(
    overrides: Partial<AudioRowView> & { muted?: boolean; mode?: 'always' | 'off' } = {},
  ) {
    const { muted = false, mode = 'always', ...rest } = overrides;
    return {
      ...audioRowViews(state(), state().audioChannels, new Set([DESK]))[0],
      channel: audioChannelFixture(DESK, { muted, mode }),
      ...rest,
    };
  }

  it('says nothing while all is well', () => {
    expect(rowStateWord(row(), false)).toBeNull();
  });

  it('puts the silence warning before everything else', () => {
    expect(rowStateWord(row({ muted: true }), true)).toBe('no signal for 10 s');
  });

  it('says muted, and no sound for a channel that is on but has none', () => {
    expect(rowStateWord(row({ muted: true }), false)).toBe('muted');
    expect(rowStateWord(row({ hasSound: false }), false)).toBe('no sound');
    expect(rowStateWord(row({ hasSound: false, mode: 'off' }), false)).toBeNull();
  });
});

describe('meterFill', () => {
  it('maps −60 dBFS to empty and 0 dBFS to full', () => {
    expect(meterFill(-60)).toBe(0);
    expect(meterFill(-30)).toBe(0.5);
    expect(meterFill(0)).toBe(1);
    expect(meterFill(6)).toBe(1);
    expect(meterFill(-100)).toBe(0);
    expect(meterFill(undefined)).toBe(0);
    expect(meterFill(Number.NaN)).toBe(0);
  });
});
