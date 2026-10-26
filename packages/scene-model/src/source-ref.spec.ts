import {
  deviceSourceRef,
  screenAudioTrackName,
  trackSource,
  isDeviceSourceRef,
  parseSourceRef,
  screenSlot,
  slotKind,
} from './source-ref';

describe('parseSourceRef', () => {
  it('parses device slots', () => {
    expect(parseSourceRef('dev_ab12cd34ef56gh78/camera')).toEqual({
      kind: 'device',
      deviceId: 'dev_ab12cd34ef56gh78',
      slot: 'camera',
    });
    expect(parseSourceRef('dev_abcd/screen-9')).toEqual({
      kind: 'device',
      deviceId: 'dev_abcd',
      slot: 'screen-9',
    });
  });

  it('parses the microphone slot', () => {
    expect(parseSourceRef('dev_abcd/mic')).toEqual({
      kind: 'device',
      deviceId: 'dev_abcd',
      slot: 'mic',
    });
  });

  it('parses assets', () => {
    expect(parseSourceRef('ast_ab12cd34ef56gh78')).toEqual({
      kind: 'asset',
      assetId: 'ast_ab12cd34ef56gh78',
    });
  });

  it('parses texts', () => {
    expect(parseSourceRef('txt_ab12cd34ef56gh78')).toEqual({
      kind: 'text',
      textId: 'txt_ab12cd34ef56gh78',
    });
  });

  it.each([
    '',
    'txt_',
    'txt_abc',
    'txt_ABCD1234',
    'txt_abcd1234/camera',
    'camera',
    'dev_abcd',
    'dev_abcd/',
    '/camera',
    'dev_abcd/screen-0',
    'dev_abcd/screen-10',
    'dev_abcd/mic-1',
    'dev_abcd/Mic',
    'dev_abcd/screen-1-audio',
    'ast_abcd/camera',
    'scn_abcd',
    'DEV_abcd/camera',
    'dev_ab/camera',
    'dev_abcd/camera/extra',
    'ast_ABCD',
  ])('rejects %j', (ref) => {
    expect(parseSourceRef(ref)).toBeNull();
  });
});

describe('deviceSourceRef / isDeviceSourceRef', () => {
  it('builds references that parse back', () => {
    const ref = deviceSourceRef('dev_abcd', 'screen-2');
    expect(ref).toBe('dev_abcd/screen-2');
    expect(parseSourceRef(ref)).toEqual({ kind: 'device', deviceId: 'dev_abcd', slot: 'screen-2' });
  });

  it('tells device references from assets and garbage', () => {
    expect(isDeviceSourceRef('dev_abcd/camera')).toBe(true);
    expect(isDeviceSourceRef('ast_abcd')).toBe(false);
    expect(isDeviceSourceRef('kaputt')).toBe(false);
  });
});

describe('slotKind / screenSlot', () => {
  it('maps slot names to kinds', () => {
    expect(slotKind('camera')).toBe('camera');
    expect(slotKind('screen-1')).toBe('screen');
    expect(slotKind('screen-9')).toBe('screen');
    expect(slotKind('mic')).toBe('audio');
    expect(slotKind('screen-10')).toBeNull();
    expect(slotKind('screen-1-audio')).toBeNull();
    expect(slotKind('Camera')).toBeNull();
  });

  it('names screen slots', () => {
    expect(screenSlot(1)).toBe('screen-1');
    expect(slotKind(screenSlot(9))).toBe('screen');
  });
});

describe('trackSource', () => {
  it('maps the tracks of a sender to the source they belong to and what they carry', () => {
    expect(trackSource('dev_abcd', 'camera')).toEqual({
      sourceId: 'dev_abcd/camera',
      carries: 'picture',
    });
    expect(trackSource('dev_abcd', 'screen-3')).toEqual({
      sourceId: 'dev_abcd/screen-3',
      carries: 'picture',
    });
    expect(trackSource('dev_abcd', 'mic')).toEqual({ sourceId: 'dev_abcd/mic', carries: 'sound' });
    expect(trackSource('dev_abcd', 'screen-3-audio')).toEqual({
      sourceId: 'dev_abcd/screen-3',
      carries: 'sound',
    });
  });

  it('ignores every other track name', () => {
    for (const name of [
      '',
      'audio',
      'camera-audio',
      'mic-audio',
      'screen-10-audio',
      'screen-0-audio',
      'Mic',
      'x-audio',
    ]) {
      expect(trackSource('dev_abcd', name)).toBeNull();
    }
  });

  it('names the audio track of a screen', () => {
    expect(screenAudioTrackName('screen-2')).toBe('screen-2-audio');
    expect(trackSource('dev_abcd', screenAudioTrackName('screen-2'))?.sourceId).toBe(
      'dev_abcd/screen-2',
    );
  });
});
