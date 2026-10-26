import { Component, inject } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { canvasDto, type CanvasDto, type SceneItemDto } from '@studioflow/scene-model';
import { FakeStudioHub, flushMicrotasks } from '../../testing/fake-studio-hub';
import {
  itemFixture,
  productionFixture,
  sceneFixture,
  snapshotFixture,
} from '../../testing/fixtures';
import { startStore, studioTestProviders, type StoreHarness } from '../../testing/store-harness';
import { EditOverlayComponent } from './edit-overlay.component';
import { EditorService } from './editor.service';
import { FRAME_SCHEDULER } from './frame-scheduler';
import { SCENE_RENDERER_FACTORY, SceneViewComponent } from './scene-view.component';
import { FakeRendererFactory, ManualFrames } from './testing/stage-fakes';

@Component({
  imports: [EditOverlayComponent, SceneViewComponent],
  template: `
    <sf-scene-view #view [scene]="editor.editScene()" />
    <sf-edit-overlay [view]="view" />
  `,
})
class OverlayHostComponent {
  protected readonly editor = inject(EditorService);
}

/** The portrait overlay is 270 × 480 on screen: scale 0.25, so one screen px is four canvas px of a 1080 × 1920 canvas. */
const SCREEN = { left: 0, top: 0, width: 270, height: 480 };

describe('EditOverlayComponent: canvas of the production', () => {
  let harness: StoreHarness;
  let frames: ManualFrames;
  let fixture: ComponentFixture<OverlayHostComponent>;
  let overlay: HTMLElement;
  let editor: EditorService;

  async function setup(canvas: CanvasDto, item: Partial<SceneItemDto> = {}): Promise<void> {
    const hub = new FakeStudioHub();
    frames = new ManualFrames();
    TestBed.configureTestingModule({
      providers: [
        ...studioTestProviders(hub),
        { provide: SCENE_RENDERER_FACTORY, useValue: new FakeRendererFactory().create },
        { provide: FRAME_SCHEDULER, useValue: frames.scheduler },
      ],
    });
    harness = await startStore(
      hub,
      snapshotFixture({
        production: productionFixture({ canvas }),
        scenes: [
          sceneFixture('scn_a', 'Welcome', 0, [
            itemFixture('itm_a1', 'dev_aaaaaaaaaaaaaaaa/camera', {
              x: 100,
              y: 200,
              w: 540,
              h: 304,
              ...item,
            }),
          ]),
        ],
      }),
    );
    editor = TestBed.inject(EditorService);
    fixture = TestBed.createComponent(OverlayHostComponent);
    overlay = fixture.nativeElement.querySelector('sf-edit-overlay') as HTMLElement;
    overlay.getBoundingClientRect = () =>
      ({ ...SCREEN, x: 0, y: 0, right: 270, bottom: 480, toJSON: () => SCREEN }) as DOMRect;
    await render();
  }

  async function render(): Promise<void> {
    await flushMicrotasks();
    fixture.detectChanges();
    await fixture.whenStable();
  }

  function box(): HTMLElement {
    return overlay.querySelector<HTMLElement>('[data-item-id="itm_a1"]') as HTMLElement;
  }

  function pointer(type: string, target: Element, x: number, y: number): void {
    target.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        pointerId: 1,
        pointerType: 'mouse',
        button: 0,
      }),
    );
  }

  /** Answers the scene writes of the editor, one at a time as it sends them, until none is left. */
  async function answerWrites(): Promise<void> {
    for (let version = 2; version < 12; version += 1) {
      const pending = harness.http.match(() => true);
      if (pending.length === 0) {
        return;
      }
      for (const request of pending) {
        request.flush({ ...harness.store.sceneById('scn_a'), version });
      }
      await flushMicrotasks();
    }
  }

  afterEach(() => harness?.http.verify());

  it('draws the box in percent of the portrait canvas', async () => {
    await setup(canvasDto('portrait', 'p1080'));

    expect(box().style.left).toBe(`${(100 / 1080) * 100}%`);
    expect(box().style.top).toBe(`${(200 / 1920) * 100}%`);
    expect(box().style.width).toBe(`${(540 / 1080) * 100}%`);
    expect(box().style.height).toBe(`${(304 / 1920) * 100}%`);
  });

  it('shows the safe-area guide with the margin of the canvas in both directions', async () => {
    await setup(canvasDto('portrait', 'p1080'));

    expect(overlay.style.getPropertyValue('--sf-safe-x')).toBe(`${(40 / 1080) * 100}%`);
    expect(overlay.style.getPropertyValue('--sf-safe-y')).toBe(`${(40 / 1920) * 100}%`);
  });

  it('scales the safe margin with a 720p canvas', async () => {
    await setup(canvasDto('square', 'p720'));

    expect(overlay.style.getPropertyValue('--sf-safe-x')).toBe(`${(27 / 720) * 100}%`);
    expect(overlay.style.getPropertyValue('--sf-safe-y')).toBe(`${(27 / 720) * 100}%`);
  });

  it('moves an element in the pixels of the canvas, not of a 1920 × 1080 one', async () => {
    await setup(canvasDto('portrait', 'p1080'));

    // Press inside the box (screen 40, 70 = canvas 160, 280), then move 20 screen px to the right = 80 canvas px.
    pointer('pointerdown', box(), 40, 70);
    await render();
    pointer('pointermove', overlay, 50, 70);
    frames.flush();
    pointer('pointermove', overlay, 60, 70);
    frames.flush();
    pointer('pointerup', overlay, 60, 70);
    await render();

    expect(editor.itemById('itm_a1')).toMatchObject({ x: 180, y: 200, w: 540, h: 304 });
    await answerWrites();
  });

  it('snaps to the edges and the centre of the portrait canvas', async () => {
    await setup(canvasDto('portrait', 'p1080'), { x: 520, y: 900, w: 40, h: 40 });

    // The box is 40 × 40 at 520, 900; moving it 2 screen px (8 canvas px) right centres it on x = 540.
    pointer('pointerdown', box(), 131, 226);
    await render();
    pointer('pointermove', overlay, 133, 226);
    frames.flush();
    pointer('pointermove', overlay, 133, 226);
    frames.flush();
    pointer('pointerup', overlay, 133, 226);
    await render();

    expect(editor.itemById('itm_a1')?.x).toBe(520);
    await answerWrites();
  });
});
