import { Component, inject } from '@angular/core';
import type { TestRequest } from '@angular/common/http/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type { SceneDto, SceneItemDto } from '@flowstudio/scene-model';
import { FakeStudioHub, flushMicrotasks } from '../../testing/fake-studio-hub';
import {
  PRODUCTION_ID,
  defaultScenes,
  itemFixture,
  productionFixture,
  sceneFixture,
  snapshotFixture,
} from '../../testing/fixtures';
import {
  MemoryStorage,
  startStore,
  studioTestProviders,
  type StoreHarness,
} from '../../testing/store-harness';
import { PREFERENCE_KEYS } from '../core/ui/preferences.service';
import { ToastService } from '../core/ui/toast.service';
import { EditOverlayComponent } from './edit-overlay.component';
import { EditorService, LIVE_LOCKED_MESSAGE } from './editor.service';
import { FRAME_SCHEDULER } from './frame-scheduler';
import { SCENE_RENDERER_FACTORY, SceneViewComponent } from './scene-view.component';
import { FakeRendererFactory, ManualFrames } from './testing/stage-fakes';

@Component({
  imports: [EditOverlayComponent, SceneViewComponent],
  template: `
    <fs-scene-view #view [scene]="editor.editScene()" />
    <fs-edit-overlay [view]="view" />
  `,
})
class OverlayHostComponent {
  protected readonly editor = inject(EditorService);
}

const BASE = `/api/productions/${PRODUCTION_ID}`;
const SCENE_A = `${BASE}/scenes/scn_a`;
/** The overlay is 960 × 540 on screen: scale 0.5, so one screen px is two canvas px. */
const SCREEN = { left: 0, top: 0, width: 960, height: 540 };

describe('EditOverlayComponent', () => {
  let hub: FakeStudioHub;
  let harness: StoreHarness;
  let frames: ManualFrames;
  let fixture: ComponentFixture<OverlayHostComponent>;
  let overlay: HTMLElement;
  let editor: EditorService;
  let toasts: ToastService;

  async function setup(
    options: { scenes?: SceneDto[]; studio?: boolean; preview?: string | null } = {},
  ): Promise<void> {
    hub = new FakeStudioHub();
    frames = new ManualFrames();
    const storage = new MemoryStorage();
    if (options.studio) {
      storage.setItem(PREFERENCE_KEYS.studioMode, '1');
    }
    const factory = new FakeRendererFactory();
    TestBed.configureTestingModule({
      providers: [
        ...studioTestProviders(hub, storage),
        { provide: SCENE_RENDERER_FACTORY, useValue: factory.create },
        { provide: FRAME_SCHEDULER, useValue: frames.scheduler },
      ],
    });
    harness = await startStore(
      hub,
      snapshotFixture({
        production: productionFixture({ previewSceneId: options.preview ?? null }),
        scenes: options.scenes ?? defaultScenes(),
      }),
    );
    editor = TestBed.inject(EditorService);
    toasts = TestBed.inject(ToastService);
    fixture = TestBed.createComponent(OverlayHostComponent);
    overlay = fixture.nativeElement.querySelector('fs-edit-overlay') as HTMLElement;
    overlay.getBoundingClientRect = () =>
      ({ ...SCREEN, x: 0, y: 0, right: 960, bottom: 540, toJSON: () => SCREEN }) as DOMRect;
    await render();
  }

  async function render(): Promise<void> {
    await flushMicrotasks();
    fixture.detectChanges();
    await fixture.whenStable();
  }

  function box(id: string): HTMLElement {
    const element = overlay.querySelector<HTMLElement>(`[data-item-id="${id}"]`);
    if (!element) {
      throw new Error(`no box ${id}`);
    }
    return element;
  }

  function pointer(
    type: string,
    target: Element,
    x: number,
    y: number,
    init: PointerEventInit = {},
  ): void {
    target.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX: SCREEN.left + x,
        clientY: SCREEN.top + y,
        pointerId: 1,
        pointerType: 'mouse',
        button: 0,
        ...init,
      }),
    );
  }

  /** Drags from screen (x, y) by (dx, dy) in `steps` moves, one animation frame per move. */
  async function drag(
    target: Element,
    from: [number, number],
    by: [number, number],
    init: PointerEventInit = {},
    steps = 3,
  ): Promise<void> {
    pointer('pointerdown', target, from[0], from[1], init);
    await render();
    for (let step = 1; step <= steps; step += 1) {
      const x = from[0] + (by[0] * step) / steps;
      const y = from[1] + (by[1] * step) / steps;
      pointer('pointermove', overlay, x, y, init);
      frames.flush();
    }
    pointer('pointerup', overlay, from[0] + by[0], from[1] + by[1], init);
    await render();
  }

  function item(id = 'itm_a1'): SceneItemDto {
    return editor.itemById(id) as SceneItemDto;
  }

  /** Answers every pending scene write (one at a time, as the editor sends them) and returns them. */
  async function answerAll(): Promise<TestRequest[]> {
    const answered: TestRequest[] = [];
    for (let round = 0; round < 20; round += 1) {
      const pending = harness.http.match(() => true);
      if (pending.length === 0) {
        break;
      }
      for (const request of pending) {
        const base = harness.store.sceneById('scn_a') as SceneDto;
        request.flush({ ...base, version: base.version + answered.length + 1 });
        answered.push(request);
      }
      await flushMicrotasks();
    }
    return answered;
  }

  afterEach(() => harness?.http.verify());

  it('draws a box for every visible element with position, label and alert state', async () => {
    await setup();
    expect(overlay.getAttribute('role')).toBe('group');
    expect(overlay.getAttribute('aria-label')).toContain('Ziehen zum Verschieben');
    const element = box('itm_a1');
    expect(element.style.left).toBe(`${(100 / 1920) * 100}%`);
    expect(element.style.width).toBe(`${(600 / 1920) * 100}%`);
    expect(element.querySelector('.c-edit-box__label')?.textContent).toBe('K1 · 600 × 338');
    expect(element.classList.contains('is-sel')).toBe(false);
    expect(element.querySelectorAll('.c-edit-box__handle')).toHaveLength(0);
  });

  it('selects on click, shows the handles and deselects on the empty area', async () => {
    await setup();
    pointer('pointerdown', box('itm_a1'), 100, 100);
    pointer('pointerup', overlay, 100, 100);
    await render();
    expect(editor.selectedItemId()).toBe('itm_a1');
    expect(box('itm_a1').classList.contains('is-sel')).toBe(true);
    expect(box('itm_a1').querySelectorAll('.c-edit-box__handle')).toHaveLength(4);
    expect(harness.http.match(() => true)).toHaveLength(0);
    pointer('pointerdown', overlay, 900, 500);
    await render();
    expect(editor.selectedItemId()).toBeNull();
  });

  it('moves an element in one undo step and sends coalesced updates', async () => {
    await setup();
    // 50 screen px = 100 canvas px to the right, 25 = 50 down; the frame batching sends at most one step per frame.
    await drag(box('itm_a1'), [100, 100], [50, 25]);
    expect(item()).toMatchObject({ x: 200, y: 150, w: 600, h: 338 });
    const requests = await answerAll();
    expect(requests.length).toBeGreaterThanOrEqual(1);
    expect(requests.length).toBeLessThanOrEqual(3);
    expect(requests.at(-1)?.request.body).toMatchObject({ id: 'itm_a1', x: 200, y: 150 });
    expect(requests.every((request) => request.request.url === `${SCENE_A}/items/itm_a1`)).toBe(
      true,
    );
    expect(editor.canUndo()).toBe(true);
    editor.undo();
    expect(item()).toMatchObject({ x: 100, y: 100 });
    await answerAll();
    expect(editor.canUndo()).toBe(false);
  });

  it('does not start a drag below 2 screen px', async () => {
    await setup();
    await drag(box('itm_a1'), [100, 100], [1, 1], {}, 1);
    expect(item()).toMatchObject({ x: 100, y: 100 });
    expect(harness.http.match(() => true)).toHaveLength(0);
    expect(editor.canUndo()).toBe(false);
  });

  it('snaps to the safe margin and shows a guide, Alt disables snapping', async () => {
    await setup();
    pointer('pointerdown', box('itm_a1'), 100, 100);
    await render();
    // x 100 → 46 (canvas): within 14 canvas px of the safe margin 40.
    pointer('pointermove', overlay, 73, 100);
    frames.flush();
    await render();
    expect(item().x).toBe(40);
    expect(overlay.classList.contains('is-dragging')).toBe(true);
    expect(overlay.querySelector('.c-edit-overlay__guide--v')).not.toBeNull();
    pointer('pointermove', overlay, 73, 100, { altKey: true });
    frames.flush();
    await render();
    expect(item().x).toBe(46);
    expect(overlay.querySelector('.c-edit-overlay__guide--v')).toBeNull();
    pointer('pointerup', overlay, 73, 100);
    await render();
    expect(overlay.classList.contains('is-dragging')).toBe(false);
    await answerAll();
  });

  it('resizes from a corner keeping the ratio, Shift frees it', async () => {
    await setup();
    editor.select('itm_a1');
    await render();
    const corner = box('itm_a1').querySelector('[data-handle="se"]') as HTMLElement;
    // Bottom-right corner at canvas (700, 438) = screen (350, 219).
    await drag(corner, [350, 219], [100, 0]);
    expect(item()).toMatchObject({ x: 100, y: 100, w: 800 });
    expect(item().w / item().h).toBeCloseTo(600 / 338, 2);
    await answerAll();
    const free = box('itm_a1').querySelector('[data-handle="se"]') as HTMLElement;
    await drag(free, [500, 269], [0, 50], { shiftKey: true });
    expect(item().w).toBe(800);
    expect(item().h).toBe(Math.round(800 / (600 / 338)) + 100);
    await answerAll();
  });

  it('crops with Alt on a corner (like OBS) and shows the crop in the label', async () => {
    await setup();
    editor.select('itm_a1');
    await render();
    const corner = box('itm_a1').querySelector('[data-handle="se"]') as HTMLElement;
    await drag(corner, [350, 219], [-30, 0], { altKey: true });
    expect(item()).toMatchObject({ x: 100, y: 100, w: 540, h: 338 });
    expect(item().crop.right).toBeCloseTo(0.1, 6);
    expect(box('itm_a1').querySelector('.c-edit-box__label')?.textContent).toBe(
      'K1 · 540 × 338 · Zuschnitt R 10 %',
    );
    await answerAll();
  });

  it('crops one side with Alt on an edge; without Alt the edge moves the element', async () => {
    await setup();
    editor.select('itm_a1');
    await render();
    const left = box('itm_a1').querySelector('[data-handle="w"]') as HTMLElement;
    await drag(left, [50, 150], [30, 0], { altKey: true });
    expect(item()).toMatchObject({ x: 160, w: 540 });
    expect(item().crop.left).toBeCloseTo(0.1, 6);
    await answerAll();
    const edge = box('itm_a1').querySelector('[data-handle="w"]') as HTMLElement;
    await drag(edge, [80, 150], [10, 0]);
    expect(item()).toMatchObject({ x: 180, w: 540 });
    await answerAll();
  });

  it('selects a locked element but never drags it', async () => {
    const scenes = defaultScenes();
    scenes[0] = sceneFixture('scn_a', 'Begrüssung', 0, [
      itemFixture('itm_a1', 'dev_aaaaaaaaaaaaaaaa/camera', { locked: true }),
    ]);
    await setup({ scenes });
    await drag(box('itm_a1'), [100, 100], [50, 50]);
    expect(editor.selectedItemId()).toBe('itm_a1');
    expect(item()).toMatchObject({ x: 100, y: 100 });
    expect(box('itm_a1').classList.contains('is-locked')).toBe(true);
    expect(box('itm_a1').querySelectorAll('.c-edit-box__handle')).toHaveLength(0);
    expect(harness.http.match(() => true)).toHaveLength(0);
  });

  it('blocks editing of the live scene in Studio-Modus with the prototype toast', async () => {
    await setup({ studio: true, preview: 'scn_a' });
    expect(overlay.classList.contains('is-locked')).toBe(true);
    await drag(box('itm_a1'), [100, 100], [50, 50]);
    expect(toasts.current()?.message).toBe(LIVE_LOCKED_MESSAGE);
    expect(editor.selectedItemId()).toBeNull();
    expect(item()).toMatchObject({ x: 100, y: 100 });
    expect(harness.http.match(() => true)).toHaveLength(0);
  });

  it('nudges with the arrow keys: 1 px, Shift 10 px, one undo step per repeat burst', async () => {
    await setup();
    editor.select('itm_a1');
    await render();
    const key = (type: string, init: KeyboardEventInit): void => {
      overlay.dispatchEvent(new KeyboardEvent(type, { bubbles: true, cancelable: true, ...init }));
    };
    key('keydown', { key: 'ArrowRight' });
    key('keydown', { key: 'ArrowRight', repeat: true });
    key('keydown', { key: 'ArrowDown', shiftKey: true, repeat: true });
    key('keyup', { key: 'ArrowDown' });
    await render();
    expect(item()).toMatchObject({ x: 102, y: 110 });
    await answerAll();
    editor.undo();
    expect(item()).toMatchObject({ x: 100, y: 100 });
    await answerAll();
    expect(editor.canUndo()).toBe(false);
  });

  it('switches an Auto-Grid scene to free layout with the renderer rectangles on the first change', async () => {
    const scenes = defaultScenes();
    scenes[0] = sceneFixture(
      'scn_a',
      'Begrüssung',
      0,
      [
        itemFixture('itm_a1', 'dev_aaaaaaaaaaaaaaaa/camera'),
        itemFixture('itm_a2', 'dev_bbbbbbbbbbbbbbbb/screen-1'),
      ],
      { layoutMode: 'autoGrid' },
    );
    await setup({ scenes });
    // The fake renderer reports the stored geometry; the edit uses the box rectangles.
    await drag(box('itm_a2'), [100, 100], [10, 0]);
    const requests = await answerAll();
    expect(requests[0].request.url).toBe(`${SCENE_A}/items`);
    expect(requests[0].request.body).toMatchObject({ layoutMode: 'free' });
    expect(editor.editScene()?.layoutMode).toBe('free');
  });

  it('ends the gesture on pointercancel', async () => {
    await setup();
    pointer('pointerdown', box('itm_a1'), 100, 100);
    pointer('pointermove', overlay, 140, 100);
    frames.flush();
    pointer('pointercancel', overlay, 140, 100);
    await render();
    expect(item().x).toBe(180);
    expect(overlay.classList.contains('is-dragging')).toBe(false);
    expect(editor.canUndo()).toBe(true);
    await answerAll();
  });
});
