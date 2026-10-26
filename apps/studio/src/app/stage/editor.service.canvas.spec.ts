import { TestBed } from '@angular/core/testing';
import {
  canvasDto,
  type CanvasDto,
  type SceneDto,
  type SceneItemDto,
} from '@studioflow/scene-model';
import { FakeStudioHub } from '../../testing/fake-studio-hub';
import {
  PRODUCTION_ID,
  defaultScenes,
  itemFixture,
  productionFixture,
  sceneFixture,
  snapshotFixture,
  textSourceFixture,
} from '../../testing/fixtures';
import { startStore, studioTestProviders, type StoreHarness } from '../../testing/store-harness';
import { ToastService } from '../core/ui/toast.service';
import { EditorService } from './editor.service';

const TEXT_ID = 'txt_aaaaaaaaaaaaaaaa';
const SCENE_A = `/api/productions/${PRODUCTION_ID}/scenes/scn_a`;

describe('EditorService: canvas of the production', () => {
  let harness: StoreHarness;
  let editor: EditorService;

  async function setup(canvas: CanvasDto, scenes: SceneDto[] = defaultScenes()): Promise<void> {
    const hub = new FakeStudioHub();
    TestBed.configureTestingModule({ providers: studioTestProviders(hub) });
    harness = await startStore(
      hub,
      snapshotFixture({
        production: productionFixture({ canvas }),
        scenes,
        sources: [...snapshotFixture().sources, textSourceFixture(TEXT_ID, 'T1')],
      }),
    );
    editor = TestBed.inject(EditorService);
    await harness.settle();
  }

  function sentItems(): SceneItemDto[] {
    const request = harness.http.expectOne(`${SCENE_A}/items`);
    const items = request.request.body.items as SceneItemDto[];
    request.flush({ ...harness.store.sceneById('scn_a'), version: 2 });
    return items;
  }

  afterEach(() => harness?.http.verify());

  describe('adding a source', () => {
    it('places a picture at the bottom right of a portrait canvas, in its 16:9 shape', async () => {
      await setup(canvasDto('portrait', 'p1080'));

      editor.addSource('dev_bbbbbbbbbbbbbbbb/screen-1');

      expect(editor.selectedItem()).toMatchObject({ x: 698, y: 1695, w: 338, h: 190 });
      expect(sentItems()).toHaveLength(2);
    });

    it('places a picture on a 720p canvas in proportion', async () => {
      await setup(canvasDto('widescreen', 'p720'));

      editor.addSource('dev_bbbbbbbbbbbbbbbb/screen-1');

      expect(editor.selectedItem()).toMatchObject({ x: 827, y: 453, w: 400, h: 225 });
      sentItems();
    });

    it('keeps a text inside the portrait canvas and as high as wide as its style asks', async () => {
      await setup(canvasDto('portrait', 'p1080'));

      editor.addSource(TEXT_ID);

      expect(editor.selectedItem()).toMatchObject({ x: 45, y: 1774, w: 540, h: 101 });
      sentItems();
    });
  });

  describe('applying a template', () => {
    it('stacks two pictures on a portrait canvas and says so in the toast', async () => {
      await setup(canvasDto('portrait', 'p1080'), [
        sceneFixture('scn_a', 'Welcome', 0, [
          itemFixture('itm_a1', 'dev_aaaaaaaaaaaaaaaa/camera'),
          itemFixture('itm_a2', 'dev_bbbbbbbbbbbbbbbb/screen-1'),
        ]),
      ]);

      expect(editor.applyTemplate('two')).toBe(true);

      const [screen, camera] = sentItems();
      expect(screen).toMatchObject({ x: 40, y: 377, w: 1000, h: 563 });
      expect(camera).toMatchObject({ x: 40, y: 980, w: 1000, h: 563 });
      expect(TestBed.inject(ToastService).current()?.message).toBe('Template “Stacked” applied');
    });

    it('uses the slots of 1920 × 1080 unchanged', async () => {
      await setup(canvasDto('widescreen', 'p1080'));

      editor.applyTemplate('pip');

      const [camera] = sentItems();
      expect(camera).toMatchObject({ x: 0, y: 0, w: 1920, h: 1080 });
      expect(TestBed.inject(ToastService).current()?.message).toBe(
        'Template “Picture in picture” applied',
      );
    });
  });

  describe('undo', () => {
    it('forgets the steps when the canvas changes: they hold the geometry of the old pixels', async () => {
      await setup(canvasDto('widescreen', 'p1080'));
      editor.updateItem({ ...(editor.itemById('itm_a1') as SceneItemDto), x: 300 });
      harness.http
        .expectOne(`${SCENE_A}/items/itm_a1`)
        .flush({ ...harness.store.sceneById('scn_a'), version: 2 });
      await harness.settle();
      expect(editor.canUndo()).toBe(true);

      harness.emitEvent({
        type: 'productionCanvasChanged',
        production: productionFixture({ canvas: canvasDto('portrait', 'p1080') }),
        scenes: [],
      });
      await harness.settle();

      expect(editor.canUndo()).toBe(false);
      expect(editor.canRedo()).toBe(false);
    });

    it('keeps the steps when something else about the production changes', async () => {
      await setup(canvasDto('widescreen', 'p1080'));
      editor.updateItem({ ...(editor.itemById('itm_a1') as SceneItemDto), x: 300 });
      harness.http
        .expectOne(`${SCENE_A}/items/itm_a1`)
        .flush({ ...harness.store.sceneById('scn_a'), version: 2 });
      await harness.settle();

      harness.emitEvent({
        type: 'productionChanged',
        production: productionFixture({ name: 'Renamed' }),
      });
      await harness.settle();

      expect(editor.canUndo()).toBe(true);
    });
  });
});
