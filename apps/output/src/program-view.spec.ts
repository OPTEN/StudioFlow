import {
  applyEvent,
  canvasDto,
  type ProductionEvent,
  type ProductionState,
} from '@studioflow/scene-model';
import { preloadScenesFor, ProgramView, slateFor } from './program-view';
import { noAccessSlate } from './slates';
import { FakeRenderer } from './testing/fakes';
import {
  CAMERA,
  canvasChanged,
  deviceSource,
  FADE,
  IMAGE,
  item,
  productionChanged,
  programSwitched,
  scene,
  sceneUpserted,
  state,
} from './testing/fixtures';

function setup(): { renderer: FakeRenderer; view: ProgramView } {
  const renderer = new FakeRenderer(document.createElement('div'));
  const view = new ProgramView(renderer, (assetId) => `/media/${assetId}?k=secret`);
  return { renderer, view };
}

function next(current: ProductionState, event: ProductionEvent): ProductionState {
  const { state: applied, result } = applyEvent(current, event);
  expect(result).toBe('applied');
  return applied;
}

describe('slateFor', () => {
  it('maps the broadcast state to the slate', () => {
    expect(slateFor(state({}, { broadcast: 'standby' }))?.title).toBe('Starting soon');
    expect(slateFor(state({}, { broadcast: 'live' }))).toBeNull();
    expect(slateFor(state({}, { broadcast: 'ended' }))?.title).toBe('Thanks for watching');
  });
});

describe('preloadScenesFor', () => {
  it('lists every scene except the program', () => {
    expect(preloadScenesFor(state()).map((s) => s.id)).toEqual(['scn_b', 'scn_c']);
  });

  it('puts the preview scene first', () => {
    const current = state({}, { previewSceneId: 'scn_c' });
    expect(preloadScenesFor(current).map((s) => s.id)).toEqual(['scn_c', 'scn_b']);
  });

  it('ignores a preview that equals the program or does not exist', () => {
    expect(preloadScenesFor(state({}, { previewSceneId: 'scn_a' })).map((s) => s.id)).toEqual([
      'scn_b',
      'scn_c',
    ]);
    expect(preloadScenesFor(state({}, { previewSceneId: 'scn_x' })).map((s) => s.id)).toEqual([
      'scn_b',
      'scn_c',
    ]);
  });
});

describe('ProgramView', () => {
  it('gives the renderer the canvas of the production before it shows the scene', () => {
    const { renderer, view } = setup();
    view.apply(state({}, { canvas: canvasDto('portrait', 'p1080') }));
    expect(renderer.canvases).toEqual([{ width: 1080, height: 1920 }]);
    expect(renderer.summary()[0]).toBe('show scn_a');
  });

  it('tells the renderer about a changed canvas once, together with the rescaled scene', () => {
    const { renderer, view } = setup();
    let current = state();
    view.apply(current);
    renderer.reset();
    const rescaled = scene(
      'scn_a',
      0,
      [item('itm_a1', CAMERA, { x: 0, y: 656, w: 1080, h: 608 })],
      {
        version: 2,
      },
    );

    current = next(
      current,
      canvasChanged(current.revision + 1, canvasDto('portrait', 'p1080'), [rescaled]),
    );
    view.apply(current);
    view.apply(current);

    expect(renderer.canvases).toEqual([
      { width: 1920, height: 1080 },
      { width: 1080, height: 1920 },
    ]);
    expect(renderer.summary()).toEqual(['update scn_a']);
  });

  it('does not touch the canvas for changes that keep it', () => {
    const { renderer, view } = setup();
    let current = state();
    view.apply(current);
    current = next(current, productionChanged(current.revision + 1, { name: 'Renamed' }));
    view.apply(current);
    expect(renderer.canvases).toHaveLength(1);
  });

  it('shows the program scene under the standby slate on the first sync', () => {
    const { renderer, view } = setup();
    view.apply(state());
    expect(renderer.summary()).toEqual([
      'show scn_a',
      'slate Starting soon',
      'preload scn_b,scn_c',
    ]);
    expect(view.rendering).toBe(true);
    expect(view.shownSceneId).toBeNull();
  });

  it('shows the program without slate when the first sync is live (reload during a broadcast)', () => {
    const { renderer, view } = setup();
    view.apply(state({}, { broadcast: 'live' }));
    expect(renderer.summary()).toEqual(['show scn_a', 'slate null', 'preload scn_b,scn_c']);
    expect(view.shownSceneId).toBe('scn_a');
  });

  it('only fades the slate out when the broadcast starts', () => {
    const { renderer, view } = setup();
    const standby = state();
    view.apply(standby);
    renderer.reset();
    view.apply(next(standby, productionChanged(101, { broadcast: 'live' })));
    expect(renderer.summary()).toEqual(['slate null']);
  });

  it('shows the end slate after the end', () => {
    const { renderer, view } = setup();
    const live = state({}, { broadcast: 'live' });
    view.apply(live);
    renderer.reset();
    view.apply(next(live, productionChanged(101, { broadcast: 'ended' })));
    expect(renderer.summary()).toEqual(['slate Thanks for watching']);
    expect(view.shownSceneId).toBeNull();
  });

  it('plays the transition of a live program switch', () => {
    const { renderer, view } = setup();
    const live = state({}, { broadcast: 'live' });
    view.apply(live);
    renderer.reset();
    const switched = next(live, programSwitched(101, 'scn_b', FADE));
    view.apply(switched, FADE);
    expect(renderer.summary()).toEqual(['transition scn_b fade 500', 'preload scn_a,scn_c']);
    expect(view.shownSceneId).toBe('scn_b');
  });

  it('cuts without transition when the program changed while offline (catch-up)', () => {
    const { renderer, view } = setup();
    const live = state({}, { broadcast: 'live' });
    view.apply(live);
    renderer.reset();
    view.apply(next(live, programSwitched(101, 'scn_c', FADE)));
    expect(renderer.summary()).toEqual(['show scn_c', 'preload scn_a,scn_b']);
  });

  it('updates the shown scene in place', () => {
    const { renderer, view } = setup();
    const live = state({}, { broadcast: 'live' });
    view.apply(live);
    renderer.reset();
    const edited = scene('scn_a', 0, [item('itm_a1', IMAGE, { x: 20 })], { version: 2 });
    view.apply(next(live, sceneUpserted(101, edited)));
    expect(renderer.summary()).toEqual(['update scn_a']);
    expect(renderer.calls[0]).toMatchObject({ scene: { version: 2 } });
  });

  it('refreshes only the preload list when another scene changes', () => {
    const { renderer, view } = setup();
    const live = state({}, { broadcast: 'live' });
    view.apply(live);
    renderer.reset();
    view.apply(next(live, sceneUpserted(101, scene('scn_b', 1, [], { version: 2 }))));
    expect(renderer.summary()).toEqual(['preload scn_b,scn_c']);
  });

  it('reorders the preload list when the preview changes and makes no other call', () => {
    const { renderer, view } = setup();
    const live = state({}, { broadcast: 'live' });
    view.apply(live);
    renderer.reset();
    const previewOnly: ProductionEvent = {
      type: 'programSwitched',
      programSceneId: 'scn_a',
      previewSceneId: 'scn_c',
      previousProgramSceneId: 'scn_a',
      transition: { kind: 'cut', durationMs: 0 },
      at: '2026-10-22T10:00:00.000Z',
      revision: 101,
    };
    view.apply(next(live, previewOnly), { kind: 'cut', durationMs: 0 });
    expect(renderer.summary()).toEqual(['preload scn_c,scn_b']);
  });

  it('makes no call for changes that do not affect the picture', () => {
    const { renderer, view } = setup();
    const live = state({}, { broadcast: 'live' });
    view.apply(live);
    renderer.reset();
    view.apply(next(live, { type: 'revisionOnly', revision: 101 }));
    view.apply(live);
    expect(renderer.summary()).toEqual([]);
  });

  it('shows the slate again when its background image arrives later', () => {
    let known = false;
    const renderer = new FakeRenderer(document.createElement('div'));
    const view = new ProgramView(renderer, (id) => (known ? `/media/${id}` : null));
    const slateState = state(
      {},
      {
        standbySlate: { title: 'Soon', subtitle: null, backgroundAssetId: IMAGE },
      },
    );
    view.apply(slateState);
    renderer.reset();
    view.apply(slateState);
    expect(renderer.summary()).toEqual([]);
    known = true;
    view.apply(slateState);
    expect(renderer.summary()).toEqual(['slate Soon']);
  });

  it('shows an empty stage when the production has no program scene', () => {
    const { renderer, view } = setup();
    view.apply(state({ scenes: [] }, { programSceneId: null, broadcast: 'live' }));
    expect(renderer.summary()).toEqual(['show null', 'slate null']);
  });

  it('clears the stage behind “No access” and keeps the latest state', () => {
    const { renderer, view } = setup();
    const live = state({}, { broadcast: 'live' });
    view.apply(live);
    renderer.reset();
    view.setDenied(true);
    expect(renderer.summary()).toEqual(['slate No access', 'show null', 'preload ']);
    expect(renderer.currentSlate()).toEqual(noAccessSlate());
    expect(view.rendering).toBe(false);
    expect(view.shownSceneId).toBeNull();

    renderer.reset();
    const switched = next(live, programSwitched(101, 'scn_b'));
    view.apply(switched, FADE);
    expect(renderer.summary()).toEqual([]);
    expect(view.latest).toBe(switched);

    view.setDenied(false);
    expect(renderer.summary()).toEqual(['show scn_b', 'slate null', 'preload scn_a,scn_c']);
    expect(view.rendering).toBe(true);
  });

  it('hides “No access” when access returns before any state', () => {
    const { renderer, view } = setup();
    view.setDenied(true);
    view.setDenied(false);
    expect(renderer.summary()).toEqual(['slate No access', 'show null', 'preload ', 'slate null']);
    expect(view.rendering).toBe(false);
  });

  it('ignores repeated denials', () => {
    const { renderer, view } = setup();
    view.setDenied(true);
    renderer.reset();
    view.setDenied(true);
    expect(renderer.summary()).toEqual([]);
  });
  it('redraws the texts when a text changes, and only then', () => {
    const { renderer, view } = setup();
    const first = state();
    view.apply(first);
    expect(renderer.refreshes).toBe(0);

    const text = {
      id: 'txt_aaaaaaaa',
      code: 'T1',
      line1: 'Mia Meier',
      line2: null,
      style: 'lowerThird',
      align: 'left',
    } as const;
    const withText = next(first, {
      type: 'sourceUpserted',
      revision: 101,
      source: { ...deviceSource(CAMERA, 'K1', 'x'), id: text.id, kind: 'text', text },
    });
    view.apply(withText);
    expect(renderer.refreshes).toBe(1);

    view.apply(
      next(withText, sceneUpserted(102, scene('scn_b', 1, [item('i1', IMAGE)], { version: 2 }))),
    );
    expect(renderer.refreshes).toBe(1);
  });

  it('redraws the texts when the text colours change, not on other production changes', () => {
    const { renderer, view } = setup();
    const first = state();
    view.apply(first);

    const renamed = next(first, productionChanged(101, { name: 'Renamed' }));
    view.apply(renamed);
    expect(renderer.refreshes).toBe(0);

    const textTheme = { accent: '#ff8800', background: '#000000', foreground: '#ffffff' };
    view.apply(next(renamed, productionChanged(102, { name: 'Renamed', textTheme })));
    expect(renderer.refreshes).toBe(1);
  });
});
