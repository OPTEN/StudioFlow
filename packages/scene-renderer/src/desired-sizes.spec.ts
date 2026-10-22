import { DesiredSizeCollector, DesiredSizeReporter, preloadRequests } from './desired-sizes';
import { CAMERA, CAMERA_2, IMAGE, scene, sceneItem, SCREEN } from './testing/fixtures';
import { FakeProvider } from './testing/fake-provider';

describe('DesiredSizeCollector', () => {
  it('keeps the larger size per axis for repeated sources', () => {
    const collector = new DesiredSizeCollector();
    collector.add('a', { width: 320, height: 720 });
    collector.add('a', { width: 640, height: 180 });
    collector.add('b', { width: 16, height: 16 });
    expect([...collector.result()]).toEqual([
      ['a', { width: 640, height: 720 }],
      ['b', { width: 16, height: 16 }],
    ]);
  });
});

describe('DesiredSizeReporter', () => {
  function setup(): { provider: FakeProvider; reporter: DesiredSizeReporter } {
    const provider = new FakeProvider();
    return { provider, reporter: new DesiredSizeReporter(provider, 'c1', (run) => run()) };
  }

  it('sends only changes and withdraws sources that are gone', () => {
    const { provider, reporter } = setup();
    reporter.sync(new Map([['a', { width: 640, height: 368 }]]));
    reporter.sync(new Map([['a', { width: 640, height: 368 }]]));
    expect(provider.sizeCalls).toHaveLength(1);

    reporter.sync(
      new Map([
        ['a', { width: 960, height: 544 }],
        ['b', { width: 320, height: 180 }],
      ]),
    );
    reporter.sync(new Map([['b', { width: 320, height: 180 }]]));
    expect(provider.sizeCalls.slice(1)).toEqual([
      { sourceId: 'a', consumerId: 'c1', size: { width: 960, height: 544 } },
      { sourceId: 'b', consumerId: 'c1', size: { width: 320, height: 180 } },
      { sourceId: 'a', consumerId: 'c1', size: null },
    ]);
  });

  it('clears everything', () => {
    const { provider, reporter } = setup();
    reporter.sync(
      new Map([
        ['a', { width: 640, height: 368 }],
        ['b', { width: 16, height: 16 }],
      ]),
    );
    reporter.clear();
    expect(provider.desiredCount).toBe(0);
    reporter.clear();
    expect(provider.sizeCalls).toHaveLength(4);
  });

  it('keeps going when the provider throws', () => {
    const provider = new FakeProvider();
    const errors: unknown[] = [];
    const reporter = new DesiredSizeReporter(provider, 'c1', (run) => {
      try {
        run();
      } catch (error) {
        errors.push(error);
      }
    });
    vi.spyOn(provider, 'setDesiredSize').mockImplementationOnce(() => {
      throw new Error('boom');
    });
    reporter.sync(
      new Map([
        ['a', { width: 16, height: 16 }],
        ['b', { width: 16, height: 16 }],
      ]),
    );
    expect(errors).toHaveLength(1);
    expect(provider.desired().has('b')).toBe(true);
  });
});

describe('preloadRequests', () => {
  it('asks for a small picture of visible device sources that are not on stage', () => {
    const requests = preloadRequests(
      [
        scene('scn_a', [
          sceneItem('a', CAMERA),
          sceneItem('b', IMAGE),
          sceneItem('c', SCREEN, { hidden: true }),
        ]),
        scene('scn_b', [sceneItem('d', CAMERA_2), sceneItem('e', CAMERA)]),
      ],
      new Map([[CAMERA_2, { width: 1920, height: 1088 }]]),
    );
    expect(requests).toEqual(new Map([[CAMERA, { width: 320, height: 180 }]]));
  });

  it('skips malformed scenes and items', () => {
    const malformed = [
      null,
      scene('scn_x', null as unknown as []),
      scene('scn_y', [null, { id: 'z' }] as unknown as []),
    ] as unknown as Parameters<typeof preloadRequests>[0];
    expect(preloadRequests(malformed, new Map()).size).toBe(0);
  });
});
