import type { MessageKey } from './catalogue';
import { msg, t } from './translate';
import type { Namespace, Translation } from './types';

/**
 * Compile-time contract of the message types. The functions are never called: the `@ts-expect-error` lines fail the
 * type check (`npm run typecheck`) as soon as the error they expect goes away.
 */
describe('types', () => {
  it('rejects keys outside the prefix of a namespace file', () => {
    // @ts-expect-error the key does not start with "regie.scenes."
    const outside = { 'common.ok': 'OK' } as const satisfies Namespace<'regie.scenes'>;
    // @ts-expect-error a number is not a message
    const wrongValue = { 'regie.scenes.title': 3 } as const satisfies Namespace<'regie.scenes'>;
    const inside = { 'regie.scenes.title': 'Scenes' } as const satisfies Namespace<'regie.scenes'>;
    expect([outside, wrongValue, inside]).toHaveLength(3);
  });

  it('requires a translation to mirror the English keys and shapes', () => {
    const en = { 'x.one': 'One', 'x.many': { one: '{count} a', other: '{count} b' } } as const;
    // @ts-expect-error 'x.many' is missing
    const missing: Translation<typeof en> = { 'x.one': 'Eins' };
    const extra: Translation<typeof en> = {
      'x.one': 'Eins',
      'x.many': { other: 'b' },
      // @ts-expect-error 'x.extra' does not exist in English
      'x.extra': 'z',
    };
    // @ts-expect-error a plain string where a plural message is expected
    const flat: Translation<typeof en> = { 'x.one': 'Eins', 'x.many': 'viele' };
    const complete: Translation<typeof en> = {
      'x.one': 'Eins',
      'x.many': { one: '{count} a', other: '{count} b' },
    };
    expect([missing, extra, flat, complete]).toHaveLength(4);
  });

  it('checks the key and the parameters of t() and msg()', () => {
    const never = (): void => {
      // @ts-expect-error unknown key
      t('regie.nonsense');
      // @ts-expect-error missing parameter
      t('regie.log.sceneLive');
      // @ts-expect-error unknown parameter name
      t('regie.log.sceneLive', { name: 'x' });
      // @ts-expect-error a plural message needs a count
      t('model.format.itemCount');
      // @ts-expect-error a count must be a number
      t('model.format.itemCount', { count: '2' });
      // @ts-expect-error a message without placeholders takes no parameters
      t('common.ok', { x: 1 });
      // @ts-expect-error msg() checks like t()
      msg('regie.log.sceneLive');
      t('common.ok');
      t('regie.log.sceneLive', { scene: 'Break' });
      t('model.format.itemCount', { count: 2 });
      t('regie.log.sourceRecovered', { code: 'K1', downtime: '9 s' });
    };
    expect(never).toBeTypeOf('function');
  });

  it('narrows template literal keys to the matching messages', () => {
    const failure = 'in-use' as 'in-use' | 'not-found';
    const never = (): void => {
      t(`media.slot.failure.${failure}`);
      // @ts-expect-error there is no failure code "gone"
      t(`media.slot.failure.${'gone' as 'gone'}`);
      const key: MessageKey = 'common.ok';
      t(key);
    };
    expect(never).toBeTypeOf('function');
  });
});
