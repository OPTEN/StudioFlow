import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { canvasDto, type SceneDto } from '@studioflow/scene-model';
import { FakeStudioHub, flushMicrotasks } from '../../testing/fake-studio-hub';
import {
  defaultScenes,
  itemFixture,
  productionFixture,
  sceneFixture,
  snapshotFixture,
} from '../../testing/fixtures';
import { startStore, studioTestProviders, type StoreHarness } from '../../testing/store-harness';
import { StudioMediaService } from '../core/media/studio-media.service';
import { FRAME_SCHEDULER } from './frame-scheduler';
import { SCENE_RENDERER_FACTORY, SceneViewComponent } from './scene-view.component';
import { FakeRendererFactory, ManualFrames } from './testing/stage-fakes';

@Component({
  imports: [SceneViewComponent],
  template: `<sf-scene-view [scene]="scene()" [mode]="'monitor'" />`,
})
class HostComponent {
  readonly scene = signal<SceneDto | null>(null);
}

const [sceneA] = defaultScenes();

describe('SceneViewComponent: canvas of the production', () => {
  let harness: StoreHarness;
  let factory: FakeRendererFactory;
  let fixture: ComponentFixture<HostComponent>;

  async function setup(canvas = canvasDto('widescreen', 'p1080')): Promise<void> {
    const hub = new FakeStudioHub();
    factory = new FakeRendererFactory();
    TestBed.configureTestingModule({
      providers: [
        ...studioTestProviders(hub),
        { provide: SCENE_RENDERER_FACTORY, useValue: factory.create },
        { provide: FRAME_SCHEDULER, useValue: new ManualFrames().scheduler },
        { provide: StudioMediaService, useValue: { provider: signal(null) } },
      ],
    });
    harness = await startStore(hub, snapshotFixture({ production: productionFixture({ canvas }) }));
    fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.scene.set(sceneA);
    await render();
  }

  async function render(): Promise<void> {
    await flushMicrotasks();
    fixture.detectChanges();
    await fixture.whenStable();
  }

  afterEach(() => harness?.http.verify());

  it('creates the renderer with the canvas of the production', async () => {
    await setup(canvasDto('portrait', 'p1080'));

    expect(factory.last.options.canvas).toEqual({ width: 1080, height: 1920 });
  });

  it('creates the renderer with 1920 × 1080 for the default production and sets nothing afterwards', async () => {
    await setup();

    expect(factory.last.options.canvas).toEqual({ width: 1920, height: 1080 });
    expect(factory.last.canvases).toEqual([]);
  });

  it('changes the canvas of the same renderer live, before it shows the rescaled scene of the same change', async () => {
    await setup();
    const renderer = factory.last;
    const rescaled = sceneFixture('scn_a', 'Welcome', 0, [
      itemFixture('itm_a1', 'dev_aaaaaaaaaaaaaaaa/camera', { x: 0, y: 656, w: 1080, h: 608 }),
    ]);

    harness.emitEvent({
      type: 'productionCanvasChanged',
      production: productionFixture({ canvas: canvasDto('portrait', 'p1080') }),
      scenes: [{ ...rescaled, version: 2 }],
    });
    fixture.componentInstance.scene.set({ ...rescaled, version: 2 });
    await render();

    expect(factory.renderers).toHaveLength(1);
    expect(renderer.calls.map((call) => call.op).filter((op) => op !== 'refresh')).toEqual([
      'show',
      'setCanvas',
      'update',
    ]);
    expect(renderer.canvases).toEqual([{ width: 1080, height: 1920 }]);
  });

  it('does not touch the renderer for changes that keep the size', async () => {
    await setup();

    harness.emitEvent({
      type: 'productionChanged',
      production: productionFixture({ name: 'Renamed' }),
    });
    await harness.settle();

    expect(factory.last.canvases).toEqual([]);
  });
});
