import type { TestRequest } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { SceneDto, SceneItemDto } from '@flowstudio/scene-model';
import { FakeStudioHub, flushMicrotasks } from '../../testing/fake-studio-hub';
import {
  PRODUCTION_ID,
  defaultScenes,
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
import { EditorService, LIVE_LOCKED_MESSAGE, LIVE_UNDO_MESSAGE } from './editor.service';
import { SwitcherService } from './switcher.service';

const BASE = `/api/productions/${PRODUCTION_ID}`;
const SCENE_A = `${BASE}/scenes/scn_a`;
const SCENE_B = `${BASE}/scenes/scn_b`;

describe('EditorService', () => {
  let hub: FakeStudioHub;
  let harness: StoreHarness;
  let editor: EditorService;
  let toasts: ToastService;

  async function setup(
    options: { studio?: boolean; preview?: string | null; scenes?: SceneDto[] } = {},
  ): Promise<void> {
    hub = new FakeStudioHub();
    const storage = new MemoryStorage();
    if (options.studio) {
      storage.setItem(PREFERENCE_KEYS.studioMode, '1');
    }
    TestBed.configureTestingModule({ providers: studioTestProviders(hub, storage) });
    harness = await startStore(
      hub,
      snapshotFixture({
        production: productionFixture({ previewSceneId: options.preview ?? null }),
        scenes: options.scenes ?? defaultScenes(),
      }),
    );
    editor = TestBed.inject(EditorService);
    toasts = TestBed.inject(ToastService);
    await harness.settle();
  }

  /** Answers a scene write with the scene at `version` (what the API returns). */
  function answer(request: TestRequest, version: number): void {
    const base = harness.store.sceneById('scn_a') as SceneDto;
    request.flush({ ...base, version });
  }

  function itemA(): SceneItemDto {
    return editor.itemById('itm_a1') as SceneItemDto;
  }

  afterEach(() => harness?.http.verify());

  it('edits the program scene without Studio-Modus and the preview scene with it', async () => {
    await setup();
    expect(editor.editScene()?.id).toBe('scn_a');
    expect(editor.editLocked()).toBe(false);
    TestBed.resetTestingModule();
    await setup({ studio: true, preview: 'scn_b' });
    expect(editor.editScene()?.id).toBe('scn_b');
  });

  it('locks editing in Studio-Modus when preview = program', async () => {
    await setup({ studio: true, preview: 'scn_a' });
    expect(editor.editLocked()).toBe(true);
    expect(editor.canEdit()).toBe(false);
    expect(editor.updateItem({ ...itemA(), x: 10 })).toBe(false);
    expect(toasts.current()?.message).toBe(LIVE_LOCKED_MESSAGE);
    expect(editor.addSource('dev_bbbbbbbbbbbbbbbb/screen-1')).toBeNull();
    harness.http.expectNone(() => true);
  });

  it('shows edits immediately and coalesces them: one request in flight, the newest state wins', async () => {
    await setup();
    editor.updateItem({ ...itemA(), x: 110 });
    expect(itemA().x).toBe(110);
    const first = harness.http.expectOne(`${SCENE_A}/items/itm_a1`);
    expect(first.request.method).toBe('PUT');
    expect(first.request.body.x).toBe(110);
    editor.updateItem({ ...itemA(), x: 120 });
    editor.updateItem({ ...itemA(), x: 130 });
    expect(itemA().x).toBe(130);
    harness.http.expectNone(`${SCENE_A}/items/itm_a1`);
    answer(first, 2);
    await flushMicrotasks();
    const second = harness.http.expectOne(`${SCENE_A}/items/itm_a1`);
    expect(second.request.body.x).toBe(130);
    answer(second, 3);
    await flushMicrotasks();
    expect(editor.saving()).toBe(true);
    // The echo with the acknowledged version replaces the draft.
    const echoed = sceneFixture('scn_a', 'Begrüssung', 0, [{ ...itemA(), x: 130 }], { version: 3 });
    harness.emitEvent({ type: 'sceneUpserted', scene: echoed });
    await harness.settle();
    expect(editor.saving()).toBe(false);
    expect(itemA().x).toBe(130);
  });

  it('clamps items to the server bounds', async () => {
    await setup();
    editor.updateItem({ ...itemA(), x: 99999, w: 3, radius: 500 });
    const request = harness.http.expectOne(`${SCENE_A}/items/itm_a1`);
    expect(request.request.body).toMatchObject({ x: 3840, w: 16, radius: 200 });
    answer(request, 2);
  });

  it('drops the draft and shows the error when a write fails', async () => {
    await setup();
    editor.updateItem({ ...itemA(), x: 500 });
    editor.updateItem({ ...itemA(), y: 600 });
    harness.http
      .expectOne(`${SCENE_A}/items/itm_a1`)
      .flush(
        { code: 'validation_failed', errors: { x: ['X ist zu gross.'] } },
        { status: 400, statusText: 'Bad' },
      );
    await flushMicrotasks();
    expect(itemA().x).toBe(100);
    expect(toasts.current()?.message).toBe('X ist zu gross.');
    harness.http.expectNone(`${SCENE_A}/items/itm_a1`);
  });

  it('undoes and redoes through ReplaceSceneItems', async () => {
    await setup();
    editor.updateItem({ ...itemA(), x: 300 });
    answer(harness.http.expectOne(`${SCENE_A}/items/itm_a1`), 2);
    await flushMicrotasks();
    expect(editor.canUndo()).toBe(true);
    editor.undo();
    expect(itemA().x).toBe(100);
    expect(toasts.current()?.message).toBe('Rückgängig gemacht');
    const undo = harness.http.expectOne(`${SCENE_A}/items`);
    expect(undo.request.method).toBe('PUT');
    expect(undo.request.body.items[0].x).toBe(100);
    answer(undo, 3);
    await flushMicrotasks();
    expect(editor.canRedo()).toBe(true);
    editor.redo();
    expect(itemA().x).toBe(300);
    answer(harness.http.expectOne(`${SCENE_A}/items`), 4);
    await flushMicrotasks();
    editor.redo();
    expect(toasts.current()?.message).toBe('Nichts zum Wiederholen');
  });

  it('records one undo step per gesture', async () => {
    await setup();
    editor.beginGesture();
    editor.updateItem({ ...itemA(), x: 101 });
    editor.updateItem({ ...itemA(), x: 102 });
    editor.updateItem({ ...itemA(), x: 103 });
    editor.endGesture();
    answer(harness.http.expectOne(`${SCENE_A}/items/itm_a1`), 2);
    await flushMicrotasks();
    answer(harness.http.expectOne(`${SCENE_A}/items/itm_a1`), 3);
    await flushMicrotasks();
    editor.undo();
    expect(itemA().x).toBe(100);
    answer(harness.http.expectOne(`${SCENE_A}/items`), 4);
    await flushMicrotasks();
    editor.undo();
    expect(toasts.current()?.message).toBe('Nichts zum Rückgängigmachen');
  });

  it('refuses to undo the live scene in Studio-Modus', async () => {
    await setup();
    editor.updateItem({ ...itemA(), x: 300 });
    answer(harness.http.expectOne(`${SCENE_A}/items/itm_a1`), 2);
    await flushMicrotasks();
    const switcher = TestBed.inject(SwitcherService);
    const done = switcher.setStudioMode(true);
    harness.http.expectOne(`${BASE}/preview`).flush(productionFixture({ previewSceneId: 'scn_b' }));
    await done;
    harness.emitEvent({
      type: 'programSwitched',
      programSceneId: 'scn_a',
      previewSceneId: 'scn_b',
      previousProgramSceneId: 'scn_a',
      transition: { kind: 'cut', durationMs: 0 },
      at: new Date().toISOString(),
    });
    await harness.settle();
    expect(editor.editSceneId()).toBe('scn_b');
    editor.undo('scn_a');
    expect(toasts.current()?.message).toBe(LIVE_UNDO_MESSAGE);
    harness.http.expectNone(`${SCENE_A}/items`);
  });

  it('adds a source with the prototype defaults and selects it', async () => {
    await setup();
    const id = editor.addSource('dev_bbbbbbbbbbbbbbbb/screen-1');
    expect(id).toMatch(/^itm_[a-z2-7]{16}$/);
    expect(editor.selectedItemId()).toBe(id);
    expect(editor.selectedItem()).toMatchObject({
      x: 1240,
      y: 680,
      w: 600,
      h: 338,
      fit: 'contain',
      radius: 12,
    });
    expect(toasts.current()?.message).toBe('S1 in «Begrüssung» eingefügt');
    const request = harness.http.expectOne(`${SCENE_A}/items`);
    expect(request.request.body.items).toHaveLength(2);
    expect(request.request.body.layoutMode).toBeNull();
    answer(request, 2);
  });

  it('removes an item with «Rückgängig» in the toast', async () => {
    await setup();
    editor.select('itm_a1');
    editor.removeItem('itm_a1');
    expect(editor.editScene()?.items).toHaveLength(0);
    expect(editor.selectedItemId()).toBeNull();
    expect(toasts.current()).toMatchObject({
      message: 'K1 aus «Begrüssung» entfernt',
      action: { label: 'Rückgängig' },
    });
    const request = harness.http.expectOne(`${SCENE_A}/items/itm_a1`);
    expect(request.request.method).toBe('DELETE');
    answer(request, 2);
    await flushMicrotasks();
    toasts.runAction();
    expect(editor.editScene()?.items).toHaveLength(1);
    answer(harness.http.expectOne(`${SCENE_A}/items`), 3);
  });

  it('toggles hidden (deselecting) and locked', async () => {
    await setup();
    editor.select('itm_a1');
    editor.toggleHidden('itm_a1');
    expect(itemA().hidden).toBe(true);
    expect(editor.selectedItemId()).toBeNull();
    answer(harness.http.expectOne(`${SCENE_A}/items/itm_a1`), 2);
    await flushMicrotasks();
    editor.toggleLocked('itm_a1');
    expect(itemA().locked).toBe(true);
    answer(harness.http.expectOne(`${SCENE_A}/items/itm_a1`), 3);
  });

  it('moves layers and applies templates with undo in the toast', async () => {
    await setup({ studio: true, preview: 'scn_b' });
    expect(editor.moveLayer('itm_b1', 'up')).toBe(true);
    expect(editor.editScene()?.items.map((item) => item.id)).toEqual(['itm_b2', 'itm_b1']);
    expect(editor.moveLayer('itm_b1', 'up')).toBe(false);
    const reorder = harness.http.expectOne(`${SCENE_B}/items`);
    reorder.flush({ ...harness.store.sceneById('scn_b'), version: 2 });
    await flushMicrotasks();
    editor.applyTemplate('pip');
    expect(toasts.current()).toMatchObject({
      message: 'Vorlage «Bild-in-Bild» angewendet',
      action: { label: 'Rückgängig' },
    });
    const template = harness.http.expectOne(`${SCENE_B}/items`);
    const [screen, camera] = [...template.request.body.items].sort(
      (a: SceneItemDto, b: SceneItemDto) => a.id.localeCompare(b.id),
    );
    expect(screen).toMatchObject({ x: 0, y: 0, w: 1920, h: 1080, fit: 'contain', radius: 0 });
    expect(camera).toMatchObject({ x: 1400, y: 772, w: 480, h: 270, radius: 12 });
    expect(template.request.body.layoutMode).toBe('free');
    template.flush({ ...harness.store.sceneById('scn_b'), version: 3 });
  });

  it('sends Bild-in-Bild re-ordered to the slots (small picture in front) and undoes the order', async () => {
    // Camera added before the screen: the camera is at the back, the screen in front.
    const scenes = defaultScenes();
    scenes[1] = { ...scenes[1], items: [...scenes[1].items].reverse() };
    await setup({ studio: true, preview: 'scn_b', scenes });
    expect(editor.editScene()?.items.map((item) => item.id)).toEqual(['itm_b2', 'itm_b1']);

    expect(editor.applyTemplate('pip')).toBe(true);
    const template = harness.http.expectOne(`${SCENE_B}/items`);
    const sent = template.request.body.items as SceneItemDto[];
    expect(sent.map((item) => item.id)).toEqual(['itm_b1', 'itm_b2']);
    expect(sent[0]).toMatchObject({ x: 0, y: 0, w: 1920, h: 1080, fit: 'contain', radius: 0 });
    expect(sent[1]).toMatchObject({ x: 1400, y: 772, w: 480, h: 270, radius: 12 });
    // The optimistic draft shows the new order right away.
    expect(editor.editScene()?.items.map((item) => item.id)).toEqual(['itm_b1', 'itm_b2']);
    template.flush({ ...harness.store.sceneById('scn_b'), version: 2 });
    await flushMicrotasks();

    editor.undo();
    const undo = harness.http.expectOne(`${SCENE_B}/items`);
    const restored = undo.request.body.items as SceneItemDto[];
    expect(restored.map((item) => item.id)).toEqual(['itm_b2', 'itm_b1']);
    expect(restored[1]).toMatchObject({ x: 40, y: 40, w: 1360, h: 765 });
    undo.flush({ ...harness.store.sceneById('scn_b'), version: 3 });
  });

  it('asks for a source before applying a template to an empty scene', async () => {
    await setup({ studio: true, preview: 'scn_c' });
    expect(editor.applyTemplate('two')).toBe(false);
    expect(toasts.current()?.message).toBe('Erst eine Quelle hinzufügen');
  });

  it('switches an Auto-Grid scene to free layout with the effective rectangles', async () => {
    const scenes = defaultScenes();
    scenes[1] = { ...scenes[1], layoutMode: 'autoGrid' };
    await setup({ studio: true, preview: 'scn_b', scenes });
    const off = editor.useEffectiveRects(
      () =>
        new Map([
          ['itm_b1', { x: 40, y: 287, w: 900, h: 506 }],
          ['itm_b2', { x: 980, y: 287, w: 900, h: 506 }],
        ]),
    );
    const item = editor.itemById('itm_b2') as SceneItemDto;
    editor.updateItem({ ...item, x: 1000, y: 300, w: 880, h: 495 });
    const request = harness.http.expectOne(`${SCENE_B}/items`);
    expect(request.request.body.layoutMode).toBe('free');
    expect(request.request.body.items[0]).toMatchObject({
      id: 'itm_b1',
      x: 40,
      y: 287,
      w: 900,
      h: 506,
    });
    expect(request.request.body.items[1]).toMatchObject({
      id: 'itm_b2',
      x: 1000,
      y: 300,
      w: 880,
      h: 495,
    });
    expect(editor.editScene()?.layoutMode).toBe('free');
    request.flush({ ...harness.store.sceneById('scn_b'), version: 2 });
    off();
  });

  it('clears the selection when the edit scene changes', async () => {
    await setup();
    editor.select('itm_a1');
    expect(editor.selectedItem()?.id).toBe('itm_a1');
    harness.emitEvent({
      type: 'programSwitched',
      programSceneId: 'scn_b',
      previewSceneId: null,
      previousProgramSceneId: 'scn_a',
      transition: { kind: 'cut', durationMs: 0 },
      at: new Date().toISOString(),
    });
    await harness.settle();
    expect(editor.selectedItemId()).toBeNull();
  });

  it('answers Escape only while something is selected', async () => {
    await setup();
    const off = editor.registerShortcuts();
    editor.select('itm_a1');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(editor.selectedItemId()).toBeNull();
    off();
  });
});
