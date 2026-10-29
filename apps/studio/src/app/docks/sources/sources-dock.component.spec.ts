import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { FakeStudioHub, flushMicrotasks } from '../../../testing/fake-studio-hub';
import { PRODUCTION_ID, productionFixture, sourceFixture } from '../../../testing/fixtures';
import { startStore, studioTestProviders, type StoreHarness } from '../../../testing/store-harness';
import { ContextMenuService, type ContextMenuItem } from '../../core/ui/context-menu';
import { EditorService } from '../../stage/editor.service';
import { dockSnapshot } from '../testing/dock-fixtures';
import { SourcesDockComponent } from './sources-dock.component';

const SCENE_B = `/api/productions/${PRODUCTION_ID}/scenes/scn_b`;

describe('SourcesDockComponent', () => {
  let harness: StoreHarness;
  let fixture: ComponentFixture<SourcesDockComponent>;
  let element: HTMLElement;

  async function setup(programSceneId = 'scn_b'): Promise<void> {
    const hub = new FakeStudioHub();
    TestBed.configureTestingModule({ providers: studioTestProviders(hub) });
    harness = await startStore(
      hub,
      dockSnapshot({
        production: productionFixture({ programSceneId }),
        sources: [
          sourceFixture('dev_aaaaaaaaaaaaaaaa', 'camera', 'K1', {
            label: 'Phone stage left',
            status: 'reconnecting',
            statusSince: new Date(Date.now() - 8000).toISOString(),
          }),
          sourceFixture('dev_bbbbbbbbbbbbbbbb', 'screen-1', 'S1', { label: 'Laptop Lea · Slides' }),
          sourceFixture('dev_cccccccccccccccc', 'camera', 'K2', { label: 'Phone wide shot' }),
        ],
      }),
    );
    fixture = TestBed.createComponent(SourcesDockComponent);
    element = fixture.nativeElement as HTMLElement;
    await render();
  }

  async function render(): Promise<void> {
    await flushMicrotasks();
    fixture.detectChanges();
    await fixture.whenStable();
  }

  function rows(): HTMLElement[] {
    return Array.from(element.querySelectorAll<HTMLElement>('.c-src'));
  }

  function text(node: Element | null | undefined): string {
    return (node?.textContent ?? '').replace(/\s+/g, ' ').trim();
  }

  afterEach(() => harness.http.verify());

  it('names the edit scene with its capsule and says that edits go live', async () => {
    await setup();
    expect(text(element.querySelector('.c-src-dock__scene'))).toBe('in Presentation');
    expect(text(element.querySelector('.c-src-dock__head .c-tag--pgm'))).toBe('Live');
    expect(text(element.querySelector('.c-edit-status'))).toBe(
      'Live scene: every change goes on air at once.',
    );
    // Neutral while the broadcast is not on air.
    expect(element.querySelector('.c-edit-status')?.className).not.toContain('is-on-air');
  });

  it('lists the items front to back with code, state, timer and lamp', async () => {
    await setup();
    const [front, back] = rows();
    expect(rows()).toHaveLength(2);
    expect(text(front.querySelector('.c-code'))).toBe('K1');
    expect(text(front.querySelector('.c-src__name'))).toBe('Phone stage left');
    expect(text(front.querySelector('.c-state--warn'))).toBe('reconnecting');
    expect(text(front.querySelector('.c-src__state .u-mono'))).toMatch(/^00:0[89]$/);
    expect(front.querySelector('.c-lamp')?.className).toContain('is-warn');
    expect(text(back.querySelector('.c-code'))).toBe('S1');
    expect(back.querySelector('.c-src__state')).toBeNull();
    expect(text(element.querySelector('.c-src-dock__hint'))).toBe(
      'The top row is in front. Click a source in the Program monitor to move it or to resize it ' +
        'at the corners.',
    );
    const eye = front.querySelector<HTMLButtonElement>('.c-ibtn');
    expect(eye?.getAttribute('aria-label')).toBe('Hide: Phone stage left');
    expect(eye?.getAttribute('aria-pressed')).toBe('true');
    expect(eye?.title).toBe('Hide on the output');
    expect(front.querySelectorAll('.c-ibtn')[1]?.getAttribute('title')).toBe(
      'Lock: keep its place and size on the monitor',
    );
  });

  it('selects a row for the monitor and the inspector', async () => {
    await setup();
    rows()[1].querySelector<HTMLButtonElement>('.c-src__select')?.click();
    await render();
    expect(TestBed.inject(EditorService).selectedItemId()).toBe('itm_b1');
    expect(rows()[1].className).toContain('is-sel');
    expect(element.querySelector('.c-src-dock__hint')).toBeNull();
  });

  it('offers the item commands on a right click; Properties… selects the item', async () => {
    await setup();
    rows()[1].dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }),
    );
    const menus = TestBed.inject(ContextMenuService);
    const items = (menus.current()?.entries ?? []).filter(
      (entry): entry is ContextMenuItem => entry !== 'separator',
    );
    expect(menus.current()?.label).toBe('Source Laptop Lea · Slides');
    expect(items.map((entry) => entry.label)).toEqual([
      'Hide on the output',
      'Lock position and size',
      'Bring to front',
      'Bring forward',
      'Send backward',
      'Send to back',
      'Fill',
      'Show all',
      'Properties…',
      'Remove from scene',
    ]);
    // The back row cannot go further back.
    expect(items.filter((entry) => entry.disabled).map((entry) => entry.label)).toEqual([
      'Send backward',
      'Send to back',
    ]);
    menus.run(items[8]);
    await render();
    expect(TestBed.inject(EditorService).selectedItemId()).toBe('itm_b1');
  });

  it('selects the neighbour with the arrow keys and removes with Delete', async () => {
    await setup();
    const editor = TestBed.inject(EditorService);
    const selectButton = (index: number): HTMLButtonElement =>
      rows()[index].querySelector<HTMLButtonElement>('.c-src__select') as HTMLButtonElement;
    selectButton(0).focus();
    selectButton(0).dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
    );
    await render();
    expect(editor.selectedItemId()).toBe('itm_b1');
    expect(document.activeElement).toBe(selectButton(1));
    selectButton(1).dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    const request = harness.http.expectOne(`${SCENE_B}/items/itm_b1`);
    expect(request.request.method).toBe('DELETE');
    request.flush({ ...harness.store.sceneById('scn_b'), version: 2 });
    await render();
    expect(editor.selectedItemId()).toBeNull();
  });

  it('a second click on the selected row clears the selection (toggle)', async () => {
    await setup();
    const editor = TestBed.inject(EditorService);
    const selectButton = (index: number): HTMLButtonElement =>
      rows()[index].querySelector<HTMLButtonElement>('.c-src__select') as HTMLButtonElement;
    selectButton(1).click();
    await render();
    expect(editor.selectedItemId()).toBe('itm_b1');
    expect(selectButton(1).getAttribute('aria-pressed')).toBe('true');
    selectButton(1).click();
    await render();
    expect(editor.selectedItemId()).toBeNull();
    expect(selectButton(1).getAttribute('aria-pressed')).toBe('false');
    expect(rows()[1].className).not.toContain('is-sel');
    // The row itself toggles as well; another row moves the selection instead of clearing it.
    rows()[1].click();
    await render();
    expect(editor.selectedItemId()).toBe('itm_b1');
    selectButton(0).click();
    await render();
    expect(editor.selectedItemId()).toBe('itm_b2');
    rows()[0].click();
    await render();
    expect(editor.selectedItemId()).toBeNull();
    harness.http.expectNone(() => true);
  });

  it('hides and locks items through the editor', async () => {
    await setup();
    const [front] = rows();
    front.querySelector<HTMLButtonElement>('.c-ibtn')?.click();
    const hide = harness.http.expectOne(`${SCENE_B}/items/itm_b2`);
    expect(hide.request.body.hidden).toBe(true);
    await render();
    expect(rows()[0].className).toContain('is-hidden');
    expect(rows()[0].querySelector('.c-ibtn')?.getAttribute('aria-label')).toBe(
      'Show: Phone stage left',
    );
    hide.flush({ ...harness.store.sceneById('scn_b'), version: 2 });
    await render();
    const lock = rows()[0].querySelectorAll<HTMLButtonElement>('.c-ibtn')[1];
    expect(lock.getAttribute('aria-label')).toBe('Lock: Phone stage left');
    lock.click();
    const locked = harness.http.expectOne(`${SCENE_B}/items/itm_b2`);
    expect(locked.request.body.locked).toBe(true);
    locked.flush({ ...harness.store.sceneById('scn_b'), version: 3 });
    await render();
  });

  it('shows the empty state of an empty scene with its actions', async () => {
    await setup('scn_c');
    expect(text(element.querySelector('.c-empty strong'))).toBe('This scene is empty.');
    expect(text(element.querySelector('.c-empty'))).toContain(
      'Add a camera, a screen, media or a text.',
    );
    const actions = Array.from(element.querySelectorAll<HTMLButtonElement>('.c-empty button'));
    expect(actions.map((button) => text(button))).toEqual([
      'Add a source',
      'Upload media',
      'New lower third',
    ]);
    actions[0].click();
    await render();
    expect(element.querySelector('[role="menu"]')?.getAttribute('aria-label')).toBe('Add source');
  });

  it('adds a source from the "+ Source" menu, grouped by kind', async () => {
    await setup();
    const trigger = element.querySelector<HTMLButtonElement>('button[aria-label="Add source"]');
    expect(text(trigger)).toBe('Source');
    trigger?.click();
    await render();
    const menu = element.querySelector('[role="menu"]');
    expect(text(menu?.querySelector('.c-pop-h'))).toBe('Add to “Presentation”');
    const groups = Array.from(menu?.querySelectorAll('.c-add-pop__label') ?? []).map(text);
    expect(groups).toEqual(['Cameras', 'Screens', 'New text']);
    const items = Array.from(menu?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
    expect(items.map(text)).toEqual([
      'K1Phone stage leftIn scene',
      'K2Phone wide shot',
      'S1Laptop Lea · SlidesIn scene',
      'Lower third',
      'Title',
      'Note',
      'Upload image or video…',
      'Media library…',
    ]);
    // The sources already in the scene are listed, but cannot be added again.
    expect(items.map((item) => item.disabled)).toEqual([
      true,
      false,
      true,
      false,
      false,
      false,
      false,
      false,
    ]);
    items[1].click();
    const add = harness.http.expectOne(`${SCENE_B}/items`);
    expect(add.request.body.items.at(-1)).toMatchObject({
      source: 'dev_cccccccccccccccc/camera',
      x: 1240,
      y: 680,
      w: 600,
      h: 338,
    });
    add.flush({ ...harness.store.sceneById('scn_b'), version: 2 });
    await render();
    expect(element.querySelector('[role="menu"]')).toBeNull();
  });
});
