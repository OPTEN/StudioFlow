import { DEFAULT_CANVAS, autoGridSlots } from '@studioflow/scene-model';

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
  const GEOMETRY = { canvas: DEFAULT_CANVAS, scale: 1, devicePixelRatio: 1 };

  it('asks for visible device sources at the size they will have on stage, and for nothing else', () => {
    const requests = preloadRequests(
      [
        scene('scn_a', [
          sceneItem('a', CAMERA, { x: 0, y: 0, w: 960, h: 540 }),
          sceneItem('b', IMAGE),
          sceneItem('c', SCREEN, { hidden: true }),
        ]),
        scene('scn_b', [
          sceneItem('d', CAMERA_2, { w: 480, h: 270 }),
          sceneItem('e', CAMERA, { w: 320, h: 180 }),
        ]),
      ],
      new Map(),
      GEOMETRY,
    );
    // CAMERA is shown twice: the larger picture counts. The image and the hidden screen are not asked for.
    expect(requests).toEqual(
      new Map([
        [CAMERA, { width: 960, height: 544 }],
        [CAMERA_2, { width: 480, height: 272 }],
      ]),
    );
  });

  it('leaves out a source the stage already requests at least that large', () => {
    const scenes = [
      scene('scn_a', [
        sceneItem('a', CAMERA, { w: 640, h: 360 }),
        sceneItem('b', CAMERA_2, { w: 640, h: 360 }),
      ]),
    ];
    const requests = preloadRequests(
      scenes,
      new Map([
        [CAMERA, { width: 640, height: 368 }],
        [CAMERA_2, { width: 320, height: 192 }],
      ]),
      GEOMETRY,
    );
    expect(requests).toEqual(new Map([[CAMERA_2, { width: 640, height: 368 }]]));
  });

  it('follows the scale of the stage, the pixel ratio and the canvas as the ceiling', () => {
    const scenes = [scene('scn_a', [sceneItem('a', CAMERA, { x: 0, y: 0, w: 1920, h: 1080 })])];
    expect(
      preloadRequests(scenes, new Map(), { ...GEOMETRY, scale: 0.5, devicePixelRatio: 1.5 }).get(
        CAMERA,
      ),
    ).toEqual({ width: 1440, height: 816 });
    // A 4K window would ask for 3840 pixels; the 1080p canvas is the ceiling.
    expect(
      preloadRequests(scenes, new Map(), { ...GEOMETRY, scale: 2, devicePixelRatio: 1.5 }).get(
        CAMERA,
      ),
    ).toEqual({ width: 1920, height: 1088 });
  });

  it('accounts for crop and rotation of the preloaded item', () => {
    const requests = preloadRequests(
      [
        scene('scn_a', [
          sceneItem('a', CAMERA, {
            w: 400,
            h: 400,
            crop: { top: 0, right: 0.25, bottom: 0, left: 0.25 },
          }),
          sceneItem('b', SCREEN, { w: 800, h: 448, rotation: 90 }),
        ]),
      ],
      new Map(),
      GEOMETRY,
    );
    expect(requests.get(CAMERA)).toEqual({ width: 800, height: 400 });
    expect(requests.get(SCREEN)).toEqual({ width: 448, height: 800 });
  });

  it('places the items of an Auto-Grid scene like the stage does', () => {
    const requests = preloadRequests(
      [
        scene('scn_a', [sceneItem('a', CAMERA), sceneItem('b', CAMERA_2), sceneItem('c', IMAGE)], {
          layoutMode: 'autoGrid',
        }),
      ],
      new Map(),
      GEOMETRY,
    );
    const [[, , w1, h1]] = autoGridSlots(3, DEFAULT_CANVAS);
    expect(requests.get(CAMERA)?.width).toBeGreaterThanOrEqual(w1);
    expect(requests.get(CAMERA)?.height).toBeGreaterThanOrEqual(h1);
    // Not the free geometry of the item (640 x 360), but its cell.
    expect(requests.get(CAMERA)).not.toEqual({ width: 640, height: 368 });
    expect(requests.has(CAMERA_2)).toBe(true);
  });

  it('skips malformed scenes and items', () => {
    const malformed = [
      null,
      scene('scn_x', null as unknown as []),
      scene('scn_y', [null, { id: 'z' }] as unknown as []),
    ] as unknown as Parameters<typeof preloadRequests>[0];
    expect(preloadRequests(malformed, new Map(), GEOMETRY).size).toBe(0);
  });
});
