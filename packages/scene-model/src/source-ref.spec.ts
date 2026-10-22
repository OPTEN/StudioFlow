import {
  deviceSourceRef,
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

  it('parses assets', () => {
    expect(parseSourceRef('ast_ab12cd34ef56gh78')).toEqual({
      kind: 'asset',
      assetId: 'ast_ab12cd34ef56gh78',
    });
  });

  it.each([
    '',
    'camera',
    'dev_abcd',
    'dev_abcd/',
    '/camera',
    'dev_abcd/screen-0',
    'dev_abcd/screen-10',
    'dev_abcd/mic',
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
    expect(slotKind('screen-10')).toBeNull();
    expect(slotKind('Camera')).toBeNull();
  });

  it('names screen slots', () => {
    expect(screenSlot(1)).toBe('screen-1');
    expect(slotKind(screenSlot(9))).toBe('screen');
  });
});
