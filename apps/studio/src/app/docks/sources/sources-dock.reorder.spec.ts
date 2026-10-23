import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type { SceneDto, SceneItemDto } from '@studioflow/scene-model';
import { FakeStudioHub, flushMicrotasks } from '../../../testing/fake-studio-hub';
import {
  PRODUCTION_ID,
  itemFixture,
  productionFixture,
  sceneFixture,
  sourceFixture,
} from '../../../testing/fixtures';
import {
  MemoryStorage,
  startStore,
  studioTestProviders,
  type StoreHarness,
} from '../../../testing/store-harness';
import { PREFERENCE_KEYS } from '../../core/ui/preferences.service';
import { ToastService } from '../../core/ui/toast.service';
import { EditorService } from '../../stage/editor.service';
import { dockSnapshot } from '../testing/dock-fixtures';
import { centre, dragRow, pointer, pressKey, stubRowLayout } from '../testing/sortable-test-kit';
import { SourcesDockComponent } from './sources-dock.component';

const SCENE = `/api/productions/${PRODUCTION_ID}/scenes/scn_a`;
const ORDER = `${SCENE}/items/order`;

/** Back to front: K1, S1, K2. The dock lists them front to back: K2, S1, K1. */
function threeItems(): SceneItemDto[] {
  return [
    itemFixture('itm_1', 'dev_aaaaaaaaaaaaaaaa/camera'),
    itemFixture('itm_2', 'dev_bbbbbbbbbbbbbbbb/screen-1', { hidden: true }),
    itemFixture('itm_3', 'dev_cccccccccccccccc/camera', { locked: true }),
  ];
}

describe('SourcesDockComponent reordering', () => {
  let harness: StoreHarness;
  let fixture: ComponentFixture<SourcesDockComponent>;
  let element: HTMLElement;
  let toasts: ToastService;
  let editor: EditorService;

  async function setup(
    options: { studio?: boolean; preview?: string; scene?: Partial<SceneDto> } = {},
  ): Promise<void> {
    const hub = new FakeStudioHub();
    const storage = new MemoryStorage();
    if (options.studio) {
      storage.setItem(PREFERENCE_KEYS.studioMode, '1');
    }
    TestBed.configureTestingModule({ providers: studioTestProviders(hub, storage) });
    harness = await startStore(
      hub,
      dockSnapshot({
        production: productionFixture({
          programSceneId: 'scn_a',
          previewSceneId: options.preview ?? null,
        }),
        scenes: [
          { ...sceneFixture('scn_a', 'Welcome', 0, threeItems()), ...options.scene },
          sceneFixture('scn_b', 'Presentation', 1),
        ],
        sources: [
          sourceFixture('dev_aaaaaaaaaaaaaaaa', 'camera', 'K1', { label: 'Phone stage left' }),
          sourceFixture('dev_bbbbbbbbbbbbbbbb', 'screen-1', 'S1', { label: 'Laptop Lea' }),
          sourceFixture('dev_cccccccccccccccc', 'camera', 'K2', { label: 'Phone wide shot' }),
        ],
      }),
    );
    toasts = TestBed.inject(ToastService);
    editor = TestBed.inject(EditorService);
    fixture = TestBed.createComponent(SourcesDockComponent);
    element = fixture.nativeElement as HTMLElement;
    document.body.append(element);
    await render();
  }

  async function render(): Promise<void> {
    await flushMicrotasks();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  /** The codes of the rows, front to back. */
  function codes(): string[] {
    return Array.from(element.querySelectorAll('.c-src .c-code')).map(
      (code) => code.textContent?.trim() ?? '',
    );
  }

  function row(code: string): HTMLElement {
    const found = Array.from(element.querySelectorAll<HTMLElement>('.c-src')).find(
      (candidate) => candidate.querySelector('.c-code')?.textContent?.trim() === code,
    );
    return found as HTMLElement;
  }

  function select(code: string): HTMLButtonElement {
    return row(code).querySelector('.c-src__select') as HTMLButtonElement;
  }

  function handle(code: string): HTMLButtonElement {
    return (row(code).closest('[data-sortable-id]') as HTMLElement).querySelector(
      '.c-sortable__handle',
    ) as HTMLButtonElement;
  }

  /** Answers the order request with the scene as the server stores it afterwards. */
  async function acknowledge(itemIds: string[]): Promise<void> {
    const request = harness.http.expectOne(ORDER);
    expect(request.request.method).toBe('PUT');
    expect(request.request.body).toEqual({ itemIds });
    const stored = harness.store.sceneById('scn_a') as SceneDto;
    const items = itemIds.map((id) => stored.items.find((item) => item.id === id) as SceneItemDto);
    request.flush({ ...stored, items, version: stored.version + 1 });
    await flushMicrotasks();
    harness.emitEvent({
      type: 'sceneUpserted',
      scene: { ...stored, items, version: stored.version + 1 },
    });
    await harness.settle();
    await render();
  }

  beforeEach(() => stubRowLayout());

  afterEach(() => {
    harness.http.verify();
    element.remove();
    document.body.querySelector('[aria-live]')?.remove();
    vi.restoreAllMocks();
  });

  it('lists the front layer on top, each row with a reorder handle', async () => {
    await setup();
    expect(codes()).toEqual(['K2', 'S1', 'K1']);
    expect(handle('K2').getAttribute('aria-label')).toBe('Reorder K2 Phone wide shot');
    expect(element.querySelector('sf-sortable-list')?.getAttribute('aria-label')).toBe(
      'Items of the scene',
    );
  });

  it('sends the new order once on drop, front row dragged to the back', async () => {
    await setup();
    dragRow(select('K2'), 0, centre(2) + 5);
    await render();
    // Optimistic: the order is shown at once, before the answer.
    expect(codes()).toEqual(['S1', 'K1', 'K2']);
    expect(editor.editScene()?.items.map((item) => item.id)).toEqual(['itm_3', 'itm_1', 'itm_2']);
    await acknowledge(['itm_3', 'itm_1', 'itm_2']);
    expect(codes()).toEqual(['S1', 'K1', 'K2']);
    expect(editor.canUndo()).toBe(true);
  });

  it('sends nothing while dragging, and nothing for a drop at the old position', async () => {
    await setup();
    dragRow(select('S1'), 1, centre(2) + 5, false);
    await render();
    harness.http.expectNone(() => true);
    expect(element.querySelector('.c-sortable__line')).not.toBeNull();
    pointer('pointermove', document, 100, centre(1) + 4);
    pointer('pointerup', document, 100, centre(1) + 4);
    await render();
    harness.http.expectNone(() => true);
    expect(codes()).toEqual(['K2', 'S1', 'K1']);
  });

  it('reorders hidden and locked items too', async () => {
    await setup();
    dragRow(select('S1'), 1, centre(0) - 5);
    await render();
    expect(codes()).toEqual(['S1', 'K2', 'K1']);
    await acknowledge(['itm_1', 'itm_3', 'itm_2']);
    expect(editor.itemById('itm_2')).toMatchObject({ hidden: true });
    expect(editor.itemById('itm_3')).toMatchObject({ locked: true });
  });

  it('keeps a click a click: a short press selects the row and sends nothing', async () => {
    await setup();
    pointer('pointerdown', select('S1'), 100, centre(1));
    pointer('pointermove', document, 101, centre(1) + 1);
    pointer('pointerup', document, 101, centre(1) + 1);
    select('S1').click();
    await render();
    expect(codes()).toEqual(['K2', 'S1', 'K1']);
    expect(editor.selectedItemId()).toBeNull();
    // S1 is hidden and cannot be selected, K1 can.
    select('K1').click();
    await render();
    expect(editor.selectedItemId()).toBe('itm_1');
    harness.http.expectNone(() => true);
  });

  it('does not select or deselect the dragged row', async () => {
    await setup();
    select('K1').click();
    await render();
    expect(editor.selectedItemId()).toBe('itm_1');
    dragRow(select('K1'), 2, centre(0) - 5);
    select('K1').click();
    await render();
    expect(editor.selectedItemId()).toBe('itm_1');
    await acknowledge(['itm_2', 'itm_3', 'itm_1']);
    expect(editor.selectedItemId()).toBe('itm_1');
  });

  it('restores the order on Escape without a request', async () => {
    await setup();
    dragRow(select('K2'), 0, centre(2), false);
    await render();
    pressKey(document.body, 'Escape');
    pointer('pointerup', document, 100, centre(2));
    await render();
    expect(codes()).toEqual(['K2', 'S1', 'K1']);
    harness.http.expectNone(() => true);
  });

  it('restores the previous order and explains when the server refuses', async () => {
    await setup();
    dragRow(select('K2'), 0, centre(2) + 5);
    await render();
    expect(codes()).toEqual(['S1', 'K1', 'K2']);
    harness.http
      .expectOne(ORDER)
      .flush({ code: 'conflict' }, { status: 409, statusText: 'Conflict' });
    await flushMicrotasks();
    await render();
    expect(codes()).toEqual(['K2', 'S1', 'K1']);
    expect(toasts.current()?.message).toBe(
      'That is not possible right now because the state has changed.',
    );
  });

  it('moves a row one place with Alt+Up/Down and announces its position', async () => {
    await setup();
    select('S1').focus();
    pressKey(select('S1'), 'ArrowUp', { altKey: true });
    await render();
    expect(codes()).toEqual(['S1', 'K2', 'K1']);
    await acknowledge(['itm_1', 'itm_3', 'itm_2']);
    vi.useFakeTimers();
    pressKey(select('K1'), 'ArrowUp', { altKey: true, shiftKey: true });
    vi.advanceTimersByTime(50);
    expect(document.body.querySelector('[aria-live]')?.textContent).toBe(
      'K1 Phone stage left moved to position 1 of 3.',
    );
    vi.useRealTimers();
    await render();
    expect(codes()).toEqual(['K1', 'S1', 'K2']);
    await acknowledge(['itm_3', 'itm_2', 'itm_1']);
  });

  it('picks a row up with the handle, moves it with the arrows and drops it', async () => {
    await setup();
    handle('K2').focus();
    pressKey(handle('K2'), ' ');
    pressKey(handle('K2'), 'ArrowDown');
    pressKey(handle('K2'), 'ArrowDown');
    pressKey(handle('K2'), ' ');
    await render();
    expect(codes()).toEqual(['S1', 'K1', 'K2']);
    await acknowledge(['itm_3', 'itm_1', 'itm_2']);
  });

  it('sends the ids only, so no item of another session can be overwritten', async () => {
    await setup();
    dragRow(select('K2'), 0, centre(2) + 5);
    await render();
    const request = harness.http.expectOne(ORDER);
    // The request carries ids only; nothing of an item can be overwritten.
    expect(Object.keys(request.request.body)).toEqual(['itemIds']);
    request.flush({}, { status: 409, statusText: 'Conflict' });
    await flushMicrotasks();
  });

  it('lets go of the drag when another session changes the scene meanwhile', async () => {
    await setup();
    dragRow(select('K2'), 0, centre(2) + 5, false);
    await render();
    const stored = harness.store.sceneById('scn_a') as SceneDto;
    harness.emitEvent({
      type: 'sceneUpserted',
      scene: {
        ...stored,
        items: [...stored.items, itemFixture('itm_4', 'dev_aaaaaaaaaaaaaaaa/camera')],
        version: stored.version + 1,
      },
    });
    await harness.settle();
    await render();
    pointer('pointerup', document, 100, centre(2) + 5);
    await render();
    harness.http.expectNone(() => true);
    expect(codes()).toEqual(['K1', 'K2', 'S1', 'K1']);
  });

  it('refuses on the live scene in Studio Mode and puts the row back', async () => {
    await setup({ studio: true, preview: 'scn_a' });
    dragRow(select('K2'), 0, centre(2) + 5);
    await render();
    expect(codes()).toEqual(['K2', 'S1', 'K1']);
    expect(toasts.current()?.message).toBe(
      'This scene is live. Switch another scene to Program first.',
    );
    harness.http.expectNone(() => true);
  });

  describe('Auto grid', () => {
    it('says that the order is the position in the grid, also when an item is selected', async () => {
      await setup({ scene: { layoutMode: 'autoGrid' } });
      select('K1').click();
      await render();
      expect(element.querySelector('.c-src-dock__hint')?.textContent?.trim()).toBe(
        'Auto grid: the order of the items is their position in the grid. Drag a row to move an item to another cell.',
      );
    });

    it('reorders without leaving the Auto grid', async () => {
      await setup({ scene: { layoutMode: 'autoGrid' } });
      dragRow(select('K2'), 0, centre(2) + 5);
      await render();
      expect(editor.editScene()?.layoutMode).toBe('autoGrid');
      await acknowledge(['itm_3', 'itm_1', 'itm_2']);
    });
  });

  describe('file drop', () => {
    function dragEvent(type: string, files: File[]): DragEvent {
      const event = new Event(type, { bubbles: true, cancelable: true }) as DragEvent;
      Object.defineProperty(event, 'dataTransfer', {
        value: { types: files.length > 0 ? ['Files'] : ['text/plain'], files, dropEffect: '' },
      });
      return event;
    }

    it('still shows the drop target for files over the list and rejects an unsupported file', async () => {
      await setup();
      const dock = element.querySelector('.c-src-dock') as HTMLElement;
      const svg = new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' });
      const over = dragEvent('dragover', [svg]);
      dock.querySelector('.c-sortable__row')?.dispatchEvent(over);
      await render();
      expect(over.defaultPrevented).toBe(true);
      expect(dock.classList.contains('is-drop')).toBe(true);
      dock.dispatchEvent(dragEvent('drop', [svg]));
      await render();
      expect(dock.classList.contains('is-drop')).toBe(false);
      expect(toasts.current()?.message).toContain('logo.svg');
    });

    it('ignores a text drag and a row drag does not look like a file drop', async () => {
      await setup();
      const dock = element.querySelector('.c-src-dock') as HTMLElement;
      const text = dragEvent('dragover', []);
      dock.dispatchEvent(text);
      expect(text.defaultPrevented).toBe(false);
      dragRow(select('K2'), 0, centre(2) + 5, false);
      await render();
      expect(dock.classList.contains('is-drop')).toBe(false);
      pointer('pointerup', document, 100, centre(2) + 5);
      await render();
      harness.http.expectOne(ORDER).flush({}, { status: 409, statusText: 'Conflict' });
    });
  });
});
