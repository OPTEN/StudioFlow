import { TestBed } from '@angular/core/testing';
import { FakeStudioHub, flushMicrotasks } from '../../../testing/fake-studio-hub';
import {
  PRODUCTION_ID,
  productionFixture,
  sceneFixture,
  snapshotFixture,
} from '../../../testing/fixtures';
import {
  MemoryStorage,
  startStore,
  studioTestProviders,
  type StoreHarness,
} from '../../../testing/store-harness';
import { PREFERENCE_KEYS } from '../../core/ui/preferences.service';
import { ToastService } from '../../core/ui/toast.service';
import { LIVE_SCENE_DELETE_MESSAGE, SceneCommandsService } from './scene-commands.service';

const BASE = `/api/productions/${PRODUCTION_ID}`;

describe('SceneCommandsService', () => {
  let harness: StoreHarness;
  let commands: SceneCommandsService;
  let toasts: ToastService;

  async function setup(options: { studio?: boolean; preview?: string | null } = {}): Promise<void> {
    const hub = new FakeStudioHub();
    const storage = new MemoryStorage();
    if (options.studio) {
      storage.setItem(PREFERENCE_KEYS.studioMode, '1');
    }
    TestBed.configureTestingModule({ providers: studioTestProviders(hub, storage) });
    harness = await startStore(
      hub,
      snapshotFixture({
        production: productionFixture({ previewSceneId: options.preview ?? null }),
      }),
    );
    commands = TestBed.inject(SceneCommandsService);
    toasts = TestBed.inject(ToastService);
    await harness.settle();
  }

  afterEach(() => harness.http.verify());

  it('creates «Neue Szene N» at the end and opens its name for editing', async () => {
    await setup();
    const created = commands.create();
    const request = harness.http.expectOne(`${BASE}/scenes`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ name: 'Neue Szene 4', cloneFromSceneId: null });
    // A double click while the request runs sends nothing more.
    void commands.create();
    harness.http.expectNone(`${BASE}/scenes`);
    request.flush(sceneFixture('scn_new', 'Neue Szene 4', 3), {
      status: 201,
      statusText: 'Created',
    });
    expect((await created)?.id).toBe('scn_new');
    expect(commands.renamingId()).toBe('scn_new');
    expect(toasts.current()?.message).toBe('Szene «Neue Szene 4» erstellt');
  });

  it('duplicates a scene as «Name (Kopie)» with its content', async () => {
    await setup();
    void commands.duplicate('scn_b');
    const request = harness.http.expectOne(`${BASE}/scenes`);
    expect(request.request.body).toEqual({
      name: 'Präsentation (Kopie)',
      cloneFromSceneId: 'scn_b',
    });
    request.flush(sceneFixture('scn_copy', 'Präsentation (Kopie)', 3));
    await flushMicrotasks();
  });

  it('renames with the trimmed name and rejects empty names locally', async () => {
    await setup();
    const renamed = commands.rename('scn_a', '  Willkommen  ');
    const request = harness.http.expectOne(`${BASE}/scenes/scn_a`);
    expect(request.request.method).toBe('PATCH');
    expect(request.request.body).toEqual({
      name: 'Willkommen',
      layoutMode: null,
      background: null,
    });
    request.flush(sceneFixture('scn_a', 'Willkommen', 0));
    expect(await renamed).toBe(true);
    expect(await commands.rename('scn_a', '   ')).toBe(false);
    expect(toasts.current()?.message).toBe('Der Name braucht 1 bis 80 Zeichen.');
  });

  it('moves a scene with the complete new order', async () => {
    await setup();
    expect(commands.canMove('scn_a', -1)).toBe(false);
    expect(commands.canMove('scn_a', 1)).toBe(true);
    const moved = commands.move('scn_c', -1);
    const request = harness.http.expectOne(`${BASE}/scenes/order`);
    expect(request.request.method).toBe('PUT');
    expect(request.request.body).toEqual({ sceneIds: ['scn_a', 'scn_c', 'scn_b'] });
    expect(commands.reordering()).toBe(true);
    request.flush(null, { status: 204, statusText: 'No Content' });
    expect(await moved).toBe(true);
    // The store still has the old order (no event yet): «Pause» (scn_c) is last and cannot move down.
    expect(await commands.move('scn_c', 1)).toBe(false);
  });

  it('never deletes the live scene', async () => {
    await setup();
    expect(await commands.remove('scn_a')).toBe(false);
    expect(toasts.current()?.message).toBe(LIVE_SCENE_DELETE_MESSAGE);
    harness.http.expectNone(() => true);
  });

  it('moves the preview to the neighbour before deleting the preview scene', async () => {
    await setup({ studio: true, preview: 'scn_b' });
    const removed = commands.remove('scn_b');
    const preview = harness.http.expectOne(`${BASE}/preview`);
    expect(preview.request.body).toEqual({ sceneId: 'scn_c' });
    preview.flush(productionFixture({ previewSceneId: 'scn_c' }));
    await flushMicrotasks();
    const request = harness.http.expectOne(`${BASE}/scenes/scn_b`);
    expect(request.request.method).toBe('DELETE');
    request.flush(null, { status: 204, statusText: 'No Content' });
    expect(await removed).toBe(true);
    expect(toasts.current()?.message).toBe('Szene «Präsentation» gelöscht');
  });

  it('deletes another scene directly and reports server errors', async () => {
    await setup();
    const removed = commands.remove('scn_c');
    harness.http
      .expectOne(`${BASE}/scenes/scn_c`)
      .flush({ code: 'not_found' }, { status: 404, statusText: 'Not Found' });
    expect(await removed).toBe(false);
    expect(toasts.current()?.message).toBe(
      'Das gibt es nicht mehr. Vielleicht wurde es inzwischen gelöscht.',
    );
  });
});
