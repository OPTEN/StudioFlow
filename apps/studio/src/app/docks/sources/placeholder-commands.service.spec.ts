import { TestBed } from '@angular/core/testing';
import { FakeStudioHub, flushMicrotasks } from '../../../testing/fake-studio-hub';
import { PRODUCTION_ID, placeholderFixture, sourceFixture } from '../../../testing/fixtures';
import { startStore, studioTestProviders, type StoreHarness } from '../../../testing/store-harness';
import { ToastService } from '../../core/ui/toast.service';
import { dockSnapshot } from '../testing/dock-fixtures';
import { PlaceholderCommandsService } from './placeholder-commands.service';

const BASE = `/api/productions/${PRODUCTION_ID}/placeholders`;
const K1 = placeholderFixture('K1', 'Stage phone');
const NEW_PHONE = sourceFixture('dev_dddddddddddddddd', 'camera', 'K3', { label: 'New phone' });

describe('PlaceholderCommandsService', () => {
  let harness: StoreHarness;
  let commands: PlaceholderCommandsService;
  let toasts: ToastService;

  async function setup(): Promise<void> {
    const hub = new FakeStudioHub();
    TestBed.configureTestingModule({ providers: studioTestProviders(hub) });
    harness = await startStore(hub, dockSnapshot({ placeholders: [K1] }));
    commands = TestBed.inject(PlaceholderCommandsService);
    toasts = TestBed.inject(ToastService);
  }

  afterEach(() => harness.http.verify());

  it('assigns a source and confirms with a toast; a second click while it runs sends nothing', async () => {
    await setup();
    const done = commands.assign(K1, NEW_PHONE);
    expect(commands.busy(K1.id)).toBe(true);
    void commands.assign(K1, NEW_PHONE);
    const request = harness.http.expectOne(`${BASE}/${K1.id}/assignment`);
    expect(request.request.method).toBe('PUT');
    expect(request.request.body).toEqual({ sourceId: NEW_PHONE.id });
    request.flush({ scenes: 2, items: 3 });
    expect(await done).toBe(true);
    expect(commands.busy(K1.id)).toBe(false);
    expect(toasts.current()?.message).toBe(
      'The scenes now show K3 New phone in place of K1 · Stage phone.',
    );
  });

  it('removes the placeholder from all scenes', async () => {
    await setup();
    const done = commands.remove(K1);
    const request = harness.http.expectOne(`${BASE}/${K1.id}`);
    expect(request.request.method).toBe('DELETE');
    request.flush({ scenes: 1, items: 1 });
    expect(await done).toBe(true);
    expect(toasts.current()?.message).toBe('K1 · Stage phone removed from the scenes.');
  });

  it('tells the reason when the server refuses and reports false', async () => {
    await setup();
    const done = commands.assign(K1, NEW_PHONE);
    harness.http
      .expectOne(`${BASE}/${K1.id}/assignment`)
      .flush(
        { type: 'about:blank', status: 404, code: 'not_found' },
        { status: 404, statusText: 'Not Found' },
      );
    expect(await done).toBe(false);
    expect(commands.busy(K1.id)).toBe(false);
    expect(toasts.current()?.message).toBeTruthy();
  });

  it('sends nothing while the Regie is offline', async () => {
    await setup();
    harness.hub.drop();
    await flushMicrotasks();
    expect(commands.blocked(K1.id)).toBe(true);
    expect(await commands.assign(K1, NEW_PHONE)).toBe(false);
    harness.http.expectNone(`${BASE}/${K1.id}/assignment`);
    expect(toasts.current()?.message).toBe(
      'No connection to the server. Please try again in a moment.',
    );
  });
});
