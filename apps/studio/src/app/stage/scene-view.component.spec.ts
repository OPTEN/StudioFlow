import { Component, signal, type WritableSignal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type { SceneDto, TransitionDto } from '@studioflow/scene-model';
import type { SourceMediaProvider } from '@studioflow/scene-renderer';
import { FakeStudioHub, flushMicrotasks } from '../../testing/fake-studio-hub';
import { defaultScenes, itemFixture, sceneFixture, sourceFixture } from '../../testing/fixtures';
import { startStore, studioTestProviders, type StoreHarness } from '../../testing/store-harness';
import { StudioMediaService } from '../core/media/studio-media.service';
import { FRAME_SCHEDULER } from './frame-scheduler';
import { PlaceholderMediaProvider } from './placeholder-media-provider';
import {
  SCENE_RENDERER_FACTORY,
  SceneViewComponent,
  type SceneTransitionCue,
  type SceneViewMode,
} from './scene-view.component';
import { FakeRendererFactory, ManualFrames } from './testing/stage-fakes';

@Component({
  imports: [SceneViewComponent],
  template: `
    @if (shown()) {
      <sf-scene-view
        [scene]="scene()"
        [cue]="cue()"
        [mode]="mode()"
        [label]="label()"
        (transitionEnd)="ended.push($event)"
      />
    }
  `,
})
class HostComponent {
  readonly shown = signal(true);
  readonly scene = signal<SceneDto | null>(null);
  readonly cue = signal<SceneTransitionCue | null>(null);
  readonly mode = signal<SceneViewMode>('monitor');
  readonly label = signal('Program-Monitor: Begrüssung');
  readonly ended: TransitionDto[] = [];
}

const FADE: TransitionDto = { kind: 'fade', durationMs: 300 };

describe('SceneViewComponent', () => {
  let hub: FakeStudioHub;
  let harness: StoreHarness;
  let factory: FakeRendererFactory;
  let frames: ManualFrames;
  let provider: WritableSignal<SourceMediaProvider | null>;
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  const [sceneA, sceneB, sceneC] = defaultScenes();

  async function setup(initial: SceneDto | null = sceneA): Promise<void> {
    hub = new FakeStudioHub();
    factory = new FakeRendererFactory();
    frames = new ManualFrames();
    provider = signal<SourceMediaProvider | null>(null);
    TestBed.configureTestingModule({
      providers: [
        ...studioTestProviders(hub),
        { provide: SCENE_RENDERER_FACTORY, useValue: factory.create },
        { provide: FRAME_SCHEDULER, useValue: frames.scheduler },
        { provide: StudioMediaService, useValue: { provider } },
      ],
    });
    harness = await startStore(hub);
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    host.scene.set(initial);
    await render();
  }

  async function render(): Promise<void> {
    await flushMicrotasks();
    fixture.detectChanges();
    await fixture.whenStable();
  }

  function view(): SceneViewComponent {
    return fixture.debugElement.children[0].componentInstance as SceneViewComponent;
  }

  afterEach(() => harness?.http.verify());

  it('creates a monitor renderer in the host with the placeholder provider and shows the scene', async () => {
    await setup();
    expect(factory.renderers).toHaveLength(1);
    const renderer = factory.last;
    expect(renderer.options.mode).toBe('monitor');
    expect(renderer.options.provider).toBe(TestBed.inject(PlaceholderMediaProvider));
    expect(renderer.container.tagName.toLowerCase()).toBe('sf-scene-view');
    expect(renderer.ops()).toEqual(['show:scn_a']);
    expect(renderer.element.getAttribute('aria-label')).toBe('Program-Monitor: Begrüssung');
    expect(renderer.options.statusOf?.('dev_aaaaaaaaaaaaaaaa/camera')).toBe('ok');
    expect(renderer.options.statusOf?.('dev_zzzzzzzzzzzzzzzz/camera')).toBeUndefined();
    expect(renderer.options.codeOf?.('dev_bbbbbbbbbbbbbbbb/screen-1')).toBe('S1');
  });

  it('diffs the same scene in place and shows another scene immediately', async () => {
    await setup();
    host.scene.set({ ...sceneA, version: 2, items: [{ ...sceneA.items[0], x: 300 }] });
    await render();
    host.scene.set(sceneB);
    await render();
    host.scene.set(null);
    await render();
    expect(factory.last.ops()).toEqual(['show:scn_a', 'update:scn_a', 'show:scn_b', 'show:null']);
  });

  it('ignores an unchanged scene object', async () => {
    await setup();
    host.label.set('Preview-Monitor: Begrüssung');
    await render();
    expect(factory.last.ops()).toEqual(['show:scn_a']);
    expect(factory.last.element.getAttribute('aria-label')).toBe('Preview-Monitor: Begrüssung');
  });

  it('plays the cued transition on a program switch and reports its end', async () => {
    await setup();
    host.cue.set({ seq: 1, sceneId: 'scn_b', transition: FADE });
    host.scene.set(sceneB);
    await render();
    const renderer = factory.last;
    expect(renderer.calls.at(-1)).toEqual({
      op: 'transitionTo',
      sceneId: 'scn_b',
      transition: FADE,
    });
    expect(host.ended).toEqual([]);
    renderer.finishTransitions();
    await render();
    expect(host.ended).toEqual([FADE]);
  });

  it('plays a cue only once and only for its own scene', async () => {
    await setup();
    host.cue.set({ seq: 1, sceneId: 'scn_b', transition: FADE });
    host.scene.set(sceneC);
    await render();
    // The cue names another scene: cut.
    expect(factory.last.ops().at(-1)).toBe('show:scn_c');
    host.scene.set(sceneB);
    await render();
    // Same cue seq, now the matching scene: played.
    expect(factory.last.ops().at(-1)).toBe('transitionTo:scn_b');
    host.scene.set(sceneA);
    await render();
    host.scene.set(sceneB);
    await render();
    expect(factory.last.ops().slice(-2)).toEqual(['show:scn_a', 'show:scn_b']);
  });

  it('does not replay a cue that existed before the view was created', async () => {
    await setup();
    host.shown.set(false);
    host.cue.set({ seq: 4, sceneId: 'scn_b', transition: FADE });
    await render();
    host.scene.set(sceneB);
    host.shown.set(true);
    await render();
    expect(factory.last.ops()).toEqual(['show:scn_b']);
  });

  it('destroys the renderer on destroy and never reports a transition afterwards', async () => {
    await setup();
    host.cue.set({ seq: 1, sceneId: 'scn_b', transition: FADE });
    host.scene.set(sceneB);
    await render();
    const renderer = factory.last;
    host.shown.set(false);
    await render();
    expect(renderer.destroyed).toBe(true);
    renderer.finishTransitions();
    await render();
    expect(host.ended).toEqual([]);
  });

  it('recreates the renderer with the real provider and shows the current scene', async () => {
    await setup(sceneB);
    const first = factory.last;
    const real: SourceMediaProvider = {
      attach: () => undefined,
      detach: () => undefined,
      availability: () => ({ state: 'live' }),
      onChange: () => () => undefined,
      setDesiredSize: () => undefined,
      assetUrl: () => null,
    };
    provider.set(real);
    await render();
    expect(first.destroyed).toBe(true);
    expect(factory.renderers).toHaveLength(2);
    expect(factory.last.options.provider).toBe(real);
    expect(factory.last.ops()).toEqual(['show:scn_b']);
  });

  it('re-reads the source statuses when the sources change', async () => {
    await setup();
    const before = factory.last.calls.filter((call) => call.op === 'setSourceStatuses').length;
    harness.emitEvent({
      type: 'sourceUpserted',
      source: sourceFixture('dev_aaaaaaaaaaaaaaaa', 'camera', 'K1', {
        status: 'reconnecting',
        statusSince: new Date().toISOString(),
      }),
    });
    await harness.settle();
    await render();
    const after = factory.last.calls.filter((call) => call.op === 'setSourceStatuses').length;
    expect(after).toBeGreaterThan(before);
    expect(factory.last.options.statusOf?.('dev_aaaaaaaaaaaaaaaa/camera')).toBe('reconnecting');
  });

  it('exposes the renderer rectangles (Auto-Grid) in monitor mode only', async () => {
    const auto = sceneFixture(
      'scn_auto',
      'Auto',
      3,
      [itemFixture('itm_x', 'dev_aaaaaaaaaaaaaaaa/camera'), itemFixture('itm_y', 'ast_none')],
      { layoutMode: 'autoGrid' },
    );
    await setup(auto);
    expect([...view().rects().keys()]).toEqual(['itm_x', 'itm_y']);
    factory.last.rects = new Map([['itm_x', { x: 0, y: 0, w: 1920, h: 1080 }]]);
    expect(view().effectiveRects().get('itm_x')?.w).toBe(1920);
    host.mode.set('thumbnail');
    await render();
    expect(factory.last.options.mode).toBe('thumbnail');
    expect(view().rects().size).toBe(0);
  });

  it('refreshes the rectangles on provider changes, batched to one frame', async () => {
    await setup();
    const listeners: ((sourceId: string) => void)[] = [];
    provider.set({
      attach: () => undefined,
      detach: () => undefined,
      availability: () => ({ state: 'live' }),
      onChange: (listener) => {
        listeners.push(listener);
        return () => undefined;
      },
      setDesiredSize: () => undefined,
      assetUrl: () => null,
    });
    await render();
    factory.last.rects = new Map([['itm_a1', { x: 1, y: 2, w: 3, h: 4 }]]);
    listeners.forEach((listener) => listener('dev_aaaaaaaaaaaaaaaa/camera'));
    listeners.forEach((listener) => listener('dev_aaaaaaaaaaaaaaaa/camera'));
    expect(frames.pending).toBe(1);
    frames.flush();
    expect(view().rects().get('itm_a1')).toEqual({ x: 1, y: 2, w: 3, h: 4 });
  });
});
