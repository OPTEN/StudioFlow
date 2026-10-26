import { TestBed } from '@angular/core/testing';
import type { SceneDto, SceneItemDto } from '@studioflow/scene-model';
import { FakeStudioHub, flushMicrotasks } from '../../testing/fake-studio-hub';
import {
  PRODUCTION_ID,
  itemFixture,
  productionFixture,
  sceneFixture,
  snapshotFixture,
  sourceFixture,
  textSourceFixture,
} from '../../testing/fixtures';
import {
  MemoryStorage,
  startStore,
  studioTestProviders,
  type StoreHarness,
} from '../../testing/store-harness';
import { PREFERENCE_KEYS } from '../core/ui/preferences.service';
import { ToastService } from '../core/ui/toast.service';
import { EditorService } from './editor.service';

const BASE = `/api/productions/${PRODUCTION_ID}`;
const SCENE_A = `${BASE}/scenes/scn_a`;
const TEXT_ID = 'txt_aaaaaaaaaaaaaaaa';

describe('EditorService with texts', () => {
  let harness: StoreHarness;
  let editor: EditorService;
  let toasts: ToastService;

  async function setup(options: { studio?: boolean } = {}): Promise<void> {
    const hub = new FakeStudioHub();
    const storage = new MemoryStorage();
    if (options.studio) {
      storage.setItem(PREFERENCE_KEYS.studioMode, '1');
    }
    TestBed.configureTestingModule({ providers: studioTestProviders(hub, storage) });
    const scenes: SceneDto[] = [
      sceneFixture('scn_a', 'Welcome', 0, [
        itemFixture('itm_cam', 'dev_aaaaaaaaaaaaaaaa/camera'),
        itemFixture('itm_txt', TEXT_ID, { hidden: true, x: 80, y: 820, w: 960, h: 180, radius: 0 }),
      ]),
    ];
    harness = await startStore(
      hub,
      snapshotFixture({
        production: productionFixture({
          previewSceneId: options.studio ? 'scn_a' : null,
        }),
        scenes,
        sources: [
          sourceFixture('dev_aaaaaaaaaaaaaaaa', 'camera', 'K1'),
          textSourceFixture(TEXT_ID, 'T1'),
        ],
      }),
    );
    editor = TestBed.inject(EditorService);
    toasts = TestBed.inject(ToastService);
    await harness.settle();
  }

  function item(id: string): SceneItemDto {
    return editor.itemById(id) as SceneItemDto;
  }

  afterEach(() => harness?.http.verify());

  it('creates a text with placeholder content and adds it hidden, in the geometry of its style, selected', async () => {
    await setup();
    const added = editor.addText('title');

    const create = harness.http.expectOne(`${BASE}/texts`);
    expect(create.request.method).toBe('POST');
    expect(create.request.body).toEqual({
      line1: 'Title',
      line2: null,
      style: 'title',
      align: null,
    });
    create.flush({
      id: 'txt_bbbbbbbbbbbbbbbb',
      code: 'T2',
      line1: 'Title',
      line2: null,
      style: 'title',
      align: 'center',
    });
    await flushMicrotasks();
    const itemId = await added;

    const replace = harness.http.expectOne(`${SCENE_A}/items`);
    expect(replace.request.method).toBe('PUT');
    expect(replace.request.body.items.at(-1)).toMatchObject({
      id: itemId,
      source: 'txt_bbbbbbbbbbbbbbbb',
      x: 160,
      y: 390,
      w: 1600,
      h: 300,
      radius: 0,
      hidden: true,
    });
    expect(editor.selectedItemId()).toBe(itemId);
  });

  it('adds a lower third with a name and a role as placeholders', async () => {
    await setup();
    void editor.addText('lowerThird');

    const create = harness.http.expectOne(`${BASE}/texts`);

    expect(create.request.body).toMatchObject({
      line1: 'Name',
      line2: 'Role',
      style: 'lowerThird',
    });
    create.error(new ProgressEvent('error'), { status: 409, statusText: 'Conflict' });
    await flushMicrotasks();
    expect(toasts.current()).not.toBeNull();
    harness.http.expectNone(`${SCENE_A}/items`);
  });

  it('does not create a text on the live scene in Studio Mode', async () => {
    await setup({ studio: true });

    expect(await editor.addText('note')).toBeNull();

    harness.http.expectNone(`${BASE}/texts`);
    expect(toasts.current()?.message).toBe(
      'This scene is live. Switch another scene to Program first.',
    );
  });

  it('keeps a hidden text selected and a hidden camera not', async () => {
    await setup();

    editor.select('itm_txt');
    expect(editor.selectedItem()?.id).toBe('itm_txt');
    editor.select('itm_cam');
    editor.toggleHidden('itm_cam');
    harness.http.expectOne(`${SCENE_A}/items/itm_cam`);

    expect(editor.selectedItem()).toBeNull();
    expect(editor.selectedItemId()).toBeNull();
  });

  it('shows a text without an undo step and keeps it selected when it is hidden again', async () => {
    await setup();
    editor.select('itm_txt');

    expect(editor.toggleHidden('itm_txt')).toBe(true);
    const show = harness.http.expectOne(`${SCENE_A}/items/itm_txt`);
    expect(show.request.body.hidden).toBe(false);
    show.flush({ ...harness.store.sceneById('scn_a'), version: 2 });
    await flushMicrotasks();
    expect(editor.canUndo()).toBe(false);

    editor.toggleHidden('itm_txt');
    const hide = harness.http.expectOne(`${SCENE_A}/items/itm_txt`);
    expect(hide.request.body.hidden).toBe(true);
    expect(editor.selectedItemId()).toBe('itm_txt');
    hide.flush({ ...harness.store.sceneById('scn_a'), version: 3 });
    await flushMicrotasks();
    expect(item('itm_txt').hidden).toBe(true);
  });

  it('shows and hides a text on the live scene in Studio Mode, where a camera cannot be touched', async () => {
    await setup({ studio: true });
    expect(editor.editLocked()).toBe(true);

    expect(editor.toggleHidden('itm_txt')).toBe(true);
    const show = harness.http.expectOne(`${SCENE_A}/items/itm_txt`);
    expect(show.request.body.hidden).toBe(false);
    show.flush({ ...harness.store.sceneById('scn_a'), version: 2 });
    await flushMicrotasks();

    expect(editor.toggleHidden('itm_cam')).toBe(false);
    harness.http.expectNone(`${SCENE_A}/items/itm_cam`);
    expect(toasts.current()?.message).toBe(
      'This scene is live. Switch another scene to Program first.',
    );
  });

  it('does not show a text while the server cannot be reached', async () => {
    await setup();
    harness.hub.setState('reconnecting');
    await harness.settle();

    expect(editor.toggleHidden('itm_txt')).toBe(false);

    harness.http.expectNone(`${SCENE_A}/items/itm_txt`);
  });
});
