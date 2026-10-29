import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type { SceneDto } from '@studioflow/scene-model';
import { FakeStudioHub, flushMicrotasks } from '../../../testing/fake-studio-hub';
import { PRODUCTION_ID, productionFixture } from '../../../testing/fixtures';
import {
  MemoryStorage,
  startStore,
  studioTestProviders,
  type StoreHarness,
} from '../../../testing/store-harness';
import { PREFERENCE_KEYS } from '../../core/ui/preferences.service';
import { EditorService } from '../../stage/editor.service';
import { dockSnapshot } from '../testing/dock-fixtures';
import { InspectorSectionsService } from './inspector-sections.service';
import { PropertiesDockComponent } from './properties-dock.component';

const BASE = `/api/productions/${PRODUCTION_ID}`;

describe('PropertiesDockComponent', () => {
  let harness: StoreHarness;
  let fixture: ComponentFixture<PropertiesDockComponent>;
  let element: HTMLElement;
  let editor: EditorService;
  let storage: MemoryStorage;

  async function setup(
    options: { program?: string; preview?: string | null; studio?: boolean } = {},
  ): Promise<void> {
    const hub = new FakeStudioHub();
    storage = new MemoryStorage();
    if (options.studio) {
      storage.setItem(PREFERENCE_KEYS.studioMode, '1');
    }
    TestBed.configureTestingModule({ providers: studioTestProviders(hub, storage) });
    harness = await startStore(
      hub,
      dockSnapshot({
        production: productionFixture({
          programSceneId: options.program ?? 'scn_b',
          previewSceneId: options.preview ?? null,
        }),
      }),
    );
    editor = TestBed.inject(EditorService);
    fixture = TestBed.createComponent(PropertiesDockComponent);
    element = fixture.nativeElement as HTMLElement;
    await render();
  }

  async function render(): Promise<void> {
    await flushMicrotasks();
    fixture.detectChanges();
    await fixture.whenStable();
  }

  function text(node: Element | null | undefined): string {
    return (node?.textContent ?? '').replace(/\s+/g, ' ').trim();
  }

  function field(id: string): HTMLInputElement {
    return element.querySelector<HTMLInputElement>(`#${id}`) as HTMLInputElement;
  }

  function type(input: HTMLInputElement, value: string): void {
    input.value = value;
    input.dispatchEvent(new Event('input'));
  }

  function button(label: string): HTMLButtonElement | undefined {
    return Array.from(element.querySelectorAll<HTMLButtonElement>('button')).find(
      (entry) => text(entry) === label,
    );
  }

  /** Which view the inspector head shows: `scene` or `item`. */
  function view(): string | null {
    return element.querySelector('.c-insp-head')?.getAttribute('data-view') ?? null;
  }

  function headName(): string {
    return text(element.querySelector('.c-insp-head__name'));
  }

  afterEach(() => harness.http.verify());

  it('shows the scene inspector with the templates, the live status and the live-scene hint', async () => {
    await setup();
    expect(text(element.querySelector('.c-dock-frame__title'))).toBe('Properties');
    expect(view()).toBe('scene');
    expect(headName()).toBe('Presentation');
    expect(text(element.querySelector('.c-insp-head .c-tag--pgm'))).toBe('Live');
    expect(text(element.querySelector('.c-edit-status'))).toBe(
      'Live scene: every change goes on air at once.',
    );
    expect(field('sf-insp-name').value).toBe('Presentation');
    expect(element.querySelectorAll('.c-preset')).toHaveLength(8);
    expect(
      Array.from(element.querySelectorAll('.c-insp-sec__title')).map((title) => text(title)),
    ).toEqual(['Layout templates', 'Background']);
    expect(text(element.querySelector('.c-insp__danger .c-hint'))).toBe(
      'The live scene cannot be deleted. Other scenes can be deleted from their menu in Scenes.',
    );
    expect(button('Delete scene…')?.disabled).toBe(true);
  });

  it('remembers a collapsed section in this browser', async () => {
    await setup();
    const details = element.querySelector<HTMLDetailsElement>(
      'details.c-insp-sec',
    ) as HTMLDetailsElement;
    expect(details.open).toBe(true);
    details.open = false;
    details.dispatchEvent(new Event('toggle'));
    await render();
    expect(storage.getItem('studioflow.inspector')).toBe('["layout"]');
    details.open = true;
    details.dispatchEvent(new Event('toggle'));
    await render();
    expect(storage.getItem('studioflow.inspector')).toBe('[]');
  });

  it('applies a template', async () => {
    await setup();
    const tiles = Array.from(element.querySelectorAll<HTMLButtonElement>('.c-preset'));
    tiles.find((tile) => text(tile).includes('Side by side'))?.click();
    const request = harness.http.expectOne(`${BASE}/scenes/scn_b/items`);
    expect(request.request.body.items.map((item: { x: number }) => item.x)).toEqual([40, 980]);
    expect(request.request.body.layoutMode).toBe('free');
    request.flush({ ...(harness.store.sceneById('scn_b') as SceneDto), version: 2 });
    await render();
  });

  it('deletes another scene only after the dashed confirmation', async () => {
    await setup({ studio: true, preview: 'scn_c', program: 'scn_a' });
    expect(headName()).toBe('Break');
    expect(text(element.querySelector('.c-insp-head .c-tag--pvw'))).toBe('Preview');
    expect(element.querySelector('.c-edit-status')).toBeNull();
    expect(text(element.querySelector('.c-insp__danger .c-hint'))).toBe(
      'Removes the scene with everything in it.',
    );
    button('Delete scene…')?.click();
    await render();
    expect(text(element.querySelector('.c-confirm span'))).toBe(
      '“Break” will be deleted. This cannot be undone.',
    );
    harness.http.expectNone(() => true);
    element.querySelector<HTMLButtonElement>('.c-confirm .c-btn--danger-fill')?.click();
    const preview = harness.http.expectOne(`${BASE}/preview`);
    expect(preview.request.body).toEqual({ sceneId: 'scn_b' });
    preview.flush(productionFixture({ programSceneId: 'scn_a', previewSceneId: 'scn_b' }));
    await flushMicrotasks();
    harness.http
      .expectOne(`${BASE}/scenes/scn_c`)
      .flush(null, { status: 204, statusText: 'No Content' });
    await render();
  });

  it('commits typed numbers clamped to the server bounds, one undo step per field', async () => {
    await setup();
    editor.select('itm_b1');
    await render();
    expect(view()).toBe('item');
    expect(text(element.querySelector('.c-insp-head .c-code'))).toBe('S1');
    expect(headName()).toBe('Laptop Lea · Slides');
    expect(
      Array.from(element.querySelectorAll('.c-insp-sec__title')).map((title) => text(title)),
    ).toEqual(['Position & size', 'Fit & crop', 'Layer']);
    const tabs = Array.from(element.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
    expect(tabs.map((tab) => [text(tab), tab.getAttribute('aria-selected')])).toEqual([
      ['Layout', 'true'],
      ['Style', 'false'],
      ['When it fails', 'false'],
    ]);
    expect(element.querySelector<HTMLElement>('#sf-insp-panel-style')?.hidden).toBe(true);
    tabs[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await render();
    expect(tabs[1].getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(tabs[1]);
    expect(element.querySelector<HTMLElement>('#sf-insp-panel-style')?.hidden).toBe(false);
    expect(element.querySelector<HTMLElement>('#sf-insp-panel-layout')?.hidden).toBe(true);
    TestBed.inject(InspectorSectionsService).setTab('layout');
    await render();
    expect(text(element.querySelector('.c-insp-sec__note'))).toBe('Canvas 1920 × 1080');
    const x = field('sf-insp-x');
    expect(x.value).toBe('40');
    x.focus();
    x.dispatchEvent(new Event('focus'));
    type(x, '5000');
    const first = harness.http.expectOne(`${BASE}/scenes/scn_b/items/itm_b1`);
    expect(first.request.body.x).toBe(3840);
    // The field keeps what is typed while it has the focus.
    expect(x.value).toBe('5000');
    type(x, '-');
    type(x, '120');
    first.flush({ ...(harness.store.sceneById('scn_b') as SceneDto), version: 2 });
    await flushMicrotasks();
    const second = harness.http.expectOne(`${BASE}/scenes/scn_b/items/itm_b1`);
    expect(second.request.body.x).toBe(120);
    second.flush({ ...(harness.store.sceneById('scn_b') as SceneDto), version: 3 });
    await render();
    x.dispatchEvent(new Event('blur'));
    await render();
    expect(x.value).toBe('120');
    expect(editor.canUndo()).toBe(true);
    editor.undo();
    const undo = harness.http.expectOne(`${BASE}/scenes/scn_b/items`);
    expect(undo.request.body.items[0].x).toBe(40);
    undo.flush({ ...(harness.store.sceneById('scn_b') as SceneDto), version: 4 });
    await render();
  });

  it('crops in percent and resets the crop', async () => {
    await setup();
    editor.select('itm_b1');
    await render();
    type(field('sf-insp-crop-left'), '60');
    const crop = harness.http.expectOne(`${BASE}/scenes/scn_b/items/itm_b1`);
    expect(crop.request.body.crop.left).toBeCloseTo(0.45);
    crop.flush({ ...(harness.store.sceneById('scn_b') as SceneDto), version: 2 });
    await render();
    button('Reset')?.click();
    const reset = harness.http.expectOne(`${BASE}/scenes/scn_b/items/itm_b1`);
    expect(reset.request.body.crop).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
    reset.flush({ ...(harness.store.sceneById('scn_b') as SceneDto), version: 3 });
    await render();
  });

  it('sets fit, rotation and the hold behaviour', async () => {
    await setup();
    editor.select('itm_b2');
    await render();
    button('Show all')?.click();
    const fit = harness.http.expectOne(`${BASE}/scenes/scn_b/items/itm_b2`);
    expect(fit.request.body.fit).toBe('contain');
    fit.flush({ ...(harness.store.sceneById('scn_b') as SceneDto), version: 2 });
    await render();
    button('90°')?.click();
    const rotate = harness.http.expectOne(`${BASE}/scenes/scn_b/items/itm_b2`);
    expect(rotate.request.body.rotation).toBe(90);
    rotate.flush({ ...(harness.store.sceneById('scn_b') as SceneDto), version: 3 });
    await render();
    const hold = element.querySelector<HTMLSelectElement>('#sf-insp-hold') as HTMLSelectElement;
    expect(Array.from(hold.options).map((option) => option.text.trim())).toEqual([
      'Last picture for 3 s',
      'Last picture for 10 s',
      'Last picture until the source is back',
    ]);
    hold.value = 'hold';
    hold.dispatchEvent(new Event('change'));
    const held = harness.http.expectOne(`${BASE}/scenes/scn_b/items/itm_b2`);
    expect(held.request.body.onLost).toEqual({ holdMs: null, fallbackSource: null });
    held.flush({ ...(harness.store.sceneById('scn_b') as SceneDto), version: 4 });
    await render();
    expect(element.querySelector<HTMLSelectElement>('#sf-insp-fallback')?.disabled).toBe(true);
    expect(text(element.querySelector('#sf-insp-fallback-hint'))).toBe(
      'The last picture stays until the source is back.',
    );
  });

  function backButton(): HTMLButtonElement | null {
    return element.querySelector<HTMLButtonElement>(
      '.c-insp-head button[aria-label="Clear selection, back to scene"]',
    );
  }

  function heading(): HTMLElement {
    return element.querySelector<HTMLElement>('.c-insp-head__title') as HTMLElement;
  }

  it('"Back to scene" goes back from the element to the scene, focuses the heading and the templates work', async () => {
    await setup();
    expect(backButton()).toBeNull();
    editor.select('itm_b1');
    await render();
    const back = backButton() as HTMLButtonElement;
    expect(text(back)).toBe('Back to scene');
    expect(back.title).toBe('Clear selection (Esc)');
    expect(back.getAttribute('aria-keyshortcuts')).toBe('Escape');
    expect(back.type).toBe('button');
    expect(back.querySelector('svg.c-icon')?.getAttribute('aria-hidden')).toBe('true');
    back.focus();
    back.click();
    await render();
    expect(editor.selectedItemId()).toBeNull();
    expect(backButton()).toBeNull();
    expect(view()).toBe('scene');
    expect(headName()).toBe('Presentation');
    expect(document.activeElement).toBe(heading());
    expect(heading().tabIndex).toBe(-1);
    // The scene inspector is back: "Apply template" with all eight templates.
    const tiles = Array.from(element.querySelectorAll<HTMLButtonElement>('.c-preset'));
    expect(tiles).toHaveLength(8);
    tiles.find((tile) => text(tile).includes('Full screen'))?.click();
    const request = harness.http.expectOne(`${BASE}/scenes/scn_b/items`);
    expect(request.request.body.items[0]).toMatchObject({ x: 0, y: 0, w: 1920, h: 1080 });
    request.flush({ ...(harness.store.sceneById('scn_b') as SceneDto), version: 2 });
    await render();
  });

  it('Escape inside the element view goes back to the scene and keeps the focus in the dock', async () => {
    await setup();
    const off = editor.registerShortcuts();
    editor.select('itm_b2');
    await render();
    const remove = button('Remove from scene') as HTMLButtonElement;
    remove.focus();
    remove.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await render();
    expect(editor.selectedItemId()).toBeNull();
    expect(element.querySelector('sf-scene-inspector')).not.toBeNull();
    expect(document.activeElement).toBe(heading());
    off();
  });

  it('explains Escape in the hint of the element view', async () => {
    await setup();
    editor.select('itm_b1');
    await render();
    expect(text(element.querySelector('.c-insp__note'))).toBe(
      'Shift releases the aspect ratio, Alt turns snapping off, arrow keys move by 1 px. ' +
        'Esc clears the selection.',
    );
  });

  it('offers "Back to scene" on the live scene in Studio Mode too (deselecting is no edit)', async () => {
    await setup({ studio: true, preview: 'scn_b' });
    editor.select('itm_b1');
    await render();
    const back = backButton() as HTMLButtonElement;
    expect(back.disabled).toBe(false);
    back.click();
    await render();
    expect(editor.selectedItemId()).toBeNull();
    expect(element.querySelector('sf-scene-inspector')).not.toBeNull();
    harness.http.expectNone(() => true);
  });

  it('moves the layer one step or to the very front or back, sending only the order', async () => {
    await setup();
    editor.select('itm_b1');
    await render();
    // Back to front: itm_b1, itm_b2. The selected back item can only go forward.
    expect(button('Send backward')?.disabled).toBe(true);
    expect(button('Send to back')?.disabled).toBe(true);
    expect(button('Bring forward')?.disabled).toBe(false);
    button('Bring to front')?.click();
    const request = harness.http.expectOne(`${BASE}/scenes/scn_b/items/order`);
    expect(request.request.body).toEqual({ itemIds: ['itm_b2', 'itm_b1'] });
    await render();
    expect(button('Bring to front')?.disabled).toBe(true);
    expect(button('Send to back')?.disabled).toBe(false);
    request.flush({ ...harness.store.sceneById('scn_b'), version: 2 });
    await flushMicrotasks();
    button('Send to back')?.click();
    const back = harness.http.expectOne(`${BASE}/scenes/scn_b/items/order`);
    expect(back.request.body).toEqual({ itemIds: ['itm_b1', 'itm_b2'] });
    back.flush({ ...harness.store.sceneById('scn_b'), version: 3 });
    await flushMicrotasks();
  });

  it('disables every field while the scene is live in Studio Mode', async () => {
    await setup({ studio: true, preview: 'scn_b' });
    editor.select('itm_b1');
    await render();
    expect(field('sf-insp-x').disabled).toBe(true);
    expect(button('Remove from scene')?.disabled).toBe(true);
    expect(text(element.querySelector('.c-edit-status'))).toBe(
      'This scene is live in Program. Switch another scene to Program to edit it.',
    );
    harness.http.expectNone(() => true);
  });
});
