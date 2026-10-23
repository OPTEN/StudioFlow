import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { FakeStudioHub, flushMicrotasks } from '../../../testing/fake-studio-hub';
import { PRODUCTION_ID } from '../../../testing/fixtures';
import {
  MemoryStorage,
  startStore,
  studioTestProviders,
  type StoreHarness,
} from '../../../testing/store-harness';
import { ToastService } from '../../core/ui/toast.service';
import { dockSnapshot } from '../testing/dock-fixtures';
import { centre, dragRow, pointer, pressKey, stubRowLayout } from '../testing/sortable-test-kit';
import { ScenesDockComponent } from './scenes-dock.component';

const ORDER = `/api/productions/${PRODUCTION_ID}/scenes/order`;
const NO_CONTENT = { status: 204, statusText: 'No Content' };

describe('ScenesDockComponent reordering', () => {
  let harness: StoreHarness;
  let fixture: ComponentFixture<ScenesDockComponent>;
  let element: HTMLElement;
  let toasts: ToastService;

  async function setup(): Promise<void> {
    const hub = new FakeStudioHub();
    TestBed.configureTestingModule({
      providers: studioTestProviders(hub, new MemoryStorage()),
    });
    harness = await startStore(hub, dockSnapshot());
    toasts = TestBed.inject(ToastService);
    fixture = TestBed.createComponent(ScenesDockComponent);
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

  function scene(name: string): HTMLButtonElement {
    const found = Array.from(element.querySelectorAll<HTMLButtonElement>('button.c-scene')).find(
      (button) => button.querySelector('.c-scene__name')?.textContent?.trim() === name,
    );
    return found as HTMLButtonElement;
  }

  /** The scene names with their keycaps, in list order. */
  function list(): string[] {
    return Array.from(element.querySelectorAll('button.c-scene')).map(
      (button) =>
        `${button.querySelector('.c-keycap')?.textContent?.trim()} ${button.querySelector('.c-scene__name')?.textContent?.trim()}`,
    );
  }

  beforeEach(() => stubRowLayout());

  afterEach(() => {
    harness.http.verify();
    element.remove();
    document.body.querySelector('[aria-live]')?.remove();
    vi.restoreAllMocks();
  });

  it('is a labelled list with a reorder handle per scene', async () => {
    await setup();
    expect(element.querySelector('sf-sortable-list')?.getAttribute('aria-label')).toBe('Scenes');
    expect(element.querySelectorAll('.c-sortable__handle')).toHaveLength(3);
    expect(element.querySelector('.c-sortable__handle')?.getAttribute('aria-label')).toBe(
      'Reorder Welcome',
    );
  });

  it('drags a scene to a new position: shows it at once, sends the complete order once', async () => {
    await setup();
    dragRow(scene('Welcome'), 0, centre(2) + 5);
    await render();
    expect(list()).toEqual(['1 Presentation', '2 Break', '3 Welcome']);
    const request = harness.http.expectOne(ORDER);
    expect(request.request.method).toBe('PUT');
    expect(request.request.body).toEqual({ sceneIds: ['scn_b', 'scn_c', 'scn_a'] });
    request.flush(null, NO_CONTENT);
    await flushMicrotasks();
    harness.emitEvent({ type: 'scenesReordered', sceneIds: ['scn_b', 'scn_c', 'scn_a'] });
    await harness.settle();
    await render();
    expect(list()).toEqual(['1 Presentation', '2 Break', '3 Welcome']);
    expect(harness.store.scenes().map((entry) => entry.id)).toEqual(['scn_b', 'scn_c', 'scn_a']);
  });

  it('does not switch the scene it dragged, and a plain click still does', async () => {
    await setup();
    dragRow(scene('Break'), 2, centre(0) - 5);
    scene('Break').click();
    await render();
    harness.http.expectOne(ORDER).flush(null, NO_CONTENT);
    harness.http.expectNone(`/api/productions/${PRODUCTION_ID}/program`);
    await flushMicrotasks();
    scene('Presentation').click();
    harness.http.expectOne(`/api/productions/${PRODUCTION_ID}/program`);
  });

  it('puts the order back and explains when the request fails', async () => {
    await setup();
    dragRow(scene('Break'), 2, centre(0) - 5);
    await render();
    expect(list()).toEqual(['1 Break', '2 Welcome', '3 Presentation']);
    harness.http
      .expectOne(ORDER)
      .flush({ code: 'validation_failed' }, { status: 400, statusText: 'Bad Request' });
    await flushMicrotasks();
    await render();
    expect(list()).toEqual(['1 Welcome', '2 Presentation', '3 Break']);
    expect(toasts.current()?.message).toBe('The input is not valid.');
  });

  it('restores the order on Escape without a request', async () => {
    await setup();
    dragRow(scene('Welcome'), 0, centre(2), false);
    await render();
    pressKey(document.body, 'Escape');
    pointer('pointerup', document, 100, centre(2));
    await render();
    expect(list()).toEqual(['1 Welcome', '2 Presentation', '3 Break']);
    harness.http.expectNone(() => true);
  });

  it('moves a scene with Alt+Up/Down and Alt+Shift to the ends, keeping the keys 1-9 in step', async () => {
    await setup();
    pressKey(scene('Break'), 'ArrowUp', { altKey: true, shiftKey: true });
    await render();
    expect(list()).toEqual(['1 Break', '2 Welcome', '3 Presentation']);
    const first = harness.http.expectOne(ORDER);
    expect(first.request.body).toEqual({ sceneIds: ['scn_c', 'scn_a', 'scn_b'] });
    // A second move while the first request runs is merged into one follow-up with the newest order.
    pressKey(scene('Presentation'), 'ArrowUp', { altKey: true });
    await render();
    expect(list()).toEqual(['1 Break', '2 Presentation', '3 Welcome']);
    harness.http.expectNone(ORDER);
    first.flush(null, NO_CONTENT);
    await flushMicrotasks();
    const second = harness.http.expectOne(ORDER);
    expect(second.request.body).toEqual({ sceneIds: ['scn_c', 'scn_b', 'scn_a'] });
    second.flush(null, NO_CONTENT);
    await flushMicrotasks();
  });

  it('still offers Move up and Move down in the menu', async () => {
    await setup();
    element.querySelector<HTMLButtonElement>('.c-scene__more')?.click();
    await render();
    const moveDown = Array.from(
      element.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
    ).find((item) => item.textContent?.includes('Move down'));
    moveDown?.click();
    await render();
    expect(list()).toEqual(['1 Presentation', '2 Welcome', '3 Break']);
    harness.http.expectOne(ORDER).flush(null, NO_CONTENT);
    await flushMicrotasks();
  });

  it('lets go of the drag when another session reorders the scenes meanwhile', async () => {
    await setup();
    dragRow(scene('Welcome'), 0, centre(2) + 5, false);
    await render();
    harness.emitEvent({ type: 'scenesReordered', sceneIds: ['scn_c', 'scn_a', 'scn_b'] });
    await harness.settle();
    await render();
    pointer('pointerup', document, 100, centre(2) + 5);
    await render();
    harness.http.expectNone(() => true);
    expect(list()).toEqual(['1 Break', '2 Welcome', '3 Presentation']);
  });
});
