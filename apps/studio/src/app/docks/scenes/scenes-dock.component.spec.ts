import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { FakeStudioHub, flushMicrotasks } from '../../../testing/fake-studio-hub';
import { PRODUCTION_ID, sceneFixture, sourceFixture } from '../../../testing/fixtures';
import {
  MemoryStorage,
  startStore,
  studioTestProviders,
  type StoreHarness,
} from '../../../testing/store-harness';
import { PREFERENCE_KEYS } from '../../core/ui/preferences.service';
import { EditorService } from '../../stage/editor.service';
import { dockSnapshot } from '../testing/dock-fixtures';
import { ScenesDockComponent } from './scenes-dock.component';

const BASE = `/api/productions/${PRODUCTION_ID}`;

describe('ScenesDockComponent', () => {
  let harness: StoreHarness;
  let fixture: ComponentFixture<ScenesDockComponent>;
  let element: HTMLElement;

  async function setup(
    snapshot = dockSnapshot(),
    options: { studio?: boolean } = {},
  ): Promise<void> {
    const hub = new FakeStudioHub();
    const storage = new MemoryStorage();
    if (options.studio) {
      storage.setItem(PREFERENCE_KEYS.studioMode, '1');
    }
    TestBed.configureTestingModule({ providers: studioTestProviders(hub, storage) });
    harness = await startStore(hub, snapshot);
    fixture = TestBed.createComponent(ScenesDockComponent);
    element = fixture.nativeElement as HTMLElement;
    await render();
  }

  async function render(): Promise<void> {
    await flushMicrotasks();
    fixture.detectChanges();
    await fixture.whenStable();
  }

  function rows(): HTMLButtonElement[] {
    return Array.from(element.querySelectorAll<HTMLButtonElement>('button.c-scene'));
  }

  function text(node: Element | null | undefined): string {
    return (node?.textContent ?? '').replace(/\s+/g, ' ').trim();
  }

  /** Texts of the child elements, joined with spaces (Angular removes the whitespace between elements). */
  function parts(node: Element | null | undefined): string {
    return Array.from(node?.children ?? [])
      .map((child) => text(child))
      .filter(Boolean)
      .join(' ');
  }

  afterEach(() => harness.http.verify());

  it('lists the scenes with keycap, name, Live capsule, codes, labels and the click hint', async () => {
    await setup();
    const [first, second, third] = rows();
    expect(rows()).toHaveLength(3);
    expect(text(first.querySelector('.c-keycap'))).toBe('1');
    expect(text(first.querySelector('.c-scene__name'))).toBe('Welcome');
    expect(text(first.querySelector('.c-tag--pgm'))).toBe('Live');
    expect(parts(first.querySelector('.c-scene__meta'))).toBe('Live K1');
    expect(first.getAttribute('aria-pressed')).toBe('true');
    expect(first.getAttribute('aria-label')).toBe('Welcome, live on Program');
    expect(first.getAttribute('aria-keyshortcuts')).toBe('1');
    expect(first.getAttribute('title')).toBeNull();
    expect(parts(second.querySelector('.c-scene__meta'))).toBe('S1 · K1');
    expect(second.getAttribute('aria-pressed')).toBe('false');
    expect(second.getAttribute('title')).toBe('Click or press 2 to go live');
    expect(parts(third.querySelector('.c-scene__meta'))).toBe('No sources');
    expect(text(element.querySelector('.c-dock-frame__count'))).toBe('3');
  });

  it('shows the worst outage of a scene as "K1 disrupted"', async () => {
    await setup(
      dockSnapshot({
        sources: [
          sourceFixture('dev_aaaaaaaaaaaaaaaa', 'camera', 'K1', { status: 'reconnecting' }),
          sourceFixture('dev_bbbbbbbbbbbbbbbb', 'screen-1', 'S1', { status: 'ended' }),
        ],
      }),
    );
    const [first, second] = rows();
    expect(parts(first.querySelector('.c-scene__meta'))).toBe('Live K1 disrupted');
    expect(first.querySelector('.c-lamp')?.className).toContain('is-warn');
    expect(first.getAttribute('aria-label')).toBe('Welcome, live on Program, K1 disrupted');
    expect(parts(second.querySelector('.c-scene__meta'))).toBe('S1 disrupted');
    expect(second.querySelector('.c-lamp')?.className).toContain('is-bad');
  });

  it('puts a scene live with a click (Studio Mode off)', async () => {
    await setup();
    rows()[1].click();
    const request = harness.http.expectOne(`${BASE}/program`);
    expect(request.request.body).toEqual({
      sceneId: 'scn_b',
      transition: { kind: 'fade', durationMs: 300 },
    });
    request.flush(dockSnapshot().production);
    await render();
  });

  it('a click on the scene being edited clears the element selection, without a request', async () => {
    await setup();
    const editor = TestBed.inject(EditorService);
    editor.select('itm_a1');
    expect(editor.selectedItem()?.id).toBe('itm_a1');
    rows()[0].click();
    await render();
    expect(editor.selectedItemId()).toBeNull();
    harness.http.expectNone(() => true);
  });

  it('a click on another scene still switches it and keeps the selection until the switch', async () => {
    await setup();
    const editor = TestBed.inject(EditorService);
    editor.select('itm_a1');
    rows()[1].click();
    expect(editor.selectedItemId()).toBe('itm_a1');
    const request = harness.http.expectOne(`${BASE}/program`);
    expect(request.request.body.sceneId).toBe('scn_b');
    harness.emitEvent({
      type: 'programSwitched',
      programSceneId: 'scn_b',
      previewSceneId: null,
      previousProgramSceneId: 'scn_a',
      transition: { kind: 'fade', durationMs: 300 },
      at: new Date().toISOString(),
    });
    request.flush({ ...dockSnapshot().production, programSceneId: 'scn_b' });
    await harness.settle();
    await render();
    // The editor clears the selection whenever the edit scene changes.
    expect(editor.editSceneId()).toBe('scn_b');
    expect(editor.selectedItemId()).toBeNull();
  });

  it('in Studio Mode a click on the Preview scene clears the selection, without a request', async () => {
    await setup(
      dockSnapshot({ production: { ...dockSnapshot().production, previewSceneId: 'scn_b' } }),
      { studio: true },
    );
    const editor = TestBed.inject(EditorService);
    editor.select('itm_b1');
    expect(rows()[1].getAttribute('aria-pressed')).toBe('true');
    rows()[1].click();
    await render();
    expect(editor.selectedItemId()).toBeNull();
    harness.http.expectNone(() => true);
  });

  it('creates a scene and opens its name; Enter saves the new name', async () => {
    await setup();
    const add = element.querySelector<HTMLButtonElement>('button[aria-label="Add scene"]');
    add?.click();
    const create = harness.http.expectOne(`${BASE}/scenes`);
    const created = sceneFixture('scn_d', 'New scene 4', 3);
    harness.emitEvent({ type: 'sceneUpserted', scene: created });
    create.flush(created, { status: 201, statusText: 'Created' });
    await harness.settle();
    await render();
    const input = element.querySelector<HTMLInputElement>('sf-inline-edit input');
    expect(input?.value).toBe('New scene 4');
    expect(input?.getAttribute('aria-label')).toBe('Scene name');
    expect(document.activeElement).toBe(input);
    if (input) {
      input.value = 'Closing';
      input.dispatchEvent(new Event('input'));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    }
    const rename = harness.http.expectOne(`${BASE}/scenes/scn_d`);
    expect(rename.request.body).toEqual({ name: 'Closing', layoutMode: null, background: null });
    await render();
    expect(element.querySelector('sf-inline-edit')).toBeNull();
    expect(text(rows()[3].querySelector('.c-scene__name'))).toBe('Closing');
    rename.flush({ ...created, name: 'Closing' });
    await render();
  });

  it('renames with F2 and cancels with Escape without a request', async () => {
    await setup();
    rows()[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true }));
    await render();
    const input = element.querySelector<HTMLInputElement>('sf-inline-edit input');
    expect(input?.value).toBe('Welcome');
    input?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await render();
    expect(element.querySelector('sf-inline-edit')).toBeNull();
    harness.http.expectNone(() => true);
  });

  it('moves a scene with Alt+ArrowDown', async () => {
    await setup();
    rows()[0].dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true }),
    );
    const request = harness.http.expectOne(`${BASE}/scenes/order`);
    expect(request.request.body).toEqual({ sceneIds: ['scn_b', 'scn_a', 'scn_c'] });
    request.flush(null, { status: 204, statusText: 'No Content' });
    await render();
  });

  /** Opens the row menu of a scene and returns its items. */
  async function openMenu(index: number): Promise<HTMLButtonElement[]> {
    element.querySelectorAll<HTMLButtonElement>('.c-scene__more')[index]?.click();
    await render();
    return Array.from(element.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
  }

  function item(items: HTMLButtonElement[], label: string): HTMLButtonElement {
    return items.find((entry) => text(entry).startsWith(label)) as HTMLButtonElement;
  }

  it('offers the scene actions in the row menu; the live scene cannot be deleted and says why', async () => {
    await setup();
    const items = await openMenu(0);
    expect(items.map((entry) => text(entry))).toEqual([
      'RenameF2',
      'Duplicate',
      'Send to Preview Turns on Studio Mode',
      'Move upAlt+↑',
      'Move downAlt+↓',
      'Delete… The live scene cannot be deleted.',
    ]);
    expect(item(items, 'Delete').disabled).toBe(true);
    expect(item(items, 'Move up').disabled).toBe(true);
  });

  it('deletes another scene from its menu only after the confirmation', async () => {
    await setup();
    item(await openMenu(2), 'Delete').click();
    await render();
    const dialog = element.querySelector('[role="dialog"]');
    expect(dialog?.getAttribute('aria-label')).toBe('Delete scene');
    expect(text(dialog?.querySelector('.c-confirm span'))).toBe(
      '“Break” will be deleted with everything in it. This cannot be undone.',
    );
    expect(document.activeElement?.hasAttribute('data-cancel')).toBe(true);
    harness.http.expectNone(() => true);
    dialog?.querySelector<HTMLButtonElement>('.c-btn--danger-fill')?.click();
    harness.http
      .expectOne(`${BASE}/scenes/scn_c`)
      .flush(null, { status: 204, statusText: 'No Content' });
    await render();
    expect(element.querySelector('[role="dialog"]')).toBeNull();
  });

  it('"Send to Preview" turns Studio Mode on and loads the scene into the Preview', async () => {
    await setup();
    item(await openMenu(2), 'Send to Preview').click();
    // Studio Mode on: the switcher puts the scene after the Program into the Preview first.
    const auto = harness.http.expectOne(`${BASE}/preview`);
    expect(auto.request.body).toEqual({ sceneId: 'scn_b' });
    auto.flush({ ...dockSnapshot().production, previewSceneId: 'scn_b' });
    await harness.settle();
    await flushMicrotasks();
    const chosen = harness.http.expectOne(`${BASE}/preview`);
    expect(chosen.request.body).toEqual({ sceneId: 'scn_c' });
    chosen.flush({ ...dockSnapshot().production, previewSceneId: 'scn_c' });
    await render();
  });

  it('teaches the empty list and creates the first scene from it', async () => {
    await setup(dockSnapshot({ scenes: [] }));
    expect(text(element.querySelector('.c-empty strong'))).toBe('No scenes yet.');
    const add = Array.from(element.querySelectorAll<HTMLButtonElement>('.c-empty button')).find(
      (button) => text(button) === 'Add scene',
    );
    add?.click();
    harness.http
      .expectOne(`${BASE}/scenes`)
      .flush(sceneFixture('scn_d', 'New scene 1', 0), { status: 201, statusText: 'Created' });
    await render();
  });

  it('shows a loading state before the first snapshot', async () => {
    const hub = new FakeStudioHub();
    TestBed.configureTestingModule({ providers: studioTestProviders(hub) });
    fixture = TestBed.createComponent(ScenesDockComponent);
    element = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    expect(text(element.querySelector('.c-empty'))).toContain('Loading scenes');
    harness = { http: { verify: () => undefined } } as unknown as StoreHarness;
  });
});
