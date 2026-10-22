import { sourceFixture } from '../../../testing/fixtures';
import {
  isMediaKind,
  sourceLamp,
  sourceStateView,
  statusHasTimer,
  statusLamp,
  toneClass,
} from './source-view';

describe('source view helpers', () => {
  it('maps every status to the prototype lamp', () => {
    expect(statusLamp('ok')).toBe('');
    expect(statusLamp('reconnecting')).toBe('is-warn');
    expect(statusLamp('ended')).toBe('is-bad');
    expect(statusLamp('lost')).toBe('is-bad');
    expect(statusLamp('blocked')).toBe('is-bad');
    expect(statusLamp('connecting')).toBe('is-idle');
    expect(statusLamp('offline')).toBe('is-idle');
  });

  it('gives media no lamp and deleted sources an idle lamp', () => {
    const image = sourceFixture('dev_aaaaaaaaaaaaaaaa', 'camera', 'M1', { kind: 'image' });
    expect(sourceLamp(image)).toBeNull();
    expect(sourceLamp(null)).toBe('is-idle');
    expect(isMediaKind('video')).toBe(true);
    expect(isMediaKind('screen')).toBe(false);
  });

  it('describes the state line with word, tone and timer', () => {
    const source = (status: Parameters<typeof statusLamp>[0]) =>
      sourceFixture('dev_aaaaaaaaaaaaaaaa', 'screen-1', 'S1', { status });
    expect(sourceStateView(source('ok'))).toBeNull();
    expect(sourceStateView(source('reconnecting'))).toEqual({
      word: 'verbindet neu',
      tone: 'warn',
      timer: true,
    });
    expect(sourceStateView(source('ended'))).toEqual({
      word: 'Teilen beendet',
      tone: 'bad',
      timer: true,
    });
    expect(sourceStateView(source('blocked'))).toEqual({
      word: 'gesperrt',
      tone: 'bad',
      timer: false,
    });
    expect(sourceStateView(source('connecting'))?.tone).toBe('muted');
    const camera = sourceFixture('dev_aaaaaaaaaaaaaaaa', 'camera', 'K1', { status: 'ended' });
    expect(sourceStateView(camera)?.word).toBe('Kamera beendet');
    expect(statusHasTimer('offline')).toBe(false);
    expect(toneClass('warn')).toBe('c-state--warn');
  });
});
