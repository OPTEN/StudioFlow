import { TestBed } from '@angular/core/testing';
import { FakeStudioHub, flushMicrotasks } from '../../testing/fake-studio-hub';
import { PRODUCTION_ID, productionFixture, snapshotFixture } from '../../testing/fixtures';
import {
  MemoryStorage,
  startStore,
  studioTestProviders,
  type StoreHarness,
} from '../../testing/store-harness';
import { KeyboardService } from '../core/ui/keyboard.service';
import { PREFERENCE_KEYS } from '../core/ui/preferences.service';
import { ToastService } from '../core/ui/toast.service';
import { SwitcherService } from './switcher.service';

const BASE = `/api/productions/${PRODUCTION_ID}`;

describe('SwitcherService', () => {
  let hub: FakeStudioHub;
  let storage: MemoryStorage;
  let harness: StoreHarness;
  let switcher: SwitcherService;
  let toasts: ToastService;

  // The keyboard shortcuts read `document.activeElement`, and Space is left alone on a button or link. Specs that
  // share the document can leave the focus on one, so every test starts with the focus on the page.
  beforeEach(() => {
    (document.activeElement as HTMLElement | null)?.blur();
  });

  async function setup(
    options: { studio?: boolean; preview?: string | null; operators?: number } = {},
  ): Promise<void> {
    hub = new FakeStudioHub();
    storage = new MemoryStorage();
    if (options.studio) {
      storage.setItem(PREFERENCE_KEYS.studioMode, '1');
    }
    TestBed.configureTestingModule({ providers: studioTestProviders(hub, storage) });
    harness = await startStore(
      hub,
      snapshotFixture({
        production: productionFixture({ previewSceneId: options.preview ?? null }),
        operatorsOnline: options.operators ?? 1,
      }),
    );
    switcher = TestBed.inject(SwitcherService);
    toasts = TestBed.inject(ToastService);
    await harness.settle();
  }

  afterEach(() => {
    vi.useRealTimers();
    harness?.http.verify();
  });

  /** Resolves once the switching request that a key started is answered, instead of guessing how many ticks it takes. */
  const untilIdle = (): Promise<void> => vi.waitFor(() => expect(switcher.busy()).toBe(false));

  it('switches the program directly without Studio-Modus, with the transition', async () => {
    await setup();
    expect(switcher.hint()).toBe('Click a scene to switch it live directly.');
    const done = switcher.chooseScene('scn_b');
    const request = harness.http.expectOne(`${BASE}/program`);
    expect(request.request.body).toEqual({
      sceneId: 'scn_b',
      transition: { kind: 'fade', durationMs: 300 },
    });
    expect(switcher.busy()).toBe(true);
    // Rapid repeat while the request is in flight is ignored.
    void switcher.chooseScene('scn_c');
    harness.http.expectNone(`${BASE}/program`);
    request.flush(productionFixture({ programSceneId: 'scn_b' }));
    await done;
    expect(switcher.busy()).toBe(false);
  });

  it('does nothing for the scene that is already on air', async () => {
    await setup();
    await switcher.chooseScene('scn_a');
    harness.http.expectNone(`${BASE}/program`);
  });

  it('sends a cut with duration 0 and keeps the fade duration', async () => {
    await setup();
    switcher.stepDuration(1);
    switcher.setTransitionKind('cut');
    expect(switcher.transition()).toEqual({ kind: 'cut', durationMs: 0 });
    expect(switcher.canStepDuration(1)).toBe(false);
    expect(JSON.parse(storage.getItem(PREFERENCE_KEYS.transition) ?? '{}')).toEqual({
      kind: 'cut',
      durationMs: 500,
    });
    switcher.setTransitionKind('fade');
    expect(switcher.transition()).toEqual({ kind: 'fade', durationMs: 500 });
    expect(switcher.durationLabel()).toBe('0.5 s');
  });

  it('steps the fade duration within 0.2 … 2 s', async () => {
    await setup();
    switcher.stepDuration(-1);
    expect(switcher.fadeDurationMs()).toBe(200);
    expect(switcher.canStepDuration(-1)).toBe(false);
    switcher.stepDuration(-1);
    expect(switcher.fadeDurationMs()).toBe(200);
    for (let index = 0; index < 10; index += 1) {
      switcher.stepDuration(1);
    }
    expect(switcher.fadeDurationMs()).toBe(2000);
    expect(switcher.canStepDuration(1)).toBe(false);
  });

  it('turns Studio Mode on: preview = the scene after the program, toast', async () => {
    await setup();
    const done = switcher.setStudioMode(true);
    expect(toasts.current()?.message).toBe('Studio Mode on: Preview and Take');
    const request = harness.http.expectOne(`${BASE}/preview`);
    expect(request.request.method).toBe('PUT');
    expect(request.request.body).toEqual({ sceneId: 'scn_b' });
    request.flush(productionFixture({ previewSceneId: 'scn_b' }));
    await done;
    expect(switcher.studioMode()).toBe(true);
    expect(storage.getItem(PREFERENCE_KEYS.studioMode)).toBe('1');
    expect(switcher.hint()).toBe('Click a scene to load it into Preview. Take switches it live.');
  });

  it('turns Studio Mode off and clears the preview when nobody else is in the Regie', async () => {
    await setup({ studio: true, preview: 'scn_b' });
    const done = switcher.setStudioMode(false);
    expect(toasts.current()?.message).toBe('Studio Mode off: scenes switch live directly');
    harness.http.expectOne(`${BASE}/preview`).flush(productionFixture());
    await done;
  });

  it('keeps the preview when another operator is online', async () => {
    await setup({ studio: true, preview: 'scn_b', operators: 2 });
    await switcher.setStudioMode(false);
    harness.http.expectNone(`${BASE}/preview`);
  });

  it('loads the preview in Studio-Modus and takes with the transition', async () => {
    await setup({ studio: true, preview: 'scn_b' });
    const choose = switcher.chooseScene('scn_c');
    const preview = harness.http.expectOne(`${BASE}/preview`);
    expect(preview.request.body).toEqual({ sceneId: 'scn_c' });
    preview.flush(productionFixture());
    await choose;
    expect(switcher.canTake()).toBe(true);
    const take = switcher.take();
    const request = harness.http.expectOne(`${BASE}/take`);
    expect(request.request.body).toEqual({ transition: { kind: 'fade', durationMs: 300 } });
    request.flush(productionFixture());
    await expect(take).resolves.toBe(true);
  });

  it('refuses Take without Studio-Modus or with preview = program', async () => {
    await setup({ studio: true, preview: 'scn_a' });
    expect(switcher.canTake()).toBe(false);
    await expect(switcher.take()).resolves.toBe(false);
    harness.http.expectNone(`${BASE}/take`);
  });

  it('assigns a preview automatically when Studio-Modus is on and the server has none', async () => {
    await setup({ studio: true, preview: null });
    const request = harness.http.expectOne(`${BASE}/preview`);
    expect(request.request.body).toEqual({ sceneId: 'scn_b' });
    request.flush(productionFixture({ previewSceneId: 'scn_b' }));
  });

  it('ignores 409 transition_running silently and shows other errors', async () => {
    await setup();
    toasts.dismiss();
    const first = switcher.chooseScene('scn_b');
    harness.http
      .expectOne(`${BASE}/program`)
      .flush({ code: 'transition_running' }, { status: 409, statusText: 'Conflict' });
    await first;
    expect(toasts.current()).toBeNull();
    const second = switcher.chooseScene('scn_b');
    harness.http
      .expectOne(`${BASE}/program`)
      .flush({ code: 'not_found' }, { status: 404, statusText: 'Not Found' });
    await second;
    expect(toasts.current()?.message).toContain('no longer exists');
  });

  it('blocks switching while a fade of the last program switch runs', async () => {
    // The clock stands still, so the fade neither ends early on a slow machine nor needs a real wait.
    vi.useFakeTimers();
    await setup();
    harness.emitEvent({
      type: 'programSwitched',
      programSceneId: 'scn_b',
      previewSceneId: null,
      previousProgramSceneId: 'scn_a',
      transition: { kind: 'fade', durationMs: 200 },
      at: new Date().toISOString(),
    });
    await harness.settle();
    expect(switcher.transitionRunning()).toBe(true);
    await switcher.chooseScene('scn_c');
    harness.http.expectNone(`${BASE}/program`);
    vi.advanceTimersByTime(199);
    expect(switcher.transitionRunning()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(switcher.transitionRunning()).toBe(false);
  });

  it('flashes the program and announces that a scene is live for every switch event', async () => {
    await setup();
    expect(switcher.programFlash()).toBe(0);
    harness.emitEvent({
      type: 'programSwitched',
      programSceneId: 'scn_c',
      previewSceneId: null,
      previousProgramSceneId: 'scn_a',
      transition: { kind: 'cut', durationMs: 0 },
      at: new Date().toISOString(),
    });
    await harness.settle();
    expect(switcher.programFlash()).toBe(1);
    expect(toasts.current()?.message).toBe('“Break” is live');
  });

  it('refuses commands while offline', async () => {
    await setup();
    hub.drop();
    await flushMicrotasks();
    await switcher.chooseScene('scn_b');
    harness.http.expectNone(`${BASE}/program`);
    expect(toasts.current()?.message).toBe(
      'No connection to the server. Switching works again as soon as the control room is connected.',
    );
  });

  it('maps keys 1–9 and Space through the keyboard service', async () => {
    await setup({ studio: true, preview: 'scn_b' });
    const off = switcher.registerShortcuts();
    const keyboard = TestBed.inject(KeyboardService);
    keyboard.handle(new KeyboardEvent('keydown', { key: '3', cancelable: true }));
    harness.http.expectOne(`${BASE}/preview`).flush(productionFixture());
    await untilIdle();
    keyboard.handle(new KeyboardEvent('keydown', { key: ' ', code: 'Space', cancelable: true }));
    harness.http.expectOne(`${BASE}/take`).flush(productionFixture());
    await untilIdle();
    off();
    keyboard.handle(new KeyboardEvent('keydown', { key: '1', cancelable: true }));
    harness.http.expectNone(`${BASE}/preview`);
  });
});
