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

  it('lists the scenes with keycap, name, PGM tag, codes and the prototype labels', async () => {
    await setup();
    const [first, second, third] = rows();
    expect(rows()).toHaveLength(3);
    expect(first.querySelector('.c-keycap')?.getAttribute('data-key')).toBe('1');
    expect(text(first.querySelector('.c-scene__name'))).toBe('Welcome');
    expect(text(first.querySelector('.c-tag--pgm'))).toBe('PGM');
    expect(parts(first.querySelector('.c-scene__meta'))).toBe('PGM K1');
    expect(first.getAttribute('aria-pressed')).toBe('true');
    // The visible text is the accessible name (WCAG 2.5.3): no aria-label.
    expect(first.hasAttribute('aria-label')).toBe(false);
    expect(first.getAttribute('aria-keyshortcuts')).toBe('1');
    expect(parts(second.querySelector('.c-scene__meta'))).toBe('S1 · K1');
    expect(second.getAttribute('aria-pressed')).toBe('false');
    expect(parts(third.querySelector('.c-scene__meta'))).toBe('empty');
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
    expect(parts(first.querySelector('.c-scene__meta'))).toBe('PGM K1 disrupted');
    expect(first.querySelector('.c-lamp')?.className).toContain('is-warn');
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
