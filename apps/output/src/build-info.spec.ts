import { BUILD_VERSION, UNKNOWN_VERSION, formatBuildVersion } from './build-info';

describe('formatBuildVersion', () => {
  it('appends the first seven characters of the commit as build metadata', () => {
    expect(formatBuildVersion('0.1.0', '1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b')).toBe(
      '0.1.0+1a2b3c4',
    );
  });

  it('keeps a short commit and ignores case and surrounding whitespace', () => {
    expect(formatBuildVersion('0.4.2', ' 1A2B3C4\n')).toBe('0.4.2+1a2b3c4');
    expect(formatBuildVersion('0.4.2', 'abcd')).toBe('0.4.2+abcd');
  });

  it('shows just the version without a commit', () => {
    expect(formatBuildVersion('0.1.0')).toBe('0.1.0');
    expect(formatBuildVersion('0.1.0', undefined)).toBe('0.1.0');
    expect(formatBuildVersion('0.1.0', null)).toBe('0.1.0');
    expect(formatBuildVersion('0.1.0', '')).toBe('0.1.0');
    expect(formatBuildVersion('0.1.0', '   ')).toBe('0.1.0');
  });

  it('leaves out a commit that is not a hash instead of showing it', () => {
    expect(formatBuildVersion('0.1.0', 'main')).toBe('0.1.0');
    expect(formatBuildVersion('0.1.0', '<script>')).toBe('0.1.0');
    expect(formatBuildVersion('0.1.0', 'abc')).toBe('0.1.0');
    expect(formatBuildVersion('0.1.0', 'zzzzzzz')).toBe('0.1.0');
  });
});

describe('BUILD_VERSION', () => {
  it('falls back to 0.0.0 where the build tool defines nothing', () => {
    expect(BUILD_VERSION).toBe(UNKNOWN_VERSION);
  });
});
